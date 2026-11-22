import * as THREE from 'three';
import { drawSleeve } from './textures.js';

// One 512px canvas per record, shared by the sleeve on the wall, the sleeve by the turntable,
// the laptop screen and the crate UI. It starts as a printed placeholder and is painted over
// with real art if that loads.

const covers = new Map();

function thumbUrl(record) {
  if (record.cover) return record.cover;
  const first = record.tracks.find((t) => t.yt);
  return first ? `https://i.ytimg.com/vi/${first.yt}/sddefault.jpg` : null;
}

export function getCover(record) {
  let c = covers.get(record.id);
  if (c) return c;
  const canvas = drawSleeve(record, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  c = { canvas, texture, art: false, url: null };
  covers.set(record.id, c);
  refreshCover(record);
  return c;
}

export function refreshCover(record) {
  const c = covers.get(record.id);
  if (!c) return;
  const url = thumbUrl(record);
  if (!url) {
    // Back to the printed placeholder (e.g. the blank sleeve lost its last track).
    c.canvas.getContext('2d').drawImage(drawSleeve(record, 512), 0, 0);
    c.art = false; c.url = null;
    c.texture.needsUpdate = true;
    window.dispatchEvent(new CustomEvent('cover', { detail: record.id }));
    return;
  }
  if (url === c.url) return;
  c.url = url;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (c.url !== url) return;
    // YouTube's 4:3 thumbnails letterbox a 16:9 frame; a 120px-wide image is its "missing" stub.
    if (img.naturalWidth <= 120) return;
    const g = c.canvas.getContext('2d');
    const isYt = !record.cover;
    const side = isYt ? img.naturalHeight * 0.75 : Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
    g.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
    c.art = true;
    c.texture.needsUpdate = true;
    window.dispatchEvent(new CustomEvent('cover', { detail: record.id }));
  };
  img.src = url;
}
