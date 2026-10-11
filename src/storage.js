// Saves songs and settings in the browser (localStorage).

const SONGS_KEY = 'guitarhero.songs';
const SETTINGS_KEY = 'guitarhero.settings';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the app still works without it.
  }
}

export const loadSongs = () => read(SONGS_KEY, []);
export const saveSongs = (songs) => write(SONGS_KEY, songs);
export const loadSettings = () => read(SETTINGS_KEY, {});
export const saveSettings = (s) => write(SETTINGS_KEY, s);
