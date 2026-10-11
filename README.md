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

- **Import from a link.** In **Add song**, paste an Ultimate Guitar tab link
  and click **Import**. The title, artist, tempo (if the page has one), capo and
  tab text are filled in for you.
- **Tabs and chord sheets.** Or paste text that you copy from a tab site. The app
  finds tab staves (`e|--0--|`), chord lines (`Am   F   C`) and section labels
  (`[Verse]`). Ultimate Guitar `[ch]`/`[tab]` markup is removed. A `Capo: N`
  line is used for the backing bass.
- **Clean, standard display.** Tabs are drawn as real string lines with round
  fret markers, evenly spaced by beat, with bar numbers and chord names, and
  wrapped to fit the screen. Hammer-ons, pull-offs, slides, bends and muted
  notes are marked. Chord sheets show chords above the lyrics. Tick
  **Original text** to see the tab as it was pasted.
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
- In a tab without bar lines, "Tab chars per beat" sets the speed. The length
  is rounded to whole bars.
- In a chord sheet, each chord lasts "Beats per chord".

Change these values in **Song timing** if the playback does not match the song.

## Note about Ultimate Guitar

Browsers do not let a web page read another site, so the import goes through
the app's own server (`server.js`, endpoint `/api/ug`). Link import therefore
works only when you start the app with `npm start`. The server only accepts
`https://…ultimate-guitar.com` links.

Import reads the tab data that Ultimate Guitar puts in its page. If Ultimate
Guitar changes its page or blocks the request, import fails with a message:
then copy the tab text from the page and paste it instead. "Official" and
Guitar Pro tabs have no text, so they cannot be imported. Tabs on that site
belong to their authors, so keep them for your own practice.

## Code

| File | Purpose |
| --- | --- |
| `src/parser.js` | Turns tab text into timed notes and chords |
| `src/player.js` | Look-ahead scheduler, loop, count-in, drum and bass patterns |
| `src/audio.js` | Web Audio synth sounds (pluck, bass, drums, click) |
| `src/app.js` | UI and controls |
| `src/render.js` | Draws the tab and chord sheet (standard and text views) |
| `src/ug.js` | Reads song data from an Ultimate Guitar page |
| `server.js` | Static server and the `/api/ug` import endpoint |
| `test/` | Parser tests (`node --test`) |
