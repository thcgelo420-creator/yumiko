import * as THREE from 'three';
import { clamp, damp, easeInOut } from './util.js';
import { ROOM } from './room.js';

const EYE = 1.6, RADIUS = 0.24, SPEED = 1.7;

// First-person body: walks, collides with boxes, and can settle into fixed poses (bed, stool,
// looking at the deck). Poses keep mouse-look, limited to a cone around the pose's direction.
export function createPlayer(camera, colliders) {
  const pos = new THREE.Vector3(1.05, EYE, 1.75);
  const look = { yaw: 0.72, pitch: -0.1 };
  const keys = new Set();
  const stick = { x: 0, y: 0 };
  const state = { mode: 'walk', pose: null, name: null, t: 0, from: null, bob: 0, bobAmp: 0, sens: 1, vel: new THREE.Vector3(), free: false };
  camera.rotation.order = 'YXZ';

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function resolve(p) {
    p.x = clamp(p.x, ROOM.x0 + RADIUS, ROOM.x1 - RADIUS);
    p.z = clamp(p.z, ROOM.z0 + RADIUS, ROOM.z1 - RADIUS);
    for (let pass = 0; pass < 2; pass++) {
      for (const c of colliders) {
        const nx = clamp(p.x, c.x0, c.x1), nz = clamp(p.z, c.z0, c.z1);
        let dx = p.x - nx, dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = nx + (dx / d) * RADIUS;
          p.z = nz + (dz / d) * RADIUS;
        } else {
          // Centre is inside the box: leave by the nearest face.
          const l = p.x - c.x0, r = c.x1 - p.x, n = p.z - c.z0, s = c.z1 - p.z;
          const min = Math.min(l, r, n, s);
          if (min === l) p.x = c.x0 - RADIUS;
          else if (min === r) p.x = c.x1 + RADIUS;
          else if (min === n) p.z = c.z0 - RADIUS;
          else p.z = c.z1 + RADIUS;
        }
      }
    }
  }

  function beginMove(target, name, mode) {
    state.from = { pos: pos.clone(), yaw: look.yaw, pitch: look.pitch };
    state.pose = target;
    state.name = name;
    state.mode = mode;
    state.t = 0;
  }

  const api = {
    pos, look, keys, stick,
    get mode() { return state.mode; },
    get poseName() { return state.mode === 'walk' ? null : state.name; },
    set sensitivity(v) { state.sens = v; },
    // Settle into a pose. `free` poses (bed, stool) keep mouse-look; others hold the camera still.
    enter(name, pose, free = true) {
      state.free = free;
      beginMove(pose, name, 'entering');
    },
    leave() {
      if (state.mode === 'walk' || state.mode === 'leaving') return;
      const exit = state.pose.exit || state.from.pos;
      const target = { pos: new THREE.Vector3(exit.x, EYE, exit.z), yaw: look.yaw, pitch: clamp(look.pitch, -0.3, 0.3) };
      resolve(target.pos);
      beginMove(target, null, 'leaving');
    },
    turn(dx, dy) {
      if (state.mode === 'entering' || state.mode === 'leaving') return;
      if (state.mode === 'pose' && !state.free) return;
      look.yaw -= dx * 0.0022 * state.sens;
      look.pitch -= dy * 0.0022 * state.sens;
      if (state.mode === 'pose') {
        const p = state.pose;
        look.yaw = p.yaw + clamp(wrap(look.yaw - p.yaw), -p.yawRange, p.yawRange);
        look.pitch = clamp(look.pitch, p.pitchMin, p.pitchMax);
      } else {
        look.pitch = clamp(look.pitch, -1.45, 1.45);
      }
    },
    teleport(x, z, yaw, pitch = 0) {
      state.mode = 'walk';
      state.name = null;
      state.vel.set(0, 0, 0);
      pos.set(x, EYE, z);
      look.yaw = yaw;
      look.pitch = pitch;
    },
    wantsToMove() {
      return keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD') ||
        keys.has('ArrowUp') || keys.has('ArrowDown') || keys.has('ArrowLeft') || keys.has('ArrowRight') ||
        Math.hypot(stick.x, stick.y) > 0.3;
    },
    update(dt, t) {
      if (state.mode === 'entering' || state.mode === 'leaving') {
        const dur = state.name === 'lie' || state.from.pos.y < 1 ? 1.5 : 1.1;
        state.t = Math.min(1, state.t + dt / dur);
        const k = easeInOut(state.t);
        pos.lerpVectors(state.from.pos, state.pose.pos, k);
        // Dip a little on the way, like bending to sit.
        pos.y -= Math.sin(k * Math.PI) * 0.06;
        look.yaw = state.from.yaw + wrap(state.pose.yaw - state.from.yaw) * k;
        look.pitch = state.from.pitch + (state.pose.pitch - state.from.pitch) * k;
        if (state.t >= 1) state.mode = state.mode === 'entering' ? 'pose' : 'walk';
      } else if (state.mode === 'walk') {
        let f = 0, s = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
        f -= stick.y; s += stick.x;
        const len = Math.hypot(f, s);
        if (len > 1) { f /= len; s /= len; }
        const slow = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.5 : 1;
        const sin = Math.sin(look.yaw), cos = Math.cos(look.yaw);
        const wantX = (-sin * f + cos * s) * SPEED * slow;
        const wantZ = (-cos * f - sin * s) * SPEED * slow;
        state.vel.x = damp(state.vel.x, wantX, 9, dt);
        state.vel.z = damp(state.vel.z, wantZ, 9, dt);
        pos.x += state.vel.x * dt;
        pos.z += state.vel.z * dt;
        resolve(pos);
        const moving = Math.hypot(state.vel.x, state.vel.z);
        state.bob += moving * dt * 3.6;
        state.bobAmp = damp(state.bobAmp, Math.min(1, moving / SPEED), 6, dt);
        pos.y = EYE;
      }
      camera.position.copy(pos);
      let roll = 0;
      if (state.mode === 'walk') {
        camera.position.y += Math.sin(state.bob * 2) * 0.016 * state.bobAmp;
        camera.position.x += Math.cos(state.bob) * 0.008 * state.bobAmp * Math.cos(look.yaw);
        roll = Math.cos(state.bob) * 0.003 * state.bobAmp;
      } else if (state.name === 'lie' && state.mode === 'pose') {
        camera.position.y += Math.sin(t * 0.9) * 0.006;      // breathing
      }
      camera.rotation.set(look.pitch, look.yaw, roll);
    },
  };
  return api;
}
