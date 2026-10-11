// Parses tab / chord-sheet text (as copied from Ultimate Guitar or similar)
// into a song model with timed notes and chords.

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Standard open-string pitches (MIDI), listed top line (highest) to bottom.
const DEFAULT_TUNINGS = {
  4: [43, 38, 33, 28], // bass: G D A E
  5: [43, 38, 33, 28, 23], // 5-string bass: G D A E B
  6: [64, 59, 55, 50, 45, 40], // guitar: e B G D A E
  7: [64, 59, 55, 50, 45, 40, 35], // 7-string: + low B
};

const CHORD_RE =
  /^[A-G](?:#|b)?(?:maj|min|mi|m|M|dim|aug|sus|add|\+|°|ø|-)?\d*(?:(?:maj|add|sus|no|b|#|\+|-|M)?\d+)*(?:\([^)\s]*\))?(?:\/[A-G](?:#|b)?)?\*?$/;

const FILLER_RE = /^(?:\||\/|-+|\.+|%|x\d+|\d+x|\(x?\d+x?\)|N\.?C\.?|\(N\.?C\.?\))$/i;

export function pitchClass(name) {
  const m = /^([A-G])([#b]?)/.exec(name);
  if (!m) return null;
  let pc = NOTE_PC[m[1]];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (pc + 12) % 12;
}

export function isChordToken(tok) {
  // Allow chords wrapped in parentheses, e.g. "(Am)".
  const t = tok.replace(/^\((.*)\)$/, '$1');
  return CHORD_RE.test(t);
}

export function parseChord(name) {
  const clean = name.replace(/^\((.*)\)$/, '$1').replace(/\*$/, '');
  const root = pitchClass(clean);
  if (root === null) return null;
  const slash = /\/([A-G][#b]?)$/.exec(clean);
  const bass = slash ? pitchClass(slash[1]) : root;
  const quality = clean.replace(/^[A-G][#b]?/, '').replace(/\/.*$/, '');
  let fifth = 7;
  if (/^(dim|°)|m7?b5|ø/.test(quality)) fifth = 6;
  else if (/^(aug|\+)|#5/.test(quality)) fifth = 8;
  const minor = /^(m(?!aj)|min|mi|-)/.test(quality);
  return { name: clean, root, bass, fifth, minor };
}

export function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const tok of tokens) {
    if (isChordToken(tok)) chords++;
    else if (!FILLER_RE.test(tok)) return false;
  }
  return chords > 0;
}

// Index just after the tab content of a line (its last "|" or "-"), so that
// trailing text such as "x2" or "(repeat)" is ignored.
export function tabEnd(line) {
  return Math.max(line.lastIndexOf('|'), line.lastIndexOf('-')) + 1;
}

// Returns { label, start } where start is the column where tab content begins,
// or null if the line is not a tab line.
export function tabLineInfo(line) {
  const m = /^\s*([A-Ga-g][#b]?)?\s*(\|{1,2}|:)?/.exec(line);
  const label = m[1] || '';
  if (!label && !m[2]) {
    // No label and no leading bar: must start with a dash.
    if (!/^\s*-/.test(line)) return null;
  }
  const start = m[0].length;
  const body = line.slice(start, tabEnd(line));
  if (body.length < 4) return null;
  const dashes = (body.match(/-/g) || []).length;
  if (dashes < 3 || dashes / body.length < 0.3) return null;
  // Mostly dashes, digits and bar lines. Other symbols (h, p, b, ~, L, PM ...)
  // are allowed, but not words.
  const solid = body.replace(/\s/g, '');
  const tabChars = (solid.match(/[-|0-9]/g) || []).length;
  if (tabChars / solid.length < 0.7 || solid.length < body.length * 0.85) return null;
  if (/[A-Za-z]{3,}/.test(body)) return null;
  return { label, start };
}

// A rhythm line above a tab, e.g. "S S S S Q  E  E  H." (W = whole, H = half,
// Q = quarter, E = eighth, S = sixteenth, T = 32nd; "." = dotted).
const RHYTHM_BEATS = { W: 4, H: 2, Q: 1, E: 0.5, S: 0.25, T: 0.125 };

export function isRhythmLine(line) {
  const t = line.trim();
  if (!/^[WHQEST.|\s]+$/.test(t) || /[WHQEST]{2}/.test(t) || !/[WHQST]/.test(t)) return false;
  return (t.match(/[WHQEST]/g) || []).length >= 2;
}

export function parseRhythm(line) {
  const out = [];
  const re = /([WHQEST])(\.?)/g;
  let m;
  while ((m = re.exec(line))) out.push({ col: m.index, beats: RHYTHM_BEATS[m[1]] * (m[2] ? 1.5 : 1) });
  return out;
}

export function cleanText(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\[\/?tab\]/gi, '')
    .replace(/\[ch\]([^[]*?)\[\/ch\]/gi, '$1')
    .replace(/\t/g, '    ');
}

function tuningFor(labels) {
  const n = labels.length;
  const std = DEFAULT_TUNINGS[n] || DEFAULT_TUNINGS[6].slice(0, n);
  return labels.map((label, i) => {
    const ref = std[i] ?? 40;
    const pc = label ? pitchClass(label.toUpperCase()) : null;
    if (pc === null) return ref;
    // Choose the pitch with this pitch class nearest to the standard one.
    let best = ref;
    let bestDist = Infinity;
    for (let midi = ref - 12; midi <= ref + 12; midi++) {
      if (((midi % 12) + 12) % 12 !== pc) continue;
      const d = Math.abs(midi - ref);
      if (d < bestDist) {
        bestDist = d;
        best = midi;
      }
    }
    return best;
  });
}

function splitGroup(group) {
  const n = group.length;
  if (n <= 7) return [group];
  const size = n % 6 === 0 ? 6 : n % 4 === 0 ? 4 : n % 7 === 0 ? 7 : n % 5 === 0 ? 5 : 0;
  if (!size) return [group];
  const out = [];
  for (let i = 0; i < n; i += size) out.push(group.slice(i, i + size));
  return out;
}

// Bar line positions in one line ("||" counts once), with the content start
// and end added as bounds when there is no bar line there.
function lineBars(line, contentStart) {
  const end = tabEnd(line);
  const bars = [];
  for (let c = Math.max(0, contentStart - 1); c < end; c++) {
    if (line[c] === '|' && line[c + 1] !== '|') bars.push(c);
  }
  if (!bars.length || bars[0] > contentStart + 1) bars.unshift(contentStart - 1);
  if (end - 1 - bars[bars.length - 1] >= 2) bars.push(end);
  return bars;
}

const isOnset = (line, c) => /[\dxX]/.test(line[c]) && !/\d/.test(line[c - 1] || '');

// Builds the measures (time map) of a stave. Returns { measures, mapCol }:
// mapCol(string, column) gives the column in the common (reference) layout.
// Lines whose bar lines do not line up (common in hand-made tabs, where "10"
// takes more space on one string) are stretched to match the longest line.
function staveMeasures(lines, contentStart, opts) {
  const perLine = lines.map((l) => lineBars(l, contentStart));
  const same = perLine.every((b) => b.join() === perLine[0].join());
  const sameCount = perLine.every((b) => b.length === perLine[0].length);
  let bounds;
  let mapCol = (s, c) => c;
  if (same) {
    bounds = perLine[0];
  } else if (sameCount && perLine[0].length >= 2) {
    const last = (b) => b[b.length - 1];
    let ref = 0;
    perLine.forEach((b, i) => {
      if (last(b) > last(perLine[ref])) ref = i;
    });
    bounds = perLine[ref];
    mapCol = (s, c) => {
      const b = perLine[s];
      let k = 0;
      while (k + 2 < b.length && c > b[k + 1]) k++;
      const f = (c - b[k]) / (b[k + 1] - b[k]);
      return bounds[k] + f * (bounds[k + 1] - bounds[k]);
    };
  } else {
    // Different bar counts per line: use only the bar lines all lines share.
    const end = Math.max(...lines.map(tabEnd));
    bounds = [contentStart - 1];
    for (let c = contentStart; c < end; c++) {
      if (lines.every((l) => l[c] === '|') && lines.some((l) => l[c + 1] !== '|')) bounds.push(c);
    }
    if (end - 1 - bounds[bounds.length - 1] >= 2) bounds.push(end);
  }

  const segments = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const colStart = bounds[i] + 1;
    const colEnd = bounds[i + 1];
    if (colEnd - colStart >= 2) segments.push({ colStart, colEnd });
  }
  if (!segments.length) segments.push({ colStart: contentStart, colEnd: contentStart + 2 });

  // Note start columns, in the common layout.
  const onsets = new Set();
  lines.forEach((l, s) => {
    for (let c = contentStart; c < tabEnd(l); c++) if (isOnset(l, c)) onsets.add(Math.round(mapCol(s, c)));
  });

  const useBars = segments.length >= 2;
  const measures = segments.map((seg) => {
    // Most tabs pad each bar with one leading dash ("|-0---2---|"): skip it.
    const lead = onsets.has(seg.colStart) ? 0 : 1;
    const width = seg.colEnd - seg.colStart;
    // Without bar lines, guess the length from the width, rounded to whole bars
    // so that the tab stays in step with the bars (and the drums).
    const bpb = opts.beatsPerBar;
    const beats = useBars ? bpb : Math.max(1, Math.round(width / opts.charsPerBeat / bpb)) * bpb;
    const m = { ...seg, lead, beats, beatsPerCol: beats / width };
    if (useBars) m.beatsPerCol = gridScale([...onsets], m) ?? m.beatsPerCol;
    return m;
  });
  return { measures, mapCol };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Guess the rhythmic grid of a bar from the spacing of its notes. For example
// "|-0---0---0---0---|" has notes every 4 columns, so 4 slots = 4 beats.
// Returns beats per column, or null if no clear grid is found.
function gridScale(onsetCols, m) {
  const onsets = new Set();
  for (const c of onsetCols) if (c >= m.colStart + m.lead && c < m.colEnd) onsets.add(c - m.colStart - m.lead);
  const rel = [...onsets].sort((a, b) => a - b);
  if (rel.length < 2) return null;
  let d = 0;
  for (let i = 1; i < rel.length; i++) d = gcd(rel[i] - rel[i - 1], d);
  if (rel[0]) d = gcd(rel[0], d);
  const estimate = (m.colEnd - m.colStart - m.lead) / d;
  const minSlots = rel[rel.length - 1] / d + 1;
  let best = null;
  for (const sub of [1, 2, 3, 4, 6, 8]) {
    const slots = m.beats * sub;
    if (slots < minSlots) continue;
    if (!best || Math.abs(slots - estimate) < Math.abs(best - estimate)) best = slots;
  }
  if (!best || Math.abs(best - estimate) / estimate > 0.25) return null;
  return m.beats / (best * d);
}

function colToBeat(measures, col) {
  for (const m of measures) {
    if (col < m.colEnd || m === measures[measures.length - 1]) {
      const c = Math.max(m.colStart + m.lead, Math.min(col, m.colEnd));
      return m.startBeat + Math.min(m.beats, (c - m.colStart - m.lead) * m.beatsPerCol);
    }
  }
  return 0;
}

// Uses a rhythm line (one letter per note) for exact timing. Only applied
// when the number of letters matches the number of note starts.
function applyRhythm(staveNotes, measures, rhythm) {
  if (!rhythm) return;
  const beats = [...new Set(staveNotes.map((n) => n.beat))].sort((a, b) => a - b);
  if (beats.length !== rhythm.length) return;
  const map = new Map();
  let prev = null;
  beats.forEach((b, i) => {
    const m = measures.find((x) => b >= x.startBeat - 1e-6 && b < x.startBeat + x.beats - 1e-6) || measures[measures.length - 1];
    const end = m.startBeat + m.beats;
    let nb = b;
    if (prev && prev.m === m) nb = Math.min(prev.beat + rhythm[i - 1].beats, end - 0.125);
    map.set(b, nb);
    prev = { m, beat: nb };
  });
  for (const n of staveNotes) n.beat = map.get(n.beat);
}

// Snap to a 16th-note grid: ASCII tab spacing is only approximate.
const quantize = (beat) => Math.round(beat * 4) / 4;

export function findChords(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    if (isChordToken(m[0])) {
      const chord = parseChord(m[0]);
      if (chord) out.push({ ...chord, col: m.index, len: m[0].length });
    }
  }
  return out;
}

export const DEFAULT_OPTIONS = { beatsPerBar: 4, beatsPerChord: 4, charsPerBeat: 4 };

export function parseSong(rawText, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines = cleanText(rawText).split('\n');

  const capoMatch = /capo[^\d\n]{0,12}(\d{1,2})/i.exec(lines.join('\n'));
  const capo = opts.capo ?? (capoMatch ? Number(capoMatch[1]) : 0);

  // 1. Classify lines.
  const info = lines.map((l) => tabLineInfo(l));
  const kinds = lines.map((l, i) => {
    if (info[i]) return 'tab';
    if (!l.trim()) return 'blank';
    if (/^\s*\[[^\]]+\]\s*$/.test(l)) return 'section';
    if (isRhythmLine(l)) return 'rhythm';
    if (isChordLine(l)) return 'chords';
    return 'text';
  });

  // 2. Group consecutive tab lines into staves (min 4 lines).
  const staveAt = new Map(); // first line index -> line indices
  for (let i = 0; i < lines.length; ) {
    if (kinds[i] !== 'tab') {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && kinds[j] === 'tab') j++;
    const group = [];
    for (let k = i; k < j; k++) group.push(k);
    if (group.length >= 4) {
      for (const g of splitGroup(group)) {
        if (g.length >= 4) staveAt.set(g[0], g);
        else g.forEach((k) => (kinds[k] = 'text'));
      }
    } else {
      group.forEach((k) => (kinds[k] = 'text'));
    }
    i = j;
  }

  // A rhythm line just above a stave (or above its chord line), or just below it.
  const rhythmFor = (first, count) => {
    for (const k of [first - 1, first - 2, first + count]) {
      if (kinds[k] === 'rhythm' && (k !== first - 2 || kinds[first - 1] === 'chords')) return parseRhythm(lines[k]);
    }
    return null;
  };

  // 3. Walk the lines and build the timeline.
  const blocks = [];
  const notes = [];
  const chords = [];
  let beat = 0;

  for (let i = 0; i < lines.length; i++) {
    const kind = kinds[i];
    if (staveAt.has(i)) {
      const idx = staveAt.get(i);
      const sLines = idx.map((k) => lines[k]);
      const contentStart = Math.max(...idx.map((k) => info[k].start));
      const { measures, mapCol } = staveMeasures(sLines, contentStart, opts);
      let b = beat;
      for (const m of measures) {
        m.startBeat = b;
        b += m.beats;
      }
      const tuning = tuningFor(idx.map((k) => info[k].label));
      const stave = {
        type: 'stave',
        index: blocks.filter((x) => x.type === 'stave').length,
        lineStart: i,
        lineCount: idx.length,
        tuning,
        measures,
        startBeat: beat,
        endBeat: b,
      };

      // Chord line directly above the stave is attached to it.
      const above = blocks[blocks.length - 1];
      if (above && above.type === 'chords' && above.line === i - 1 && !above.timed) {
        above.timed = true;
        for (const c of above.chords) {
          c.beat = quantize(colToBeat(measures, c.col));
          chords.push(c);
        }
      }

      const staveNotes = [];
      sLines.forEach((line, s) => {
        const end = tabEnd(line);
        for (let c = contentStart; c < end; c++) {
          const ch = line[c];
          let fret = null;
          let len = 1;
          if (/\d/.test(ch)) {
            fret = Number(ch);
            if (/\d/.test(line[c + 1] || '') && Number(ch + line[c + 1]) <= 24) {
              fret = Number(ch + line[c + 1]);
              len = 2;
            }
          } else if (ch === 'x' || ch === 'X') {
            fret = 'x';
          }
          if (fret === null) continue;
          const note = {
            beat: quantize(colToBeat(measures, mapCol(s, c))),
            string: s,
            fret,
            muted: fret === 'x',
            // Technique to the next note: hammer-on, pull-off, slide, bend, vibrato, release.
            tech: /[hpb\/\\~r]/.test(line[c + len] || '') ? line[c + len] : '',
            midi: fret === 'x' ? tuning[s] + capo : tuning[s] + fret + capo,
            line: idx[s],
            col: c,
            len,
            stave: stave.index,
          };
          staveNotes.push(note);
          c += len - 1;
        }
      });
      applyRhythm(staveNotes, measures, rhythmFor(i, idx.length));

      // Note length: until the next note on the same string (max 4 beats).
      staveNotes.sort((a, b2) => a.beat - b2.beat || a.string - b2.string);
      for (const n of staveNotes) {
        const next = staveNotes.find((o) => o.string === n.string && o.beat > n.beat);
        n.duration = Math.min(4, (next ? next.beat : stave.endBeat) - n.beat) || 0.5;
        if (n.muted) n.duration = 0.1;
      }
      notes.push(...staveNotes);
      blocks.push(stave);
      beat = b;
      i += idx.length - 1;
      continue;
    }

    if (kind === 'chords') {
      const found = findChords(lines[i]).map((c) => ({ ...c, line: i }));
      const block = { type: 'chords', line: i, chords: found, timed: false };
      blocks.push(block);
      // If a stave follows directly, the stave will time these chords.
      if (!staveAt.has(i + 1)) {
        block.timed = true;
        block.startBeat = beat;
        for (const c of found) {
          c.beat = beat;
          chords.push(c);
          beat += opts.beatsPerChord;
        }
        block.endBeat = beat;
      }
      continue;
    }

    blocks.push({ type: kind, line: i });
  }

  chords.forEach((c, n) => (c.id = n));
  notes.sort((a, b) => a.beat - b.beat);
  notes.forEach((n, k) => (n.id = k));

  // Pad the end to a whole bar.
  const totalBeats = Math.ceil(beat / opts.beatsPerBar) * opts.beatsPerBar;

  return {
    lines,
    kinds,
    blocks,
    notes,
    chords: chords.sort((a, b) => a.beat - b.beat),
    totalBeats,
    bars: totalBeats / opts.beatsPerBar,
    capo,
    options: opts,
  };
}

// Returns the beat for a column inside a stave (for click-to-seek).
export function beatAtCol(stave, col) {
  return colToBeat(stave.measures, col);
}

// Returns the column for a beat inside a stave (for the cursor).
export function beatToCol(stave, beat) {
  for (const m of stave.measures) {
    if (beat < m.startBeat + m.beats || m === stave.measures[stave.measures.length - 1]) {
      const rel = Math.max(0, Math.min(m.beats, beat - m.startBeat));
      return Math.min(m.colEnd, m.colStart + m.lead + rel / m.beatsPerCol);
    }
  }
  return 0;
}

// Index of the active chord at a beat (binary search), or -1.
export function chordIndexAt(chords, beat) {
  let lo = 0;
  let hi = chords.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].beat <= beat + 1e-6) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
