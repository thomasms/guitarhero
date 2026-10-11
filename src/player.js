// Playback engine: a look-ahead scheduler that plays the song's tab notes and
// generates metronome, drums and bass in time with the song.

import { Sounds } from './audio.js';
import { chordIndexAt } from './parser.js';

const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead
const TICK_MS = 25;
const STEP = 0.5; // grid resolution in beats (eighth notes)

// Drum patterns. Each returns the hits for one eighth-note step of a bar.
// step: 0 .. beatsPerBar*2-1
export const DRUM_STYLES = {
  none: { label: 'No drums', hits: () => [] },
  rock: {
    label: 'Rock',
    hits: (step, bpb) => {
      const out = ['hat'];
      const beat = step / 2;
      if (step === 0 || (bpb % 2 === 0 && step === bpb) || (bpb === 4 && step === 5)) out.push('kick');
      if (Number.isInteger(beat) && (bpb === 3 ? beat > 0 : beat % 2 === 1)) out.push('snare');
      return out;
    },
  },
  halftime: {
    label: 'Half-time / ballad',
    hits: (step, bpb) => {
      const out = step % 2 === 0 ? ['hat'] : [];
      if (step === 0 || (bpb === 4 && step === 3)) out.push('kick');
      if (step === (bpb % 2 === 0 ? bpb : 2 * Math.floor(bpb / 2))) out.push('snare');
      return out;
    },
  },
  disco: {
    label: 'Four on the floor',
    hits: (step) => {
      const out = [];
      const beat = step / 2;
      if (Number.isInteger(beat)) {
        out.push('kick');
        if (beat % 2 === 1) out.push('snare');
      } else out.push('openhat');
      return out;
    },
  },
  shuffle: {
    label: 'Shuffle',
    // Swing is applied by the scheduler for this style.
    swing: true,
    hits: (step, bpb) => {
      const out = ['hat'];
      const beat = step / 2;
      if (step === 0 || (bpb % 2 === 0 && step === bpb)) out.push('kick');
      if (Number.isInteger(beat) && beat % 2 === 1) out.push('snare');
      return out;
    },
  },
};

export const BASS_STYLES = {
  none: 'No bass',
  root: 'Root notes (quarters)',
  eighths: 'Driving eighths',
  rootfifth: 'Root – fifth',
  whole: 'One note per chord',
};

function bassMidi(pc) {
  // Keep bass notes between E1 (28) and D#2 (39).
  return 28 + ((pc - 4 + 12) % 12);
}

export class Player {
  constructor() {
    this.ctx = null;
    this.sounds = null;
    this.song = null;
    this.playing = false;
    this.bpm = 90;
    this.settings = {
      metronome: true,
      countIn: true,
      drums: 'rock',
      bass: 'root',
      guitar: true,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      speedUp: 0, // BPM added per loop
      speedUpMax: 200,
    };
    this.volumes = { guitar: 0.8, bass: 0.7, drums: 0.7, click: 0.6 };
    this.anchors = [{ time: 0, beat: 0, bpm: this.bpm }];
    this.pausedBeat = 0;
    this.onEnd = null;
    this.onLoop = null;
    this.onTempo = null;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.sounds = new Sounds(this.ctx);
    for (const [k, v] of Object.entries(this.volumes)) this.sounds.setVolume(k, v);
  }

  setSong(song) {
    this.stop();
    this.song = song;
    this.settings.loopStart = 0;
    this.settings.loopEnd = song.totalBeats;
  }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    if (this.sounds) this.sounds.setVolume(bus, v);
  }

  get bpb() {
    return this.song ? this.song.options.beatsPerBar : 4;
  }

  // --- time mapping -------------------------------------------------------
  get anchor() {
    return this.anchors[this.anchors.length - 1];
  }

  timeAt(beat) {
    const a = this.anchor;
    return a.time + ((beat - a.beat) * 60) / a.bpm;
  }

  beatAtTime(t) {
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.time <= t) a = x;
    return a.beat + ((t - a.time) * a.bpm) / 60;
  }

  pushAnchor(time, beat, bpm) {
    this.anchors.push({ time, beat, bpm });
    if (this.anchors.length > 4) this.anchors.shift();
  }

  // Current position in beats (what you hear now).
  get position() {
    if (!this.playing) return this.pausedBeat;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.beatAtTime(this.ctx.currentTime - latency);
  }

  setTempo(bpm) {
    this.bpm = Math.max(20, Math.min(300, Math.round(bpm)));
    if (this.playing) {
      const now = this.ctx.currentTime;
      this.pushAnchor(now, this.beatAtTime(now), this.bpm);
    }
    this.onTempo?.(this.bpm);
  }

  // --- transport ----------------------------------------------------------
  play(fromBeat = this.pausedBeat) {
    if (!this.song || this.playing) return;
    this.ensureContext();
    this.ctx.resume();
    if (fromBeat >= this.song.totalBeats) fromBeat = 0;
    const s = this.settings;
    if (s.loop && (fromBeat < s.loopStart || fromBeat >= s.loopEnd)) fromBeat = s.loopStart;
    this.countInEnd = fromBeat;
    const startBeat = s.countIn ? fromBeat - this.bpb : fromBeat;
    this.anchors = [];
    this.pushAnchor(this.ctx.currentTime + 0.1, startBeat, this.bpm);
    this.resetPointers(startBeat);
    this.playing = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  pause() {
    if (!this.playing) return;
    this.pausedBeat = Math.max(0, this.position);
    this.halt();
  }

  stop() {
    this.halt();
    this.pausedBeat = this.settings.loop ? this.settings.loopStart : 0;
  }

  halt() {
    this.playing = false;
    clearInterval(this.timer);
    // Silence sounds that are already scheduled.
    if (this.sounds) this.sounds.newOutput();
  }

  seek(beat) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.halt();
    this.pausedBeat = Math.max(0, Math.min(beat, this.song ? this.song.totalBeats : 0));
    if (wasPlaying) this.play(this.pausedBeat);
  }

  resetPointers(beat) {
    this.nextStep = Math.ceil(beat / STEP - 1e-9) * STEP;
    const notes = this.song.notes;
    let i = 0;
    while (i < notes.length && notes[i].beat < beat - 1e-9) i++;
    this.noteIdx = i;
  }

  // --- scheduling ---------------------------------------------------------
  tick() {
    if (!this.playing) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    const s = this.settings;
    for (let guard = 0; guard < 4; guard++) {
      const target = this.beatAtTime(horizon);
      const loopEnd = s.loop && s.loopEnd > s.loopStart ? s.loopEnd : Infinity;
      this.scheduleUntil(Math.min(target, loopEnd));
      if (target < loopEnd) break;
      // Jump back to the loop start.
      const t = this.timeAt(loopEnd);
      if (s.speedUp) this.bpm = Math.min(s.speedUpMax, this.bpm + s.speedUp);
      this.pushAnchor(t, s.loopStart, this.bpm);
      this.resetPointers(s.loopStart);
      this.onLoop?.(this.bpm);
    }
    if (!s.loop && this.position >= this.song.totalBeats + 0.25) {
      this.halt();
      this.pausedBeat = 0;
      this.onEnd?.();
    }
  }

  scheduleUntil(endBeat) {
    const song = this.song;
    const s = this.settings;
    const style = DRUM_STYLES[s.drums] || DRUM_STYLES.none;
    const swingOffset = (beat) => (style.swing && !Number.isInteger(beat) ? STEP / 3 : 0);

    while (this.nextStep < endBeat) {
      const beat = this.nextStep;
      this.nextStep += STEP;
      const time = this.timeAt(beat + swingOffset(beat));
      const bpb = this.bpb;
      const inBar = ((beat % bpb) + bpb) % bpb;
      const onBeat = Number.isInteger(beat);

      if (beat < this.countInEnd) {
        if (onBeat) this.sounds.click(time, inBar === 0);
        continue;
      }
      if (beat >= song.totalBeats) continue;

      if (s.metronome && onBeat) this.sounds.click(time, inBar === 0);

      for (const hit of style.hits(Math.round(inBar * 2), bpb)) {
        if (hit === 'kick') this.sounds.kick(time);
        else if (hit === 'snare') this.sounds.snare(time);
        else if (hit === 'hat') this.sounds.hat(time);
        else if (hit === 'openhat') this.sounds.hat(time, true);
      }

      this.scheduleBass(beat, time, onBeat);
    }

    const notes = song.notes;
    while (this.noteIdx < notes.length && notes[this.noteIdx].beat < endBeat) {
      const n = notes[this.noteIdx++];
      if (!s.guitar || n.beat < this.countInEnd - 1e-9) continue;
      const time = this.timeAt(n.beat + swingOffset(n.beat));
      this.sounds.guitar(time, n.midi, (n.duration * 60) / this.bpm, n.muted);
    }
  }

  scheduleBass(beat, time, onBeat) {
    const style = this.settings.bass;
    if (style === 'none') return;
    const chords = this.song.chords;
    // 'whole' plays at chord changes, which may fall between grid steps.
    const idx = chordIndexAt(chords, style === 'whole' ? beat + STEP - 1e-3 : beat);
    if (idx < 0) return;
    const chord = chords[idx];
    const capo = this.song.capo;
    const root = bassMidi(chord.bass + capo);
    const beatLen = 60 / this.bpm;
    const nextChordBeat = idx + 1 < chords.length ? chords[idx + 1].beat : this.song.totalBeats;
    const isChange = chord.beat >= beat - 1e-6 && chord.beat < beat + STEP - 1e-6;

    if (style === 'eighths') {
      this.sounds.bass(time, root, beatLen * 0.45);
    } else if (style === 'root' && onBeat) {
      this.sounds.bass(time, root, beatLen * 0.9);
    } else if (style === 'rootfifth' && onBeat) {
      const sinceChord = Math.round(beat - chord.beat);
      let note = root;
      if (sinceChord % 2 === 1) {
        note = bassMidi(chord.root + capo) + chord.fifth;
        if (note > 45) note -= 12;
      }
      this.sounds.bass(time, note, beatLen * 0.9);
    } else if (style === 'whole' && isChange) {
      const t = this.timeAt(chord.beat);
      this.sounds.bass(t, root, Math.min(nextChordBeat - chord.beat, 8) * beatLen * 0.95);
    }
  }
}
