// Web Audio sound sources: plucked guitar, bass, drums and metronome click.
// All sounds are synthesized, so no audio files are needed.

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sounds {
  constructor(ctx) {
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 4;
    this.comp.connect(ctx.destination);
    this.volumes = { guitar: 0.8, bass: 0.7, drums: 0.7, click: 0.6 };
    this.newOutput();
    this.pluckCache = new Map();
    this.noise = this.makeNoise(1);
  }

  // Builds a fresh set of output buses. The old ones fade out and are
  // disconnected, which also silences any sounds already scheduled on them.
  newOutput() {
    const ctx = this.ctx;
    const old = this.master;
    if (old) {
      const now = ctx.currentTime;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + 0.04);
      setTimeout(() => old.disconnect(), 100);
    }
    this.master = ctx.createGain();
    this.master.connect(this.comp);
    this.bus = {};
    for (const [name, v] of Object.entries(this.volumes)) {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.master);
      this.bus[name] = g;
    }
  }

  setVolume(bus, value) {
    this.volumes[bus] = value;
    this.bus[bus].gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  makeNoise(seconds) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * seconds, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Karplus-Strong plucked string, rendered once per pitch and cached.
  pluckBuffer(midi) {
    if (this.pluckCache.has(midi)) return this.pluckCache.get(midi);
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 3);
    const buf = this.ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = sr / midiToFreq(midi);
    const n = Math.max(2, Math.round(period));
    const decay = 0.996 + Math.min(0.0035, (69 - midi) * 0.00006);
    // Seed with slightly low-passed noise for a warmer attack.
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      prev = prev * 0.5 + r * 0.5;
      out[i] = prev;
    }
    for (let i = n; i < len; i++) {
      out[i] = decay * 0.5 * (out[i - n] + out[i - n - 1 >= 0 ? i - n - 1 : i - n]);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
    this.pluckCache.set(midi, buf);
    return buf;
  }

  guitar(time, midi, duration, muted = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    if (muted) {
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      g.gain.setValueAtTime(0.25, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
      src.connect(f).connect(g).connect(this.bus.guitar);
      src.start(time, Math.random() * 0.5, 0.08);
      return;
    }
    src.buffer = this.pluckBuffer(midi);
    const end = time + Math.min(Math.max(duration, 0.15), 2.9);
    g.gain.setValueAtTime(0.5, time);
    g.gain.setValueAtTime(0.5, end - 0.04);
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(g).connect(this.bus.guitar);
    src.start(time);
    src.stop(end + 0.01);
  }

  bass(time, midi, duration) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    sub.type = 'sine';
    osc.frequency.value = midiToFreq(midi);
    sub.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(1200, time);
    filter.frequency.exponentialRampToValueAtTime(250, time + 0.25);
    const end = time + Math.max(0.08, duration);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.45, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.25, time + 0.2);
    g.gain.setValueAtTime(0.25, end - 0.03);
    g.gain.linearRampToValueAtTime(0, end);
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(g).connect(this.bus.bass);
    osc.start(time);
    sub.start(time);
    osc.stop(end + 0.01);
    sub.stop(end + 0.01);
  }

  kick(time) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(1, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    osc.connect(g).connect(this.bus.drums);
    osc.start(time);
    osc.stop(time + 0.36);
  }

  snare(time) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    src.connect(hp).connect(g).connect(this.bus.drums);
    src.start(time, Math.random() * 0.5, 0.2);

    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(190, time);
    bg.gain.setValueAtTime(0.5, time);
    bg.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    body.connect(bg).connect(this.bus.drums);
    body.start(time);
    body.stop(time + 0.11);
  }

  hat(time, open = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    const len = open ? 0.25 : 0.05;
    g.gain.setValueAtTime(open ? 0.22 : 0.18, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + len);
    src.connect(hp).connect(g).connect(this.bus.drums);
    src.start(time, Math.random() * 0.5, len + 0.01);
  }

  click(time, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.3, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(g).connect(this.bus.click);
    osc.start(time);
    osc.stop(time + 0.04);
  }
}
