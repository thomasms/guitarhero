import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUgSong, isUgUrl } from '../src/ug.js';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(data) {
  const store = { config: {}, store: { page: { data } } };
  return `<html><body><div class="js-store" data-content="${escape(JSON.stringify(store))}"></div></body></html>`;
}

test('only Ultimate Guitar https URLs are accepted', () => {
  assert.ok(isUgUrl('https://tabs.ultimate-guitar.com/tab/x/y-chords-1'));
  assert.ok(!isUgUrl('http://tabs.ultimate-guitar.com/tab/x'));
  assert.ok(!isUgUrl('https://evil.com/ultimate-guitar.com'));
  assert.ok(!isUgUrl('https://ultimate-guitar.com.evil.com/'));
  assert.ok(!isUgUrl('not a url'));
});

test('extracts title, artist, capo, bpm and content', () => {
  const html = page({
    tab: { song_name: 'My Song', artist_name: 'Some Band', type: 'Chords' },
    tab_view: {
      wiki_tab: { content: '[Verse]\r\n[ch]Am[/ch]   [ch]C[/ch]\r\nWords & "quotes"' },
      meta: { capo: 3, tuning: { name: 'Standard', value: 'E A D G B E' } },
      strummings: [{ bpm: 0 }, { bpm: 112 }],
    },
  });
  const song = extractUgSong(html);
  assert.equal(song.title, 'My Song');
  assert.equal(song.artist, 'Some Band');
  assert.equal(song.bpm, 112);
  assert.match(song.text, /^Capo: 3\nTuning: E A D G B E\n\n\[Verse\]\nAm   C\n/);
  assert.match(song.text, /Words & "quotes"$/);
});

test('clear error when no tab data', () => {
  assert.throws(() => extractUgSong('<html></html>'), /Could not find/);
  assert.throws(() => extractUgSong(page({ tab: {}, tab_view: {} })), /no text tab/);
});
