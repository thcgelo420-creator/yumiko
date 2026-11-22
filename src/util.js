import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 2D/3D value noise with a fixed permutation, so shapes are the same on every load.
const P = new Uint8Array(512);
{
  const r = rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const h3 = (x, y, z) => P[P[P[x & 255] + (y & 255)] + (z & 255)] / 255;

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  return lerp(
    lerp(lerp(h3(xi, yi, zi), h3(xi + 1, yi, zi), xf), lerp(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), xf), yf),
    lerp(lerp(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), xf), lerp(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), xf), yf),
    zf
  );
}

export function fbm(x, y, z, octaves = 4) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z);
    norm += amp;
    x *= 2.03; y *= 2.03; z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// Merge vertices that share a position so displaced boxes shade as one soft surface.
export function weld(geometry) {
  const pos = geometry.attributes.position;
  const src = geometry.index ? geometry.index.array : null;
  const map = new Map();
  const remap = new Uint32Array(pos.count);
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = out.length / 3;
      map.set(key, id);
      out.push(x, y, z);
    }
    remap[i] = id;
  }
  const count = src ? src.length : pos.count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = remap[src ? src[i] : i];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// Round the corners of a welded box in place: clamp to an inner box, then push out by r.
export function roundBox(geometry, hx, hy, hz, r) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(clamp(v.x, -hx + r, hx - r), clamp(v.y, -hy + r, hy - r), clamp(v.z, -hz + r, hz - r));
    v.sub(c);
    if (v.lengthSq() > 0) v.setLength(r);
    pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  return geometry;
}

export class Tweens {
  constructor() { this.list = []; }
  // Runs onUpdate(eased, linear) each frame. The promise resolves true when it finishes, or
  // false if a later tween on the same `channel` replaced it first.
  add(duration, onUpdate, { ease = easeInOut, delay = 0, channel = null } = {}) {
    if (channel) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        if (this.list[i].channel === channel) this.list.splice(i, 1)[0].resolve(false);
      }
    }
    return new Promise((resolve) => {
      this.list.push({ t: -delay, duration, onUpdate, ease, resolve, channel });
    });
  }
  update(dt) {
    for (const tw of this.list.slice()) {
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = tw.duration <= 0 ? 1 : Math.min(1, tw.t / tw.duration);
      tw.onUpdate(tw.ease(k), k);
      if (k >= 1) {
        const i = this.list.indexOf(tw);
        if (i >= 0) this.list.splice(i, 1);
        tw.resolve(true);
      }
    }
  }
}
