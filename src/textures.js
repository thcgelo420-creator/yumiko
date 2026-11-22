import * as THREE from 'three';
import { rng, fbm, noise3 } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Dark oiled planks. Returns colour and bump maps that tile every 2 m.
export function woodFloor() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const [b, bg] = canvas(S, S);
  const r = rng(7);
  const N = 14;
  const plankW = S / N;
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, S, S);
  for (let col = 0; col < N; col++) {
    let y = -r() * S * 0.5;
    while (y < S) {
      const len = S * (0.7 + r() * 0.6);
      const tone = 0.85 + r() * 0.25;
      const hue = 22 + r() * 8;
      g.fillStyle = `hsl(${hue}, ${26 + r() * 10}%, ${16 * tone}%)`;
      g.fillRect(col * plankW, y, plankW, len);
      // Grain: long thin streaks that follow the plank.
      const streaks = 40;
      for (let i = 0; i < streaks; i++) {
        const x = col * plankW + r() * plankW;
        const a = 0.03 + r() * 0.07;
        g.strokeStyle = r() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,220,180,${a * 0.6})`;
        g.lineWidth = 0.5 + r() * 1.5;
        g.beginPath();
        let yy = y;
        g.moveTo(x, yy);
        let xx = x;
        while (yy < y + len) {
          yy += 24;
          xx += (r() - 0.5) * 2.2;
          g.lineTo(xx, yy);
        }
        g.stroke();
      }
      // Seams between boards.
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(col * plankW, y + len - 1, plankW, 1.5);
      bg.fillStyle = '#505050';
      bg.fillRect(col * plankW, y + len - 2, plankW, 2);
      y += len;
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(col * plankW, 0, 1.5, S);
    bg.fillStyle = '#505050';
    bg.fillRect(col * plankW - 1, 0, 2, S);
  }
  return {
    map: tex(c, { repeat: [2.3, 2.4] }),
    bumpMap: tex(b, { repeat: [2.3, 2.4], srgb: false }),
  };
}

// Fine mottled grey used as a bump/roughness source for plaster and paint.
export function plaster(scale = 1) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x * 0.012, y * 0.012, 7.7, 5);
      const fine = noise3(x * 0.35, y * 0.35, 3.3);
      const val = 128 + (n - 0.5) * 90 + (fine - 0.5) * 50;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, { repeat: [scale, scale], srgb: false });
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  return t;
}

// Woven cloth bump: crossing threads plus a little fuzz.
export function weave(repeat = 40) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const r = rng(21);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = Math.sin((x / S) * Math.PI * 16), b = Math.sin((y / S) * Math.PI * 16);
      const over = ((x >> 3) + (y >> 3)) & 1;
      const val = 128 + (over ? a : b) * 46 + (r() - 0.5) * 40;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: [repeat, repeat], srgb: false });
}

// A worn wool rug: border, faded field, a few rows of small motifs.
export function rug() {
  const W = 768, H = 1152;
  const [c, g] = canvas(W, H);
  const r = rng(99);
  g.fillStyle = '#56627a';
  g.fillRect(0, 0, W, H);
  const band = (inset, w, colour) => {
    g.strokeStyle = colour;
    g.lineWidth = w;
    g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  };
  band(26, 30, '#a9b0bd');
  band(60, 6, '#3a4252');
  band(84, 14, '#858d9d');
  band(110, 3, '#c4c8d0');
  g.fillStyle = '#4a556b';
  g.fillRect(126, 126, W - 252, H - 252);
  // Diamond lattice.
  g.strokeStyle = 'rgba(196,204,218,0.4)';
  g.lineWidth = 3;
  const step = 86;
  for (let y = 126; y < H - 126; y += step) {
    for (let x = 126; x < W - 126; x += step) {
      g.beginPath();
      g.moveTo(x + step / 2, y + 8);
      g.lineTo(x + step - 8, y + step / 2);
      g.lineTo(x + step / 2, y + step - 8);
      g.lineTo(x + 8, y + step / 2);
      g.closePath();
      g.stroke();
      g.fillStyle = r() > 0.5 ? 'rgba(168,128,122,0.6)' : 'rgba(170,182,204,0.55)';
      g.fillRect(x + step / 2 - 6, y + step / 2 - 6, 12, 12);
    }
  }
  // Wear: soft blotches and thread noise.
  const img = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x * 0.006, y * 0.006, 4.2, 4);
      const thread = (r() - 0.5) * 26 + Math.sin(y * 1.6) * 5;
      const i = (y * W + x) * 4;
      const k = 0.78 + n * 0.45;
      img.data[i] = img.data[i] * k + thread;
      img.data[i + 1] = img.data[i + 1] * k + thread;
      img.data[i + 2] = img.data[i + 2] * k + thread;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// A 12-inch record seen from above: groove bands, run-out, paper label.
export function vinylDisc(labelColour = '#c9a37a', ink = '#1a1410', title = '', artist = '') {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const cx = S / 2;
  g.fillStyle = '#060607';
  g.fillRect(0, 0, S, S);
  const r = rng(labelColour.length * 31 + title.length * 7 + 5);
  // Grooves: many faint rings with a few brighter track gaps.
  for (let rad = cx * 0.36; rad < cx * 0.97; rad += 1.1) {
    const a = 0.05 + r() * 0.09;
    g.strokeStyle = `rgba(190,196,214,${a})`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(cx, cx, rad, 0, Math.PI * 2);
    g.stroke();
  }
  const gaps = 4 + Math.floor(r() * 3);
  for (let i = 0; i < gaps; i++) {
    const rad = cx * (0.42 + (0.52 * (i + r() * 0.6)) / gaps);
    g.strokeStyle = 'rgba(0,0,0,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cx, rad, 0, Math.PI * 2);
    g.stroke();
  }
  // Label.
  g.fillStyle = labelColour;
  g.beginPath();
  g.arc(cx, cx, cx * 0.335, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cx, cx * 0.3, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  g.fillText(artist.toUpperCase().slice(0, 22), cx, cx - 62);
  g.font = '22px ui-sans-serif, system-ui, sans-serif';
  g.fillText(title.slice(0, 26), cx, cx + 84);
  g.font = '15px ui-monospace, monospace';
  g.fillText('33⅓ RPM · SIDE A', cx, cx + 116);
  // Spindle hole.
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(cx, cx, 9, 0, Math.PI * 2);
  g.fill();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Printed card sleeve. Used until (and unless) real cover art loads.
export function drawSleeve(record, size = 512) {
  const [c, g] = canvas(size, size);
  const [a, b] = record.colors;
  const r = rng(record.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0));
  const grad = g.createLinearGradient(0, 0, size * (0.3 + r() * 0.7), size);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Soft blooms of the accent colour.
  for (let i = 0; i < 5; i++) {
    const x = r() * size, y = r() * size, rad = size * (0.2 + r() * 0.4);
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.28)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, size, size);
  }
  // Print grain.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = record.ink || 'rgba(255,255,255,0.92)';
  g.textBaseline = 'alphabetic';
  const pad = size * 0.075;
  g.font = `700 ${size * 0.105}px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif`;
  wrap(g, record.artist.toLowerCase(), pad, size * 0.2, size - pad * 2, size * 0.115);
  g.font = `${size * 0.05}px ui-monospace, "SF Mono", Menlo, monospace`;
  g.globalAlpha = 0.8;
  g.fillText(record.title.toLowerCase(), pad, size - pad);
  g.textAlign = 'right';
  g.fillText(`${record.tracks.length} tracks`, size - pad, size - pad);
  g.globalAlpha = 1;
  return c;
}

function wrap(g, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      y += lineH;
      line = w;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
}

export function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Small framed print: a pale moon over a ridge line, in the room's blues.
export function posterMoon() {
  const W = 384, H = 512;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#1b2233');
  grad.addColorStop(0.7, '#56627b');
  grad.addColorStop(1, '#8a8fa0');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8e4da';
  g.beginPath();
  g.arc(W * 0.62, H * 0.3, 46, 0, Math.PI * 2);
  g.fill();
  for (let layer = 0; layer < 3; layer++) {
    g.fillStyle = ['#3a445a', '#262e40', '#141926'][layer];
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const y = H * (0.62 + layer * 0.1) - fbm(x * 0.012, layer * 5.1, 1.7, 4) * 110 * (1 - layer * 0.25);
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.fill();
  }
  return canvasTexture(c);
}

// Second print: big lowercase type, like a gig poster.
export function posterType() {
  const W = 384, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#d9d4c8';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#16181f';
  g.font = '800 92px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif';
  g.fillText('stay', 26, 130);
  g.fillText('in', 26, 222);
  g.fillText('side', 26, 314);
  g.fillStyle = '#8b2f3a';
  g.fillRect(26, 350, 120, 10);
  g.fillStyle = '#16181f';
  g.font = '16px ui-monospace, Menlo, monospace';
  g.fillText('it is raining anyway', 26, 400);
  g.fillText('side a / side b', 26, 424);
  const img = g.getImageData(0, 0, W, H);
  const r = rng(4);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c);
}

// Round soft shadow blob used under furniture.
export function blobShadow() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(0,0,0,0.85)');
  rg.addColorStop(0.55, 'rgba(0,0,0,0.4)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  return t;
}
