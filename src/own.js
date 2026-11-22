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
const tx = (mode, fn) => new Promise((resolve) => {
  if (!db) return resolve(undefined);
  const t = db.transaction('files', mode);
  const req = fn(t.objectStore('files'));
  t.oncomplete = () => resolve(req && req.result);
  t.onerror = () => resolve(undefined);
});

function save() {
  const list = OWN_RECORD.tracks.map((t) => (t.yt ? { title: t.title, yt: t.yt } : { title: t.title, file: t.file }));
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  refreshCover(OWN_RECORD);
}

export async function loadOwn() {
  db = await openDb();
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* corrupt entry */ }
  for (const item of list) {
    if (item.yt) OWN_RECORD.tracks.push({ title: item.title, yt: item.yt });
    else if (item.file) {
      const blob = await tx('readonly', (s) => s.get(item.file));
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
  save();
  return track;
}

export async function addFiles(files) {
  const added = [];
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(file.name)) continue;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tx('readwrite', (s) => s.put(file, id));
    const track = { title: file.name.replace(/\.[^.]+$/, ''), file: id, src: URL.createObjectURL(file) };
    OWN_RECORD.tracks.push(track);
    added.push(track);
  }
  if (added.length) save();
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
