import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSong, parseChord, isChordLine, tabLineInfo, beatToCol, chordIndexAt, isRhythmLine } from '../src/parser.js';

test('chord parsing', () => {
  assert.equal(parseChord('Am').root, 9);
  assert.equal(parseChord('Am').minor, true);
  assert.equal(parseChord('F#m7/C#').bass, 1);
  assert.equal(parseChord('Bdim').fifth, 6);
  assert.equal(parseChord('Cmaj7').minor, false);
});

test('chord line detection', () => {
  assert.ok(isChordLine('Am        F    C   G'));
  assert.ok(isChordLine('  G  D/F#  Em7 | Cadd9  x2'));
  assert.ok(!isChordLine('A house in New Orleans'));
  assert.ok(!isChordLine('I am a man'));
});

test('tab line detection', () => {
  assert.ok(tabLineInfo('e|-----0-----|'));
  assert.ok(tabLineInfo('D|--2h4--5---|-----| x2'));
  assert.ok(tabLineInfo('|---3---5---|'));
  assert.equal(tabLineInfo('Hello there'), null);
});

const TAB = `[Intro]
   Am              C
e|-------0-------|-------0-------|
B|-----1---1-----|-----1---1-----|
G|---2-------2---|---0-------0---|
D|-----------2---|---------------|
A|-0-------------|---3-----------|
E|---------------|---------------|
`;

test('tab stave parsing with bars', () => {
  const song = parseSong(TAB);
  const staves = song.blocks.filter((b) => b.type === 'stave');
  assert.equal(staves.length, 1);
  assert.equal(staves[0].measures.length, 2);
  assert.equal(song.totalBeats, 8);
  const first = song.notes[0];
  assert.equal(first.beat, 0);
  assert.equal(first.midi, 45); // open A
  assert.equal(song.chords.map((c) => c.name).join(' '), 'Am C');
  assert.equal(song.chords[1].beat, 4);
  // high e open string is E4 = 64
  assert.ok(song.notes.some((n) => n.string === 0 && n.midi === 64));
});

test('drop D and two-digit frets', () => {
  const song = parseSong(`e|--12--|\nB|------|\nG|------|\nD|------|\nA|------|\nD|--0---|`);
  const notes = song.notes;
  assert.equal(notes.find((n) => n.string === 0).fret, 12);
  assert.equal(notes.find((n) => n.string === 5).midi, 38);
});

test('chord sheet timing and capo', () => {
  const song = parseSong(`Capo: 2\n[Verse]\nAm      C\nThere is a house\nD       F\nin New Orleans`, { beatsPerChord: 4 });
  assert.equal(song.capo, 2);
  assert.deepEqual(song.chords.map((c) => c.beat), [0, 4, 8, 12]);
  assert.equal(song.totalBeats, 16);
  assert.equal(chordIndexAt(song.chords, 5), 1);
  assert.equal(chordIndexAt(song.chords, -1), -1);
});

test('ultimate guitar markup is stripped', () => {
  const song = parseSong('[tab][ch]G[/ch]    [ch]Em[/ch]\nHello world[/tab]');
  assert.equal(song.lines[0], 'G    Em');
  assert.equal(song.chords.length, 2);
});

test('beatToCol is inverse of note placement', () => {
  const song = parseSong(TAB);
  const stave = song.blocks.find((b) => b.type === 'stave');
  for (const n of song.notes) assert.ok(Math.abs(beatToCol(stave, n.beat) - n.col) < 1.5);
});

test('stacked staves without blank lines are split', () => {
  const s = 'e|--0--|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nE|-----|\n';
  const song = parseSong(s + s);
  assert.equal(song.blocks.filter((b) => b.type === 'stave').length, 2);
});

test('chords know their line', () => {
  const song = parseSong(TAB + '\nG   D\nla la');
  assert.ok(song.chords.every((c) => Number.isInteger(c.line)));
});

// From a real tab: "L" (let ring) marks, "||" after the string names, bar
// lines that do not line up because of two-digit frets, and a rhythm line.
const CONTUSION = `  S S S S Q  E  E  H       S S S S Q  E  E  H
E||-----------------------------|-----------------------------------|
B||-----------------------------|-----------------------------------|
G||------6-8-9----5--7~--L--------|--------10-12-13----9--11~--L--------|
D||--6-8------------------------|--10-12----------------------------|
A||-----------------------------|-----------------------------------|
E||-----------------------------|-----------------------------------|
`;

test('messy real-world tab is read as one 6-string stave', () => {
  const song = parseSong(CONTUSION);
  assert.equal(song.kinds[0], 'rhythm');
  const staves = song.blocks.filter((b) => b.type === 'stave');
  assert.equal(staves.length, 1);
  assert.equal(staves[0].tuning.length, 6);
  assert.equal(staves[0].measures.length, 2);
  const g = song.notes.filter((n) => n.string === 2).map((n) => n.fret);
  assert.deepEqual(g, [6, 8, 9, 5, 7, 10, 12, 13, 9, 11]);
  // Notes keep their order in time, and each bar's notes stay in that bar.
  const beats = song.notes.map((n) => n.beat);
  assert.deepEqual(beats, [...beats].sort((a, b) => a - b));
  assert.ok(song.notes.slice(0, 7).every((n) => n.beat < 4));
  assert.ok(song.notes.slice(7).every((n) => n.beat >= 4));
});

test('rhythm lines are detected but words are not', () => {
  assert.ok(isRhythmLine('  S S S S Q  E  E  H'));
  assert.ok(isRhythmLine('Q.  E  H'));
  assert.ok(!isRhythmLine('THE END'));
  assert.ok(!isRhythmLine('E  A  E'));
});

test('rhythm line sets exact timing when it matches the notes', () => {
  const song = parseSong(`Q   E E Q   Q\ne|-0---1-3-0---2---|\nB|-----------------|\nG|-----------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|`);
  assert.deepEqual(song.notes.map((n) => n.beat), [0, 1, 1.5, 2, 3]);
});

test('annotation letters in a tab line do not break the stave', () => {
  assert.ok(tabLineInfo('G|--5~--L----PM---|'));
  assert.equal(tabLineInfo('---- Chorus ----'), null);
});
