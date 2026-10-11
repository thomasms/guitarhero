import { parseSong, chordIndexAt } from './parser.js';
import { renderTab, renderText, beatAtClick } from './render.js';
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

// ---------------------------------------------------------------- render
function render() {
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  if (!parsed) return;
  view = settings.textView ? renderText(sheet, parsed) : renderTab(sheet, parsed);
  view.width = sheet.clientWidth;
  view.activeChord = -2; // forces the chord display to update on the next frame
  view.activeBlockEl = null;
  view.activeTrack = null;
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
  const track = view.tracks.find((t) => pos >= t.startBeat && pos < t.endBeat) || null;
  if (track !== view.activeTrack) {
    if (view.activeTrack) view.activeTrack.cursor.style.display = 'none';
    if (track) track.cursor.style.display = 'block';
    view.activeTrack = track;
  }
  if (track) {
    track.cursor.style.transform = `translateX(${track.xAt(pos)}px)`;
    activeEl = track.el;
  }
  if (!activeEl && ci >= 0) activeEl = view.chordEls[ci]?.closest('.lyricline, .chordrow, .line');

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
  $('#ed-url').value = song?.source || '';
  setImportStatus('');
  dlg.showModal();
  (song ? $('#ed-text') : $('#ed-url')).focus();
}

function setImportStatus(message, isError = false) {
  $('#ed-status').textContent = message;
  $('#ed-status').classList.toggle('error', isError);
}

async function importFromUrl() {
  const url = $('#ed-url').value.trim();
  if (!url) return setImportStatus('Paste an Ultimate Guitar link first.', true);
  const button = $('#ed-import');
  button.disabled = true;
  setImportStatus('Importing…');
  try {
    const res = await fetch(`api/ug?url=${encodeURIComponent(url)}`);
    const isJson = (res.headers.get('content-type') || '').includes('json');
    if (!isJson) throw new Error('Import needs the app server. Start the app with "npm start".');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Import failed (${res.status}).`);
    $('#ed-title').value = data.title;
    $('#ed-artist').value = data.artist;
    if (data.bpm) $('#ed-bpm').value = data.bpm;
    $('#ed-text').value = data.text;
    const found = parseSong(data.text);
    setImportStatus(
      `Imported ${data.type ? data.type.toLowerCase() : 'song'}: ${found.chords.length} chords, ` +
        `${found.notes.length} tab notes. Check the details, then click Save.`,
    );
  } catch (err) {
    setImportStatus(err.message === 'Failed to fetch' ? 'Could not reach the app server.' : err.message, true);
  } finally {
    button.disabled = false;
  }
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
    source: $('#ed-url').value.trim(),
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
  $('#textView').checked = !!settings.textView;

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
  $('#textView').addEventListener('change', (e) => {
    settings.textView = e.target.checked;
    persistSettings();
    render();
  });
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
  $('#ed-import').addEventListener('click', importFromUrl);
  $('#ed-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      importFromUrl();
    }
  });

  // Click a note, a chord or a place in the tab to jump there.
  $('#sheet').addEventListener('click', (e) => {
    if (!parsed || !view) return;
    const beat = beatAtClick(view, parsed, e);
    if (beat !== null) player.seek(beat);
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

  // The tab view wraps bars to the page width, so draw it again on resize.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (view && $('#sheet').clientWidth !== view.width) render();
    }, 150);
  });

  persistSongs();
  fillSongSelect();
  selectSong(settings.lastSongId);
  updatePlayButton();
  requestAnimationFrame(frame);
}

init();
