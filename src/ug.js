// Reads song data from an Ultimate Guitar tab page (HTML).
// UG stores the page data as HTML-escaped JSON in
// <div class="js-store" data-content="...">. Used by server.js.

import { cleanText } from './parser.js';

export function isUgUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && /(^|\.)ultimate-guitar\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === 'quot') return '"';
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'apos') return "'";
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}

// Depth-first search for the first object that has `key`.
function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findKey(v, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function extractUgSong(html) {
  const m = /class="js-store"[^>]*data-content="([^"]*)"/.exec(html) || /data-content="([^"]*wiki_tab[^"]*)"/.exec(html);
  if (!m) throw new Error('Could not find the tab data on this page.');
  let store;
  try {
    store = JSON.parse(decodeEntities(m[1]));
  } catch {
    throw new Error('Could not read the tab data on this page.');
  }

  // Known location first, then a search in case UG moves things around.
  const data = store?.store?.page?.data || store?.page?.data || {};
  const view = data.tab_view || findKey(store, 'tab_view') || {};
  const wiki = view.wiki_tab || findKey(store, 'wiki_tab');
  let text = wiki && typeof wiki.content === 'string' ? wiki.content : '';
  if (!text) throw new Error('This page has no text tab (it may be an Official or Guitar Pro tab).');
  text = cleanText(text); // removes [ch]/[tab] markup

  const tab = data.tab || {};
  const meta = view.meta || {};
  const strummings = view.strummings;
  const bpm = Array.isArray(strummings) ? strummings.map((s) => Number(s.bpm)).find((b) => b > 0) : undefined;

  const header = [];
  const capo = Number(meta.capo);
  if (capo > 0 && !/capo/i.test(text)) header.push(`Capo: ${capo}`);
  const tuning = meta.tuning && (meta.tuning.value || meta.tuning.name);
  if (tuning && !/tuning/i.test(text)) header.push(`Tuning: ${tuning}`);
  if (header.length) text = header.join('\n') + '\n\n' + text;

  return {
    title: tab.song_name || '',
    artist: tab.artist_name || '',
    type: tab.type || '',
    bpm: bpm || undefined,
    text,
  };
}
