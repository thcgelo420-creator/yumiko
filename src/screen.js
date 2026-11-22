import * as THREE from 'three';
import { getCover } from './covers.js';

// The laptop's picture: a clock when idle, the sleeve and a level meter when a record is on.
export function createScreen() {
  const W = 512, H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const tint = new THREE.Color(0x8fb0ff);
  const sample = document.createElement('canvas');
  sample.width = sample.height = 1;
  const sg = sample.getContext('2d', { willReadFrequently: true });
  const bars = new Float32Array(20);
  let last = -1, coverOf = null;

  const fit = (text, max) => {
    if (g.measureText(text).width <= max) return text;
    while (text.length > 1 && g.measureText(`${text}…`).width > max) text = text.slice(0, -1);
    return `${text}…`;
  };

  return {
    texture, tint,
    update(t, { record, track, playing, progress }) {
      if (t - last < 1 / 12) return;
      last = t;
      if (!record || !track) {
        const bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#16233f');
        bg.addColorStop(1, '#3d5583');
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        g.strokeStyle = 'rgba(210,225,255,0.22)';
        g.lineWidth = 1;
        for (let i = 0; i < 46; i++) {
          const x = (i * 97.3) % W, y = ((i * 53.7 + t * (150 + (i % 7) * 30)) % (H + 40)) - 20;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y + 16); g.stroke();
        }
        const now = new Date();
        g.fillStyle = '#eef3ff';
        g.textAlign = 'center';
        g.font = '200 96px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif';
        g.fillText(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), W / 2, 176);
        g.font = '20px ui-sans-serif, system-ui, sans-serif';
        g.fillStyle = 'rgba(238,243,255,0.7)';
        g.fillText(now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase(), W / 2, 214);
        g.font = '15px ui-monospace, Menlo, monospace';
        g.fillStyle = 'rgba(238,243,255,0.45)';
        g.fillText('nothing on the turntable', W / 2, 286);
        tint.set(0x7f9fe6);
        coverOf = null;
      } else {
        const cover = getCover(record);
        if (coverOf !== record.id + cover.art) {
          coverOf = record.id + cover.art;
          sg.drawImage(cover.canvas, 0, 0, 1, 1);
          const [r, gg, b] = sg.getImageData(0, 0, 1, 1).data;
          tint.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace);
          // Keep it a light: never let the room's glow go grey-black.
          const hsl = {};
          tint.getHSL(hsl);
          tint.setHSL(hsl.h, Math.min(0.75, hsl.s + 0.2), Math.max(0.55, hsl.l));
        }
        // Backdrop: the sleeve blown up and darkened.
        g.drawImage(cover.canvas, 96, 96, 320, 200, 0, 0, W, H);
        g.fillStyle = 'rgba(8,10,18,0.72)';
        g.fillRect(0, 0, W, H);
        g.drawImage(cover.canvas, 28, 44, 190, 190);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.strokeRect(28.5, 44.5, 189, 189);
        g.textAlign = 'left';
        g.fillStyle = '#f2f4fa';
        g.font = '600 26px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif';
        g.fillText(fit(track.title, 250), 240, 84);
        g.font = '19px ui-sans-serif, system-ui, sans-serif';
        g.fillStyle = 'rgba(242,244,250,0.7)';
        g.fillText(fit(record.artist.toLowerCase(), 250), 240, 114);
        g.font = '14px ui-monospace, Menlo, monospace';
        g.fillStyle = 'rgba(242,244,250,0.45)';
        g.fillText(`${record.tracks.indexOf(track) + 1} / ${record.tracks.length} · ${playing ? '33⅓ rpm' : 'paused'}`, 240, 140);
        // Level meter. Streams cannot be analysed, so this is a plausible wobble, not a measurement.
        for (let i = 0; i < bars.length; i++) {
          const target = playing ? 0.18 + 0.82 * Math.abs(Math.sin(t * (2.1 + i * 0.37) + i * 1.7) * Math.sin(t * 0.9 + i * 0.5)) * (1 - i / 34) : 0.04;
          bars[i] += (target - bars[i]) * 0.45;
          const bh = bars[i] * 74;
          g.fillStyle = `rgba(242,244,250,${0.35 + bars[i] * 0.55})`;
          g.fillRect(240 + i * 12.4, 232 - bh, 8, bh);
        }
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.fillRect(28, 276, W - 56, 4);
        g.fillStyle = '#f2f4fa';
        g.fillRect(28, 276, (W - 56) * progress, 4);
      }
      texture.needsUpdate = true;
    },
  };
}
