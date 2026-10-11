import { parseSong, beatToCol, beatAtCol, chordIndexAt } from './parser.js';
import { Player, DRUM_STYLES, BASS_STYLES } from './player.js';
import { loadSongs, saveSongs, loadSettings, saveSettings } from './storage.js';
import { SAMPLES } from './samples.js';

const $ = (sel) => document.querySelector(sel);
const player = new Player();

// ---------------------------------------------------------------- state
let songs = loadSongs();
if (!songs.length) songs = SAMPLES.map((s) => ({ ...s }));
const settings = {
  volumes: { ...player.volumes },
  metronome: true,
  countIn: true,
  guitar: true,
  follow: true,
  lastSongId: null,
  ...loadSettings(),
};
let current = null; // song record
let parsed = null; // parsed song
let view = null; // rendered DOM references

const persistSongs = () => saveSongs(songs);
const persistSettings = () => saveSettings(settings);

// ---------------------------------------------------------------- helpers
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function lineHtml(text, spans) {
  spans.sort((a, b) => a.col - b.col);
  let html = '';
  let pos = 0;
  for (const s of spans) {
    if (s.col < pos) continue;
    html += escapeHtml(text.slice(pos, s.col));
    html += `<span class="${s.cls}" data-${s.kind}="${s.id}">${escapeHtml(text.slice(s.col, s.col + s.len))}</span>`;
    pos = s.col + s.len;
  }
  return html + escapeHtml(text.slice(pos)) || '&nbsp;';
}

function measureCharWidth(el) {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(100);
  probe.style.visibility = 'hidden';
  probe.style.position = 'absolute';
  el.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return w;
}

// ---------------------------------------------------------------- render
function render() {
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  if (!parsed) return;

  const spansByLine = new Map();
  const addSpan = (line, span) => {
    if (!spansByLine.has(line)) spansByLine.set(line, []);
    spansByLine.get(line).push(span);
  };
  for (const n of parsed.notes) addSpan(n.line, { col: n.col, len: n.len, cls: 'note', kind: 'note', id: n.id });
  for (const c of parsed.chords) addSpan(c.line, { col: c.col, len: c.len, cls: 'chord', kind: 'chord', id: c.id });
  // Chords that are not in the timeline (rare) still get chord styling.
  for (const b of parsed.blocks) {
    if (b.type === 'chords' && !b.timed) for (const c of b.chords) addSpan(b.line, { col: c.col, len: c.len, cls: 'chord', kind: 'x', id: '' });
  }

  const makeLine = (i, cls) => {
    const div = document.createElement('div');
    div.className = `line ${cls}`;
    div.innerHTML = lineHtml(parsed.lines[i], spansByLine.get(i) || []);
    return div;
  };

  view = { staves: [], chordEls: [], noteEls: [], chordLines: [] };
  for (const b of parsed.blocks) {
    if (b.type === 'stave') {
      const wrap = document.createElement('div');
      wrap.className = 'stave';
      wrap.dataset.stave = b.index;
      for (let k = 0; k < b.lineCount; k++) wrap.appendChild(makeLine(b.lineStart + k, 'tab'));
      const cursor = document.createElement('div');
      cursor.className = 'cursor';
      wrap.appendChild(cursor);
      sheet.appendChild(wrap);
      view.staves.push({ block: b, el: wrap, cursor });
    } else if (b.type === 'chords') {
      const el = makeLine(b.line, 'chords');
      sheet.appendChild(el);
      if (b.timed && b.startBeat !== undefined) view.chordLines.push({ block: b, el });
    } else {
      sheet.appendChild(makeLine(b.line, b.type));
    }
  }
  sheet.querySelectorAll('[data-chord]').forEach((el) => (view.chordEls[el.dataset.chord] = el));
  sheet.querySelectorAll('[data-note]').forEach((el) => (view.noteEls[el.dataset.note] = el));
  view.charWidth = measureCharWidth(sheet);
  view.activeChord = -1;
  view.activeBlockEl = null;
  view.lastPos = -Infinity;
  view.noteIdx = 0;

  $('#empty').hidden = parsed.notes.length > 0 || parsed.chords.length > 0;
}

// ---------------------------------------------------------------- song loading
function reparse() {
  if (!current) return;
  const wasPlaying = player.playing;
  parsed = parseSong(current.text, {
    beatsPerBar: current.beatsPerBar,
    beatsPerChord: current.beatsPerChord,
    charsPerBeat: current.charsPerBeat,
  });
  player.setSong(parsed);
  render();
  syncLoopInputs();
  updateInfo();
  if (wasPlaying) player.play(0);
}

function selectSong(id) {
  current = songs.find((s) => s.id === id) || songs[0] || null;
  if (!current) {
    parsed = null;
    render();
    return;
  }
  settings.lastSongId = current.id;
  persistSettings();
  $('#song-select').value = current.id;
  player.setTempo(current.bpm || 90);
  $('#drums').value = current.drums || 'rock';
  $('#bass').value = current.bass || 'root';
  player.settings.drums = $('#drums').value;
  player.settings.bass = $('#bass').value;
  $('#bpb').value = current.beatsPerBar || 4;
  $('#bpc').value = current.beatsPerChord || 4;
  $('#cpb').value = current.charsPerBeat || 4;
  player.settings.loop = false;
  $('#loop').checked = false;
  reparse();
  window.scrollTo({ top: 0 });
}

function fillSongSelect() {
  const sel = $('#song-select');
  sel.innerHTML = songs
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}${s.artist ? ' – ' + escapeHtml(s.artist) : ''}</option>`)
    .join('');
  if (current) sel.value = current.id;
}

function updateSong(fields) {
  Object.assign(current, fields);
  persistSongs();
}

function updateInfo() {
  const bits = [`${parsed.bars} bars`];
  if (parsed.capo) bits.push(`capo ${parsed.capo}`);
  const staves = parsed.blocks.filter((b) => b.type === 'stave').length;
  if (staves) bits.push(`${staves} tab staves`);
  if (parsed.chords.length) bits.push(`${parsed.chords.length} chords`);
  $('#song-info').textContent = bits.join(' · ');
}

// ---------------------------------------------------------------- loop
function syncLoopInputs() {
  const max = parsed ? parsed.bars : 1;
  for (const id of ['#loop-from', '#loop-to']) $(id).max = max;
  $('#loop-from').value = 1;
  $('#loop-to').value = max;
  applyLoop();
}

function applyLoop() {
  const bpb = player.bpb;
  const max = parsed ? parsed.bars : 1;
  let from = Math.max(1, Math.min(max, Number($('#loop-from').value) || 1));
  let to = Math.max(from, Math.min(max, Number($('#loop-to').value) || max));
  $('#loop-from').value = from;
  $('#loop-to').value = to;
  player.settings.loop = $('#loop').checked;
  player.settings.loopStart = (from - 1) * bpb;
  player.settings.loopEnd = to * bpb;
  player.settings.speedUp = Number($('#speedup').value) || 0;
  player.settings.speedUpMax = Number($('#speedup-max').value) || 200;
  document.body.classList.toggle('looping', player.settings.loop);
}

// ---------------------------------------------------------------- transport
function togglePlay() {
  if (!parsed) return;
  if (player.playing) player.pause();
  else player.play();
  updatePlayButton();
}

function updatePlayButton() {
  $('#play').textContent = player.playing ? '❚❚ Pause' : '▶ Play';
  $('#play').classList.toggle('active', player.playing);
}

function setTempo(bpm) {
  player.setTempo(bpm);
}

player.onTempo = (bpm) => {
  $('#bpm').value = bpm;
  $('#bpm-range').value = bpm;
};
player.onEnd = () => updatePlayButton();
player.onLoop = (bpm) => {
  if (current && player.settings.speedUp) {
    $('#bpm').value = bpm;
    $('#bpm-range').value = bpm;
  }
};

const taps = [];
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length >= 3) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setTempo(60000 / avg);
    updateSong({ bpm: player.bpm });
  }
}

// ---------------------------------------------------------------- animation
function frame() {
  requestAnimationFrame(frame);
  if (!parsed || !view) return;
  const pos = player.position;
  const bpb = player.bpb;

  // Bar / beat display.
  const countIn = player.playing && pos < player.countInEnd;
  const beatInBar = Math.floor(((pos % bpb) + bpb) % bpb);
  const bar = Math.floor(pos / bpb) + 1;
  $('#bar').textContent = countIn ? 'Count-in' : `Bar ${Math.min(bar, parsed.bars)} / ${parsed.bars}`;
  const dots = $('#beats').children;
  if (dots.length !== bpb) $('#beats').innerHTML = '<span></span>'.repeat(bpb);
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', player.playing && i === beatInBar);
  $('#beats').classList.toggle('count', countIn);
  $('#progress').style.width = `${Math.max(0, Math.min(100, (pos / parsed.totalBeats) * 100))}%`;

  // Chords.
  const ci = countIn ? -1 : chordIndexAt(parsed.chords, pos);
  if (ci !== view.activeChord) {
    view.chordEls[view.activeChord]?.classList.remove('active');
    view.chordEls[ci]?.classList.add('active');
    view.activeChord = ci;
    const now = parsed.chords[ci];
    const next = parsed.chords[ci + 1] || (countIn ? parsed.chords[chordIndexAt(parsed.chords, player.countInEnd)] : null);
    $('#chord-now').textContent = now ? now.name : '–';
    $('#chord-next').textContent = next ? next.name : '';
  }

  // Tab cursor.
  let activeEl = null;
  for (const s of view.staves) {
    const b = s.block;
    const inside = pos >= b.startBeat && pos < b.endBeat;
    s.cursor.style.display = inside ? 'block' : 'none';
    if (inside) {
      s.cursor.style.transform = `translateX(${beatToCol(b, pos) * view.charWidth}px)`;
      activeEl = s.el;
    }
  }
  if (!activeEl && ci >= 0) activeEl = view.chordEls[ci]?.parentElement;

  // Flash notes as they sound.
  if (pos < view.lastPos - 0.01) {
    view.noteIdx = 0;
    while (view.noteIdx < parsed.notes.length && parsed.notes[view.noteIdx].beat < pos) view.noteIdx++;
  }
  if (player.playing) {
    while (view.noteIdx < parsed.notes.length && parsed.notes[view.noteIdx].beat <= pos) {
      const el = view.noteEls[parsed.notes[view.noteIdx++].id];
      if (el) {
        el.classList.remove('hit');
        void el.offsetWidth; // restart the animation
        el.classList.add('hit');
      }
    }
  }
  view.lastPos = pos;

  // Keep the active part on screen.
  if (activeEl && activeEl !== view.activeBlockEl) {
    view.activeBlockEl?.classList.remove('current');
    activeEl.classList.add('current');
    view.activeBlockEl = activeEl;
    if (settings.follow && player.playing) {
      const r = activeEl.getBoundingClientRect();
      const top = $('#controls').getBoundingClientRect().bottom;
      if (r.top < top + 20 || r.bottom > window.innerHeight - 40) {
        window.scrollBy({ top: r.top - top - window.innerHeight * 0.15, behavior: 'smooth' });
      }
    }
  }
}

// ---------------------------------------------------------------- editor
function openEditor(song) {
  const dlg = $('#editor');
  dlg.dataset.id = song ? song.id : '';
  $('#ed-title').value = song ? song.title : '';
  $('#ed-artist').value = song ? song.artist || '' : '';
  $('#ed-bpm').value = song ? song.bpm || 90 : 90;
  $('#ed-bpb').value = song ? song.beatsPerBar || 4 : 4;
  $('#ed-text').value = song ? song.text : '';
  $('#ed-heading').textContent = song ? 'Edit song' : 'Add a song';
  dlg.showModal();
  (song ? $('#ed-text') : $('#ed-title')).focus();
}

function saveEditor(e) {
  e.preventDefault();
  const dlg = $('#editor');
  const text = $('#ed-text').value;
  const fields = {
    title: $('#ed-title').value.trim() || guessTitle(text) || 'Untitled',
    artist: $('#ed-artist').value.trim(),
    bpm: Number($('#ed-bpm').value) || 90,
    beatsPerBar: Number($('#ed-bpb').value) || 4,
    text,
  };
  let song = songs.find((s) => s.id === dlg.dataset.id);
  if (song) Object.assign(song, fields);
  else {
    song = { id: `song-${Date.now()}`, beatsPerChord: fields.beatsPerBar, charsPerBeat: 4, drums: 'rock', bass: 'root', ...fields };
    songs.push(song);
  }
  persistSongs();
  fillSongSelect();
  dlg.close();
  player.stop();
  selectSong(song.id);
}

function guessTitle(text) {
  const line = text.split('\n').find((l) => l.trim() && !/^\s*\[/.test(l));
  return line ? line.trim().slice(0, 60) : '';
}

// ---------------------------------------------------------------- setup
function init() {
  $('#drums').innerHTML = Object.entries(DRUM_STYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('#bass').innerHTML = Object.entries(BASS_STYLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  // Global settings.
  for (const [k, v] of Object.entries(settings.volumes)) {
    player.setVolume(k, v);
    const input = document.querySelector(`[data-volume="${k}"]`);
    if (input) input.value = v;
  }
  for (const key of ['metronome', 'countIn', 'guitar']) {
    player.settings[key] = settings[key];
    $(`#${key}`).checked = settings[key];
  }
  $('#follow').checked = settings.follow;

  // Events.
  $('#play').addEventListener('click', togglePlay);
  $('#stop').addEventListener('click', () => {
    player.stop();
    updatePlayButton();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#bpm-range').addEventListener('input', (e) => setTempo(Number(e.target.value)));
  $('#bpm').addEventListener('change', (e) => setTempo(Number(e.target.value)));
  for (const el of [$('#bpm-range'), $('#bpm')]) el.addEventListener('change', () => updateSong({ bpm: player.bpm }));
  $('#slower').addEventListener('click', () => {
    setTempo(player.bpm - 5);
    updateSong({ bpm: player.bpm });
  });
  $('#faster').addEventListener('click', () => {
    setTempo(player.bpm + 5);
    updateSong({ bpm: player.bpm });
  });
  $('#tap').addEventListener('click', tapTempo);

  for (const key of ['metronome', 'countIn', 'guitar']) {
    $(`#${key}`).addEventListener('change', (e) => {
      player.settings[key] = e.target.checked;
      settings[key] = e.target.checked;
      persistSettings();
    });
  }
  $('#follow').addEventListener('change', (e) => {
    settings.follow = e.target.checked;
    persistSettings();
  });
  document.querySelectorAll('[data-volume]').forEach((input) =>
    input.addEventListener('input', () => {
      player.setVolume(input.dataset.volume, Number(input.value));
      settings.volumes[input.dataset.volume] = Number(input.value);
      persistSettings();
    }),
  );
  $('#drums').addEventListener('change', (e) => {
    player.settings.drums = e.target.value;
    updateSong({ drums: e.target.value });
  });
  $('#bass').addEventListener('change', (e) => {
    player.settings.bass = e.target.value;
    updateSong({ bass: e.target.value });
  });
  for (const [id, field] of [['#bpb', 'beatsPerBar'], ['#bpc', 'beatsPerChord'], ['#cpb', 'charsPerBeat']]) {
    $(id).addEventListener('change', (e) => {
      const v = Math.max(1, Math.min(32, Number(e.target.value) || 4));
      e.target.value = v;
      updateSong({ [field]: v });
      reparse();
    });
  }

  for (const id of ['#loop', '#loop-from', '#loop-to', '#speedup', '#speedup-max']) $(id).addEventListener('change', applyLoop);
  $('#loop-here').addEventListener('click', () => {
    const bar = Math.max(1, Math.floor(player.position / player.bpb) + 1);
    $('#loop-from').value = bar;
    $('#loop-to').value = Math.max(bar, Number($('#loop-to').value));
    $('#loop').checked = true;
    applyLoop();
  });

  $('#song-select').addEventListener('change', (e) => {
    player.stop();
    updatePlayButton();
    selectSong(e.target.value);
  });
  $('#new-song').addEventListener('click', () => openEditor(null));
  $('#edit-song').addEventListener('click', () => current && openEditor(current));
  $('#delete-song').addEventListener('click', () => {
    if (!current || !confirm(`Delete "${current.title}"?`)) return;
    player.stop();
    updatePlayButton();
    songs = songs.filter((s) => s !== current);
    persistSongs();
    fillSongSelect();
    selectSong(songs[0]?.id);
  });
  $('#restore-samples').addEventListener('click', () => {
    for (const s of SAMPLES) if (!songs.some((x) => x.id === s.id)) songs.push({ ...s });
    persistSongs();
    fillSongSelect();
  });
  $('#editor-form').addEventListener('submit', saveEditor);
  $('#ed-cancel').addEventListener('click', () => $('#editor').close());

  // Click a note, a chord or a place in the tab to jump there.
  $('#sheet').addEventListener('click', (e) => {
    if (!parsed) return;
    let beat = null;
    const note = e.target.closest('[data-note]');
    const chord = e.target.closest('[data-chord]');
    const stave = e.target.closest('.stave');
    if (note) beat = parsed.notes[note.dataset.note].beat;
    else if (chord) beat = parsed.chords[chord.dataset.chord].beat;
    else if (stave) {
      const col = (e.clientX - stave.getBoundingClientRect().left - stave.clientLeft) / view.charWidth;
      beat = Math.floor(beatAtCol(view.staves[stave.dataset.stave].block, col) * 2) / 2;
    }
    if (beat === null) return;
    player.seek(beat);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!parsed) return;
    const bpb = player.bpb;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      player.seek(Math.floor(player.position / bpb + 1) * bpb);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      player.seek(Math.max(0, (Math.ceil(player.position / bpb) - 2) * bpb));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTempo(player.bpm + 5);
      updateSong({ bpm: player.bpm });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTempo(player.bpm - 5);
      updateSong({ bpm: player.bpm });
    } else if (e.key === 'l' || e.key === 'L') {
      $('#loop').checked = !$('#loop').checked;
      applyLoop();
    } else if (e.key === 'm' || e.key === 'M') {
      $('#metronome').click();
    }
  });

  window.addEventListener('resize', () => {
    if (view) view.charWidth = measureCharWidth($('#sheet'));
  });

  persistSongs();
  fillSongSelect();
  selectSong(settings.lastSongId);
  updatePlayButton();
  requestAnimationFrame(frame);
}

init();
