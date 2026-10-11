// Draws a parsed song into the page.
//
// renderTab(): a clean, standard look. Tab is drawn as real string lines with
// fret-number markers, spaced by beat and wrapped to the page width. Chord
// sheets show chord labels above the lyrics.
// renderText(): the original text, as pasted.
//
// Both return a view: { noteEls, chordEls, tracks, beatAtClick(event) }.
// A track is a part of the page with a play cursor:
//   { startBeat, endBeat, el, cursor, xAt(beat) }

import { beatToCol, beatAtCol } from './parser.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const TECH_LABEL = { h: 'h', p: 'p', '/': '/', '\\': '\\', b: 'b', r: 'r', '~': '~' };
const META_RE = /^\s*(capo|tuning|key|tempo|bpm|difficulty)\s*:/i;

const STRING_GAP = 20; // px between strings
const TOP = 26; // px above the top string (chord names)
const BOTTOM = 28; // px below the bottom string (bar numbers)
const LABEL_W = 26; // px for the string names
const PAD = 16; // px between a bar line and its first note
const BASE_PX_PER_BEAT = 56;
const MIN_NOTE_GAP = 30; // px between notes that follow each other

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function emptyView() {
  return { noteEls: [], chordEls: [], tracks: [] };
}

// ------------------------------------------------------------------ tab view

// Consecutive staves (only blank lines between) form one flowing system.
function groupStaves(blocks) {
  const groups = new Map(); // first stave block -> list of stave blocks
  let currentGroup = null;
  for (const b of blocks) {
    if (b.type === 'stave') {
      const prev = currentGroup && currentGroup[currentGroup.length - 1];
      if (prev && prev.tuning.length === b.tuning.length) currentGroup.push(b);
      else {
        currentGroup = [b];
        groups.set(b, currentGroup);
      }
    } else if (b.type === 'blank' || b.type === 'rhythm' || (b.type === 'chords' && b.startBeat === undefined)) {
      // Blank lines, rhythm lines and chord lines attached to a stave do not break the flow.
    } else {
      currentGroup = null;
    }
  }
  return groups;
}

// Splits staves into bar-sized segments with a horizontal scale each.
function segmentsFor(staves, notes, bpb) {
  const segs = [];
  for (const stave of staves) {
    for (const m of stave.measures) {
      for (let start = m.startBeat; start < m.startBeat + m.beats - 1e-6; start += bpb) {
        const beats = Math.min(bpb, m.startBeat + m.beats - start);
        segs.push({ start, beats, end: start + beats, stave });
      }
    }
  }
  for (const seg of segs) {
    const onsets = [...new Set(notes.filter((n) => n.stave === seg.stave.index && n.beat >= seg.start - 1e-6 && n.beat < seg.end - 1e-6).map((n) => n.beat))].sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < onsets.length; i++) gap = Math.min(gap, onsets[i] - onsets[i - 1]);
    seg.ppb = Math.min(220, Math.max(BASE_PX_PER_BEAT, MIN_NOTE_GAP / gap));
    seg.width = PAD + seg.beats * seg.ppb;
  }
  return segs;
}

function renderTabGroup(container, staves, song, view, maxWidth) {
  const bpb = song.options.beatsPerBar;
  const strings = staves[0].tuning.length;
  const staveIdx = new Set(staves.map((s) => s.index));
  const notes = song.notes.filter((n) => staveIdx.has(n.stave));
  const segs = segmentsFor(staves, notes, bpb);
  const chords = song.chords.filter((c) => c.beat >= staves[0].startBeat && c.beat < staves[staves.length - 1].endBeat && staves.some((s) => c.line === s.lineStart - 1));
  const stringsH = (strings - 1) * STRING_GAP;

  // Pack bar segments into rows that fit the page width.
  const rows = [];
  let row = null;
  for (const seg of segs) {
    if (!row || (row.width + seg.width > maxWidth && row.segs.length)) {
      row = { segs: [], width: LABEL_W };
      rows.push(row);
    }
    seg.x = row.width;
    row.width += seg.width;
    row.segs.push(seg);
  }

  // Stretch each row to the full width. The last row only when it is nearly full.
  rows.forEach((r, i) => {
    const used = r.width - LABEL_W;
    const target = maxWidth - LABEL_W;
    if (used <= 0 || (i === rows.length - 1 && used < target * 0.7)) return;
    const f = target / used;
    let x = LABEL_W;
    for (const seg of r.segs) {
      const width = seg.width * f;
      seg.ppb = (width - PAD) / seg.beats;
      seg.width = width;
      seg.x = x;
      x += width;
    }
    r.width = x;
  });

  const noteX = new Map();
  for (const r of rows) {
    const div = el('div', 'trow');
    div.style.height = `${TOP + stringsH + BOTTOM}px`;
    div.style.width = `${Math.ceil(r.width) + 1}px`;
    const xAt = (beat) => {
      let s = r.segs[0];
      for (const x of r.segs) if (beat >= x.start - 1e-6) s = x;
      const rel = Math.max(0, Math.min(s.beats, beat - s.start));
      return s.x + PAD + rel * s.ppb;
    };

    // String names and lines.
    staves[0].tuning.forEach((midi, s) => {
      const y = TOP + s * STRING_GAP;
      const name = NOTE_NAMES[midi % 12];
      // Tab convention: the high E string is a lowercase "e".
      const label = el('span', 'tlabel', midi >= 64 && name === 'E' ? 'e' : name);
      label.style.top = `${y}px`;
      div.appendChild(label);
      const line = el('div', 'tstring');
      line.style.top = `${y}px`;
      line.style.left = `${LABEL_W}px`;
      line.style.width = `${r.width - LABEL_W}px`;
      div.appendChild(line);
    });

    // Bar lines and bar numbers.
    const bar = (x, cls = 'tbar') => {
      const b = el('div', cls);
      b.style.left = `${x}px`;
      b.style.top = `${TOP}px`;
      b.style.height = `${stringsH}px`;
      div.appendChild(b);
    };
    bar(LABEL_W, 'tbar first');
    for (const s of r.segs) {
      bar(s.x + s.width);
      if (Math.abs(s.start % bpb) < 1e-6) {
        const num = el('span', 'tbarnum', String(Math.floor(s.start / bpb) + 1));
        num.style.left = `${s.x + 4}px`;
        num.style.top = `${TOP + stringsH + 12}px`;
        div.appendChild(num);
      }
    }

    // Notes.
    const rowStart = r.segs[0].start;
    const rowEnd = r.segs[r.segs.length - 1].end;
    for (const n of notes) {
      if (n.beat < rowStart - 1e-6 || n.beat >= rowEnd - 1e-6) continue;
      const x = xAt(n.beat);
      noteX.set(n.id, { x, row: div });
      const span = el('span', `tnote${n.muted ? ' muted' : ''}`, n.muted ? '×' : String(n.fret));
      span.dataset.note = n.id;
      span.style.left = `${x}px`;
      span.style.top = `${TOP + n.string * STRING_GAP}px`;
      div.appendChild(span);
      view.noteEls[n.id] = span;
    }

    // Chord names above the tab.
    for (const c of chords) {
      if (c.beat < rowStart - 1e-6 || c.beat >= rowEnd - 1e-6) continue;
      const span = el('span', 'chord tchord', escapeHtml(c.name));
      span.dataset.chord = c.id;
      span.style.left = `${xAt(c.beat)}px`;
      div.appendChild(span);
      view.chordEls[c.id] = span;
    }

    const cursor = el('div', 'tcursor');
    cursor.style.top = `${TOP - 8}px`;
    cursor.style.height = `${stringsH + 16}px`;
    div.appendChild(cursor);
    container.appendChild(div);

    view.tracks.push({
      startBeat: rowStart,
      endBeat: rowEnd,
      el: div,
      cursor,
      xAt,
      beatAtX: (x) => {
        let s = r.segs[0];
        for (const seg of r.segs) if (x >= seg.x) s = seg;
        return s.start + Math.max(0, Math.min(s.beats, (x - s.x - PAD) / s.ppb));
      },
    });
  }

  // Technique marks (h, p, /, b ...) between a note and the next on its string.
  for (const n of notes) {
    if (!n.tech || !noteX.has(n.id)) continue;
    const here = noteX.get(n.id);
    const next = notes.find((o) => o.string === n.string && o.beat > n.beat);
    const there = next && noteX.get(next.id);
    // Vibrato belongs to its own note; the others connect two notes.
    const x = n.tech !== '~' && there && there.row === here.row ? (here.x + there.x) / 2 : here.x + 15;
    const mark = el('span', 'ttech', escapeHtml(TECH_LABEL[n.tech] || n.tech));
    mark.style.left = `${x}px`;
    mark.style.top = `${TOP + n.string * STRING_GAP - 14}px`;
    here.row.appendChild(mark);
  }
}

function chordSpan(c) {
  const span = el('span', 'chord', escapeHtml(c.name));
  span.dataset.chord = c.id;
  return span;
}

export function renderTab(sheet, song) {
  const view = emptyView();
  sheet.classList.add('pretty');
  sheet.classList.remove('raw');
  const style = getComputedStyle(sheet);
  const maxWidth = Math.max(320, sheet.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2);
  const groups = groupStaves(song.blocks);
  const chordById = new Map(song.chords.map((c) => [c.line + ':' + c.col, c]));
  const used = new Set(); // lines already drawn

  // Capo, tuning, key ... as small badges at the top.
  const metas = song.lines.map((l, i) => [l, i]).filter(([l, i]) => META_RE.test(l) && song.kinds[i] === 'text');
  if (metas.length) {
    const box = el('div', 'meta');
    for (const [l, i] of metas) {
      const [k, ...v] = l.split(':');
      box.appendChild(el('span', 'badge', `<b>${escapeHtml(k.trim())}</b> ${escapeHtml(v.join(':').trim())}`));
      used.add(i);
    }
    sheet.appendChild(box);
  }

  let lastWasSpace = true;
  const blocks = song.blocks;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.type === 'stave') {
      if (groups.has(b)) {
        const wrap = el('div', 'tabgroup');
        sheet.appendChild(wrap);
        renderTabGroup(wrap, groups.get(b), song, view, maxWidth);
        lastWasSpace = false;
      }
      continue;
    }
    if (used.has(b.line) || b.type === 'rhythm') continue; // rhythm is shown by the spacing

    if (b.type === 'blank') {
      if (!lastWasSpace) sheet.appendChild(el('div', 'spacer'));
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;

    if (b.type === 'section') {
      sheet.appendChild(el('h3', 'section', escapeHtml(song.lines[b.line].trim().replace(/^\[|\]$/g, ''))));
      continue;
    }

    if (b.type === 'chords') {
      if (b.startBeat === undefined) continue; // drawn with its tab
      const chords = b.chords.map((c) => chordById.get(c.line + ':' + c.col) || c);
      const next = blocks[k + 1];
      if (next && next.type === 'text' && next.line === b.line + 1 && !META_RE.test(song.lines[next.line])) {
        // Chords above lyrics: split the lyric at each chord position.
        const lyric = song.lines[next.line];
        const line = el('div', 'lyricline');
        const first = chords[0].col;
        if (first > 0 && lyric.slice(0, first).trim()) {
          const seg = el('span', 'seg');
          seg.append(el('span', 'chord empty', '&nbsp;'), el('span', 'lyr', escapeHtml(lyric.slice(0, first))));
          line.appendChild(seg);
        }
        chords.forEach((c, i) => {
          const end = i + 1 < chords.length ? chords[i + 1].col : lyric.length;
          const seg = el('span', 'seg');
          const span = chordSpan(c);
          seg.append(span, el('span', 'lyr', escapeHtml(lyric.slice(c.col, Math.max(c.col, end))) || '&nbsp;'));
          line.appendChild(seg);
          if (c.id !== undefined) view.chordEls[c.id] = span;
        });
        sheet.appendChild(line);
        used.add(next.line);
      } else {
        const line = el('div', 'chordrow');
        for (const c of chords) {
          const span = chordSpan(c);
          line.appendChild(span);
          if (c.id !== undefined) view.chordEls[c.id] = span;
        }
        sheet.appendChild(line);
      }
      continue;
    }

    sheet.appendChild(el('p', 'textline', escapeHtml(song.lines[b.line])));
  }
  return view;
}

// ------------------------------------------------------------------ text view

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

function measureCharWidth(container) {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(100);
  probe.style.visibility = 'hidden';
  probe.style.position = 'absolute';
  container.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return w;
}

export function renderText(sheet, song) {
  const view = emptyView();
  sheet.classList.add('raw');
  sheet.classList.remove('pretty');

  const spansByLine = new Map();
  const addSpan = (line, span) => {
    if (!spansByLine.has(line)) spansByLine.set(line, []);
    spansByLine.get(line).push(span);
  };
  for (const n of song.notes) addSpan(n.line, { col: n.col, len: n.len, cls: 'note', kind: 'note', id: n.id });
  for (const c of song.chords) addSpan(c.line, { col: c.col, len: c.len, cls: 'chord', kind: 'chord', id: c.id });

  const makeLine = (i, cls) => el('div', `line ${cls}`, lineHtml(song.lines[i], spansByLine.get(i) || []));
  const charWidth = measureCharWidth(sheet);

  for (const b of song.blocks) {
    if (b.type === 'stave') {
      const wrap = el('div', 'stave');
      for (let k = 0; k < b.lineCount; k++) wrap.appendChild(makeLine(b.lineStart + k, 'tab'));
      const cursor = el('div', 'cursor');
      wrap.appendChild(cursor);
      sheet.appendChild(wrap);
      view.tracks.push({
        startBeat: b.startBeat,
        endBeat: b.endBeat,
        el: wrap,
        cursor,
        xAt: (beat) => beatToCol(b, beat) * charWidth,
        beatAtX: (x) => beatAtCol(b, x / charWidth),
      });
    } else {
      sheet.appendChild(makeLine(b.line, b.type));
    }
  }
  sheet.querySelectorAll('[data-chord]').forEach((e) => (view.chordEls[e.dataset.chord] = e));
  sheet.querySelectorAll('[data-note]').forEach((e) => (view.noteEls[e.dataset.note] = e));
  return view;
}

// Finds the beat for a click in the sheet, or null.
export function beatAtClick(view, song, event) {
  const note = event.target.closest('[data-note]');
  if (note) return song.notes[note.dataset.note].beat;
  const chord = event.target.closest('[data-chord]');
  if (chord) return song.chords[chord.dataset.chord].beat;
  const track = view.tracks.find((t) => t.el.contains(event.target));
  if (!track) return null;
  const x = event.clientX - track.el.getBoundingClientRect().left;
  return Math.floor(track.beatAtX(x) * 2) / 2;
}
