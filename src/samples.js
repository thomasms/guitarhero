// Built-in example songs. Both are free to use: an original practice riff
// and a public-domain hymn.

export const SAMPLES = [
  {
    id: 'sample-riff',
    title: 'Practice riff in A minor',
    artist: 'Example',
    bpm: 80,
    beatsPerBar: 4,
    beatsPerChord: 4,
    charsPerBeat: 4,
    drums: 'halftime',
    bass: 'root',
    text: `[Intro]
   Am                F                 C                 G
e|---------0-------|-------1---------|---------0-------|-----------3-----|
B|-------1---1-----|-----1---1-------|-------1---1-----|---------0---0---|
G|-----2-------2---|---2-------2---2-|-----0-------0---|-------0-------0-|
D|---2-----------2-|-3-----------3---|---2-----------2-|-----0-----------|
A|-0---------------|-----------------|-3---------------|---2-------------|
E|-----------------|-----------------|-----------------|-3---------------|

   Am                F                 G                 Am
e|---------0-------|-------1---------|-----------3-----|---------0-------|
B|-------1---1-----|-----1---1-------|---------0---0---|-------1---1-----|
G|-----2-------2---|---2-------2---2-|-------0-------0-|-----2-------2---|
D|---2-----------2-|-3-----------3---|-----0-----------|---2-----------2-|
A|-0---------------|-----------------|---2-------------|-0---------------|
E|-----------------|-----------------|-3---------------|-----------------|

[Strum the same chords]
Am      F       C       G
Am      F       G       Am
`,
  },
  {
    id: 'sample-amazing-grace',
    title: 'Amazing Grace',
    artist: 'Traditional',
    bpm: 90,
    beatsPerBar: 3,
    beatsPerChord: 3,
    charsPerBeat: 4,
    drums: 'halftime',
    bass: 'rootfifth',
    text: `[Verse 1]
G           G7        C        G
Amazing grace, how sweet the sound
G            Em        D       D7
That saved a wretch like me
G           G7        C        G
I once was lost, but now am found
G      Em     D     G
Was blind, but now I see

[Verse 2]
G           G7        C        G
'Twas grace that taught my heart to fear
G            Em        D       D7
And grace my fears relieved
G           G7        C        G
How precious did that grace appear
G      Em     D     G
The hour I first believed
`,
  },
];
