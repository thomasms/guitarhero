# Tab Trainer

A web app to practise guitar with tabs. Paste a tab or chord sheet (for example
from Ultimate Guitar), then play along with a moving cursor, a metronome and a
backing band (drums + bass).

## Start

You need Node.js 18 or newer. There are no packages to install.

```sh
npm start        # then open http://localhost:8000
npm test         # parser tests
```

Any static web server also works (for example `python3 -m http.server`).

## Features

- **Tabs and chord sheets.** Paste text that you copy from a tab site. The app
  finds tab staves (`e|--0--|`), chord lines (`Am   F   C`) and section labels
  (`[Verse]`). Ultimate Guitar `[ch]`/`[tab]` markup is removed. A `Capo: N`
  line is used for the backing bass.
- **Play along.** A cursor moves through the tab, notes flash when they sound,
  and the current and next chord show in large text. Click a note, chord or
  place in the tab to jump there.
- **Tempo.** Slider, ± buttons, tap tempo, and arrow keys.
- **Metronome and count-in.**
- **Backing band.** Synthesized drums (rock, half-time, four on the floor,
  shuffle) and bass (root notes, eighths, root–fifth, one note per chord) that
  follow the song's chords.
- **Hear the tab.** Tab notes are played with a plucked-string sound. Turn it
  off to play the part yourself.
- **Loop and speed trainer.** Loop a range of bars, and add some BPM after each
  loop.
- Songs and settings are saved in your browser.

## Timing rules

ASCII tabs do not contain exact rhythm, so the app makes a guess:

- In a tab with bar lines, each measure is one bar ("Beats per bar"). The note
  spacing in the bar is used to find the rhythm grid.
- In a tab without bar lines, "Tab chars per beat" sets the speed.
- In a chord sheet, each chord lasts "Beats per chord".

Change these values in **Song timing** if the playback does not match the song.

## Note about Ultimate Guitar

The app does not download from Ultimate Guitar: their site does not allow
other web pages to load their content. Copy the tab text from the page and paste
it into **Add song**. Tabs on that site belong to their authors, so keep them
for your own practice.

## Code

| File | Purpose |
| --- | --- |
| `src/parser.js` | Turns tab text into timed notes and chords |
| `src/player.js` | Look-ahead scheduler, loop, count-in, drum and bass patterns |
| `src/audio.js` | Web Audio synth sounds (pluck, bass, drums, click) |
| `src/app.js` | UI, rendering and controls |
| `test/` | Parser tests (`node --test`) |
