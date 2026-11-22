import { OWN_RECORD } from './records.js';
import { refreshCover } from './covers.js';

// The blank sleeve: tracks the visitor adds. Links are kept in localStorage, audio files in
// IndexedDB, both only in this browser.

const KEY = 'yumiko.own.v1';
let db = null;

function openDb() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open('yumiko', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
// Resolves { ok, result }; ok is false when the browser has no IndexedDB or refuses the write.
const tx = (mode, fn) => new Promise((resolve) => {
  if (!db) return resolve({ ok: false });
  try {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve({ ok: true, result: req && req.result });
    t.onerror = t.onabort = () => resolve({ ok: false });
  } catch {
    resolve({ ok: false });
  }
});

// Writes the track list. Returns false if the browser would not keep it. Files that never
// reached IndexedDB are left out, so a reload does not list tracks it cannot play.
function save() {
  const list = OWN_RECORD.tracks
    .filter((t) => t.yt || t.file)
    .map((t) => (t.yt ? { title: t.title, yt: t.yt } : { title: t.title, file: t.file }));
  refreshCover(OWN_RECORD);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export async function loadOwn() {
  db = await openDb();
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* corrupt entry */ }
  for (const item of list) {
    if (item.yt) OWN_RECORD.tracks.push({ title: item.title, yt: item.yt });
    else if (item.file) {
      const { result: blob } = await tx('readonly', (s) => s.get(item.file));
      if (blob) OWN_RECORD.tracks.push({ title: item.title, file: item.file, src: URL.createObjectURL(blob) });
    }
  }
  refreshCover(OWN_RECORD);
}

export async function addYouTube(id) {
  if (OWN_RECORD.tracks.some((t) => t.yt === id)) return null;
  let title = `youtube · ${id}`;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (res.ok) title = (await res.json()).title || title;
    else if (res.status === 401 || res.status === 403) throw new Error('embedding is switched off for that video');
    else if (res.status === 404 || res.status === 400) throw new Error('no video at that link');
  } catch (err) {
    if (err.message.startsWith('embedding') || err.message.startsWith('no video')) throw err;
  }
  const track = { title, yt: id };
  OWN_RECORD.tracks.push(track);
  track.kept = save();
  return track;
}

export async function addFiles(files) {
  const added = [];
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(file.name)) continue;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { ok } = await tx('readwrite', (s) => s.put(file, id));
    // `kept` is false when the file only lives in this page and will be gone after a reload.
    const track = { title: file.name.replace(/\.[^.]+$/, ''), file: ok ? id : null, src: URL.createObjectURL(file), kept: ok };
    OWN_RECORD.tracks.push(track);
    added.push(track);
  }
  if (added.length && !save()) for (const t of added) t.kept = false;
  return added;
}

export async function removeOwn(index) {
  const [t] = OWN_RECORD.tracks.splice(index, 1);
  if (t && t.file) {
    URL.revokeObjectURL(t.src);
    await tx('readwrite', (s) => s.delete(t.file));
  }
  save();
}
