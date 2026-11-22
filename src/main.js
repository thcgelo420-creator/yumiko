import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createOutside } from './outside.js';
import { createGlassMaterial } from './glass.js';
import { createRoom, ROOM } from './room.js';
import { createTurntable } from './turntable.js';
import { createPlayer } from './player.js';
import { createScreen } from './screen.js';
import { createAmbience, Jukebox, parseYouTubeId } from './audio.js';
import { createUI } from './ui.js';
import { ALL_RECORDS, OWN_RECORD } from './records.js';
import { loadOwn, addYouTube, addFiles, removeOwn } from './own.js';
import { Tweens, clamp, damp } from './util.js';

const canvas = document.getElementById('scene');
const REACH = 2.5;

// ---------------------------------------------------------------------------------------------
// UI first, so a failure to start WebGL can still say something.
// ---------------------------------------------------------------------------------------------
const handlers = {};
const ui = createUI(handlers);
const prefs = ui.prefs;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 missing');
} catch (err) {
  ui.fail('This room needs WebGL 2, which this browser or device does not offer.');
  throw err;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;

const camera = new THREE.PerspectiveCamera(66, 1, 0.04, 1400);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
const tweens = new Tweens();

// The city is rendered to this texture at reduced size; its mip chain is the window's blur.
const outside = createOutside();
// Half-float buffers keep the dark end of the picture smooth, but a few WebGL 2 devices cannot
// render to them. Those get 8-bit buffers and no bloom: coarser, but a picture rather than none.
const gl = renderer.getContext();
const hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
const bufferType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
const outsideRT = new THREE.WebGLRenderTarget(4, 4, {
  type: bufferType, generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
});
const glass = createGlassMaterial(outsideRT.texture);

const room = createRoom(glass);
scene.add(room.group);
const { refs } = room;

const turntable = createTurntable(tweens);
turntable.group.position.copy(refs.turntableSpot);
turntable.group.rotation.y = Math.PI / 2;
scene.add(turntable.group);
const deckItem = { type: 'deck', label: '' };
{
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.48), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.set(refs.turntableSpot.x, refs.deskTop + 0.1, refs.turntableSpot.z);
  proxy.userData.item = deckItem;
  deckItem.proxy = proxy;
  scene.add(proxy);
  room.interactables.push(deckItem);
}

const screen = createScreen();
refs.screen.material.map = screen.texture;
refs.screen.material.color.setScalar(1.35);

// ---- Light. Dusk through two walls of glass: one soft shadowed key, cool fills, no sun. ----
const hemi = new THREE.HemisphereLight(0x7088ba, 0x242a3c, 1.1);
scene.add(hemi);
const sky = new THREE.DirectionalLight(0x8fa6d8, 1.25);
sky.position.set(-4.6, 4.6, -5.4);
sky.target.position.set(0.4, 0.2, 0.2);
sky.castShadow = true;
sky.shadow.mapSize.set(1024, 1024);
sky.shadow.camera.left = -4.2; sky.shadow.camera.right = 4.2;
sky.shadow.camera.top = 4.2; sky.shadow.camera.bottom = -4.2;
sky.shadow.camera.near = 1; sky.shadow.camera.far = 16;
sky.shadow.bias = -0.0015;
sky.shadow.normalBias = 0.03;
sky.shadow.radius = 5;
scene.add(sky, sky.target);
const fillN = new THREE.PointLight(0x7f97cc, 1.5, 7, 1.4);
fillN.position.set(0.2, 1.5, ROOM.z0 + 0.5);
const fillW = new THREE.PointLight(0x7f97cc, 1.1, 6, 1.4);
fillW.position.set(ROOM.x0 + 0.5, 1.5, -0.8);
// Sodium light from the streets, thrown up onto the ceiling by the windows.
const street = new THREE.PointLight(0xff9a4a, 0.5, 5, 1.6);
street.position.set(-1.0, -0.5, ROOM.z0 - 0.2);
// The desk sits in the shadow of its own window frame; a little borrowed sky keeps the deck readable.
const deskFill = new THREE.PointLight(0xa9bff0, 0.45, 1.7, 1.5);
deskFill.position.set(-1.62, 1.32, -0.86);
scene.add(fillN, fillW, street, deskFill);
const BASE = { hemi: hemi.intensity, sky: sky.intensity, fillN: fillN.intensity, fillW: fillW.intensity };

// ---- Post: bloom for the city and screens, then a grade (vignette, grain, cool shadows). ----
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: bufferType }));
composer.addPass(new RenderPass(scene, camera));
if (hdr) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.75, 0.9));
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDim: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uDim; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Shadows lean blue, the way a room does at blue hour.
      c = mix(c, vec3(l) * vec3(0.78, 0.92, 1.28), 0.24 * smoothstep(0.35, 0.0, l));
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.85;
      c *= 1.0 - uDim * 0.55;
      c += (hash(vUv * 913.0 + fract(uTime) * 71.0) - 0.5) * 0.012 * (0.4 + smoothstep(0.5, 0.0, l));
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const cap = prefs.lowq ? 1 : 1.5;
  const pr = Math.min(window.devicePixelRatio || 1, cap);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  const samples = prefs.lowq ? 0 : 4;
  if (composer.renderTarget1.samples !== samples) {
    // A live target keeps the buffers it was built with; drop them so the new sample count takes.
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.dispose(); rt.samples = samples; }
  }
  const bw = Math.floor(w * pr), bh = Math.floor(h * pr);
  const k = prefs.lowq ? 0.4 : 0.5;
  outsideRT.setSize(Math.max(2, Math.floor(bw * k)), Math.max(2, Math.floor(bh * k)));
  glass.uniforms.uRes.value.set(bw, bh);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sky.shadow.mapSize.set(prefs.lowq ? 512 : 1024, prefs.lowq ? 512 : 1024);
  if (sky.shadow.map) { sky.shadow.map.dispose(); sky.shadow.map = null; }
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------------------------
// Sound and records
// ---------------------------------------------------------------------------------------------
const ambience = createAmbience();
const jukebox = new Jukebox('yt-holder');
jukebox.setVolume(prefs.music / 100);
const deck = { ticket: 0, userPaused: false, between: false, sidePos: 0 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function publish() {
  ui.nowPlaying({ record: jukebox.record, index: jukebox.index, playing: jukebox.playing });
}
jukebox.addEventListener('track', publish);
jukebox.addEventListener('state', () => {
  publish();
  const on = jukebox.playing || (deck.between && !deck.userPaused);
  turntable.setSpinning(on || (!!jukebox.record && !deck.userPaused));
  ambience.crackle(!!jukebox.record && !deck.userPaused && turntable.needleDown, prefs.music / 100);
});
jukebox.addEventListener('ended', () => advance(1, true));
jukebox.addEventListener('blocked', () => ui.toast('press space to start the music'));
jukebox.addEventListener('error', (e) => {
  const { reason, track, giveUp } = e.detail;
  ui.toast(`${track ? track.title : 'that track'}: ${reason}`);
  if (giveUp) stopRecord(); else advance(1, true);
});

// Where on the side a track starts, 0..1, assuming equal-length tracks.
const sideStart = (record, index) => index / Math.max(1, record.tracks.length);

async function playRecord(record, index = 0, { seamless = false } = {}) {
  if (!record.tracks.length) { openPicker(record); return; }
  const ticket = ++deck.ticket;
  deck.userPaused = false;
  deck.between = true;
  jukebox.cue(record, index);
  if (seamless && turntable.record === record && turntable.seated && turntable.needleDown) {
    // The side just carries on into the next track.
    await wait(900);
  } else {
    ambience.crackle(false);
    const ok = turntable.record === record && turntable.seated
      ? await turntable.recue(sideStart(record, index))
      : await turntable.load(record);
    if (!ok || ticket !== deck.ticket) return;
    ambience.needleDrop(prefs.music / 100);
    ambience.crackle(true, prefs.music / 100);
    await wait(700);
  }
  if (ticket !== deck.ticket) return;
  deck.between = false;
  await jukebox.start();
  // Autoplay can be refused without an error; say how to get going.
  setTimeout(() => {
    if (ticket === deck.ticket && jukebox.record && !jukebox.playing && !deck.userPaused) ui.toast('if nothing is playing, press space');
  }, 6000);
}

function advance(dir, auto = false) {
  const record = jukebox.record;
  if (!record) return;
  const next = jukebox.index + dir;
  if (next >= record.tracks.length) {
    if (auto) { stopRecord(); ui.toast('side over'); } else playRecord(record, 0);
    return;
  }
  playRecord(record, Math.max(0, next), { seamless: auto });
}

function stopRecord() {
  deck.ticket++;
  deck.between = false;
  jukebox.stop();
  ambience.crackle(false);
  turntable.stop();
}

function togglePlay() {
  if (!jukebox.record) {
    if (turntable.record && turntable.record.tracks.length) playRecord(turntable.record, 0);
    else ui.toast('nothing on the turntable yet · press R for the crate');
    return;
  }
  if (!jukebox.kind) return;                       // needle is still on its way down
  deck.userPaused = jukebox.playing;
  jukebox.toggle();
  turntable.setSpinning(!deck.userPaused);
  ambience.crackle(!deck.userPaused, prefs.music / 100);
}

// ---------------------------------------------------------------------------------------------
// Player, modes, interaction
// ---------------------------------------------------------------------------------------------
const player = createPlayer(camera, room.colliders);
player.sensitivity = prefs.sens / 100;
const app = { mode: 'menu', entered: false, focus: null, pickerPose: false, time: 0, lamp: 0, lampOn: prefs.lamp, flash: 0, nextStrike: 30 + Math.random() * 30, touch: false };
const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
const proxies = room.interactables.map((i) => i.proxy);
const centre = new THREE.Vector2(0, 0);
const aim = new THREE.Vector2(0, 0);
const toNdc = (e, out) => out.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);

const locked = () => document.pointerLockElement === canvas;
function lock() {
  if (app.touch || locked()) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch { /* drag-to-look still works */ }
}

function setLamp(on, silent) {
  app.lampOn = on;
  prefs.lamp = on;
  ui.savePrefs();
  refs.lamp.item.label = on ? 'switch the lamp off' : 'switch the lamp on';
  const from = app.lamp, to = on ? 1 : 0;
  tweens.add(silent ? 0 : 0.5, (k) => { app.lamp = from + (to - from) * k; });
}

function openPicker(record) {
  if (app.mode !== 'room') return;
  app.mode = 'picker';
  if (locked()) document.exitPointerLock();
  if (player.mode === 'walk') {
    app.pickerPose = true;
    const wantsWall = false;
    player.enter('deck', wantsWall ? refs.poses.wall : refs.poses.deck, false);
  }
  ui.openPicker(record);
  ui.setMode({ picking: true });
  jukebox.warm();
}
function closePicker(relock = true) {
  if (app.mode !== 'picker') return;
  app.mode = 'room';
  ui.closePicker();
  ui.setMode({ posed: !!player.poseName && !app.pickerPose });
  if (app.pickerPose) { player.leave(); app.pickerPose = false; }
  canvas.focus();
  if (relock) lock();
}

function use() {
  if (app.mode !== 'room') return;
  const item = app.focus;
  const posed = player.mode === 'pose' && (player.poseName === 'lie' || player.poseName === 'sit');
  if (!item) { if (posed) player.leave(); return; }
  switch (item.type) {
    case 'lie':
    case 'sit':
      if (player.poseName === item.type) player.leave();
      else if (player.mode === 'walk' || posed) player.enter(item.type, refs.poses[item.type], true);
      break;
    case 'lamp': setLamp(!app.lampOn); break;
    case 'record':
      if (jukebox.record === item.record) openPicker(item.record);
      else playRecord(item.record, 0);
      break;
    case 'crate': openPicker(); break;
    case 'deck':
      if (jukebox.record) stopRecord(); else openPicker();
      break;
  }
}

// What is under the aim point and within reach. Locked mouse and touch aim with the centre dot;
// a free mouse aims with the cursor.
function itemAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(proxies, false)[0];
  const item = hit ? hit.object.userData.item : null;
  // You cannot lie down on the bed you are lying on.
  return item && item.type === player.poseName ? null : item;
}
function updateFocus() {
  if (app.mode !== 'room' || player.mode === 'entering' || player.mode === 'leaving') { app.focus = null; return; }
  app.focus = itemAt(locked() || app.touch ? centre : aim);
}

function promptText() {
  if (app.mode !== 'room') return '';
  const key = app.touch ? '' : '<kbd>E</kbd> ';
  const item = app.focus;
  if (item) {
    if (item.type === 'deck') return key + (jukebox.record ? 'lift the needle' : 'choose a record');
    if (item.type === 'record' && jukebox.record === item.record) return `${key}${item.record.artist.toLowerCase()} · see the tracks`;
    return key + item.label;
  }
  if (player.mode === 'pose' && player.poseName === 'lie') return `${key}get up`;
  if (player.mode === 'pose' && player.poseName === 'sit') return `${key}stand up`;
  return '';
}

// ---- input ----
const typing = (e) => e.target instanceof HTMLInputElement && e.target.type === 'text';
window.addEventListener('keydown', (e) => {
  if (typing(e) && e.code !== 'Escape') return;
  if (e.code === 'Escape') {
    if (app.mode === 'picker') { closePicker(false); e.preventDefault(); }
    else if (app.mode === 'room' && !locked()) pause();
    else if (app.mode === 'menu' && app.entered) enter();
    return;
  }
  if (app.mode === 'menu') { if (e.code === 'Enter' && !ui.el.enter.disabled) enter(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  player.keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyE': case 'KeyF': if (app.mode === 'room') use(); break;
    case 'KeyR': app.mode === 'picker' ? closePicker() : openPicker(); e.preventDefault(); break;
    // Tab opens the crate too, but inside it Tab belongs to the browser: it moves between sleeves, tracks and buttons.
    case 'Tab': if (app.mode === 'room') { openPicker(); e.preventDefault(); } break;
    case 'Space':
      // On a focused crate control, Space presses that control, as it does on any button.
      if (app.mode === 'picker' && e.target instanceof HTMLElement && e.target.closest('#picker button, #picker label')) break;
      togglePlay(); e.preventDefault(); break;
    case 'KeyN': advance(1); break;
    case 'KeyB': advance(-1); break;
    case 'KeyV': ui.toast(ui.toggleVideo() ? 'video shown' : 'video hidden'); break;
    case 'KeyL': setLamp(!app.lampOn); break;
  }
});
window.addEventListener('keyup', (e) => player.keys.delete(e.code));
window.addEventListener('blur', () => player.keys.clear());

document.addEventListener('pointerlockchange', () => {
  // Esc while locked only releases the mouse (the key never reaches the page), so treat that as pause.
  if (!locked() && app.mode === 'room' && app.entered && !app.touch) pause();
});

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (app.mode !== 'room' || e.pointerType === 'touch') return;
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
});
window.addEventListener('pointermove', (e) => {
  if (app.mode !== 'room' || e.pointerType === 'touch') return;
  toNdc(e, aim);
  if (locked()) player.turn(e.movementX, e.movementY);
  else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    player.turn(-dx * 1.4, -dy * 1.4);              // dragging pulls the view, like a map
  }
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
  const d = drag;
  drag = null;
  if (app.mode !== 'room' || !d || e.target !== canvas) return;
  if (d.moved < 5) {
    if (locked()) use();
    else { if (app.focus) use(); if (app.mode === 'room') lock(); }
  }
});

// Touch: left pad walks, dragging anywhere else looks, a tap uses what is under the dot.
{
  const stick = document.getElementById('stick'), nub = stick.firstElementChild;
  let stickId = null, lookId = null, lx = 0, ly = 0, moved = 0;
  const setStick = (x, y) => {
    player.stick.x = x; player.stick.y = y;
    nub.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
  };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); e.preventDefault(); });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    setStick(x, y);
  });
  const endStick = (e) => { if (e.pointerId === stickId) { stickId = null; setStick(0, 0); } };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!app.touch) { app.touch = true; ui.setTouch(true); }
    if (app.mode !== 'room' || lookId !== null) return;
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY; moved = 0;
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    player.turn(-dx * 2.2, -dy * 2.2);
  });
  const endLook = (e) => {
    if (e.pointerId !== lookId) return;
    lookId = null;
    if (moved < 8 && app.mode === 'room' && player.mode !== 'entering' && player.mode !== 'leaving') {
      // A tap uses the thing tapped, or failing that whatever the dot is on.
      app.focus = itemAt(toNdc(e, aim)) || itemAt(centre);
      use();
    }
  };
  window.addEventListener('pointerup', endLook);
  window.addEventListener('pointercancel', endLook);
  document.getElementById('t-use').addEventListener('click', use);
  document.getElementById('t-rec').addEventListener('click', () => (app.mode === 'picker' ? closePicker() : openPicker()));
  document.getElementById('t-menu').addEventListener('click', () => pause());
  if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) { app.touch = true; ui.setTouch(true); }
}

function enter() {
  app.entered = true;
  app.mode = 'room';
  ui.hideMenu();
  ambience.start();
  ambience.setRain(prefs.rain / 100);
  jukebox.warm();
  canvas.focus();
  lock();
}
function pause() {
  if (app.mode === 'picker') closePicker(false);
  app.mode = 'menu';
  player.keys.clear();
  if (locked()) document.exitPointerLock();
  ui.showMenu(true);
}

Object.assign(handlers, {
  onEnter: enter,
  onPlay: (record, index) => playRecord(record, index),
  onToggle: togglePlay,
  onSkip: (dir) => advance(dir),
  onStop: stopRecord,
  onClosePicker: () => closePicker(),
  onPrefs(p, key) {
    if (key === 'music') { jukebox.setVolume(p.music / 100); ambience.setCrackleLevel(p.music / 100); }
    if (key === 'rain') ambience.setRain(p.rain / 100);
    if (key === 'sens') player.sensitivity = p.sens / 100;
    if (key === 'lowq') resize();
  },
  async onAddLink(text) {
    const id = parseYouTubeId(text);
    if (!id) { ui.toast('that does not look like a YouTube link'); return false; }
    try {
      const track = await addYouTube(id);
      ui.toast(!track ? 'that one is already on your record' : track.kept ? `pressed: ${track.title}` : `pressed for this visit only (this browser would not save it): ${track.title}`, track && !track.kept ? 6000 : undefined);
      ui.refreshOwn();
      return true;
    } catch (err) {
      ui.toast(err.message);
      return false;
    }
  },
  async onAddFiles(files) {
    const added = await addFiles(Array.from(files));
    if (!added.length) { ui.toast('those were not audio files'); return; }
    const what = added.length === 1 ? added[0].title : `${added.length} tracks`;
    if (added.every((t) => t.kept)) ui.toast(`pressed: ${what}`);
    else ui.toast(`pressed for this visit only (this browser would not save them): ${what}`, 6000);
    if (app.mode === 'room') openPicker(OWN_RECORD); else if (app.mode === 'picker') ui.openPicker(OWN_RECORD);
    ui.refreshOwn();
  },
  async onRemoveOwn(index) {
    const playingThis = jukebox.record === OWN_RECORD;
    if (playingThis) stopRecord();
    await removeOwn(index);
    ui.refreshOwn();
  },
});

// ---------------------------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
const size = new THREE.Vector2();
let nearGlassTimer = 0, beat = 0;

function lightning(dt) {
  app.nextStrike -= dt;
  if (app.nextStrike <= 0) {
    app.nextStrike = 28 + Math.random() * 55;
    if (prefs.thunder && app.entered) {
      const strength = 0.35 + Math.random() * 0.65;
      tweens.add(1.4, (_, k) => {
        // Two or three flickers, then gone.
        const f = Math.max(0, Math.sin(k * 26) * 0.5 + 0.5) * Math.pow(1 - k, 2.2);
        app.flash = f * strength;
      }, { ease: (k) => k }).then(() => { app.flash = 0; });
      setTimeout(() => ambience.thunder(strength), 1200 + Math.random() * 2600);
    }
  }
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = (app.time += dt);
  tweens.update(dt);
  lightning(dt);

  if (app.mode === 'room' && player.mode === 'pose' && player.poseName !== 'deck' && player.wantsToMove()) player.leave();
  player.update(dt, t);
  camera.updateMatrixWorld();
  updateFocus();
  ui.prompt(promptText(), !!app.focus);
  ui.setMode({ posed: player.mode !== 'walk' && !app.pickerPose, picking: app.mode === 'picker', free: !locked() && !app.touch });

  // Record deck and what follows from it.
  const record = jukebox.record, track = jukebox.track;
  const p = jukebox.progress();
  if (record && jukebox.kind) {
    const start = sideStart(record, jukebox.index);
    turntable.setProgress(start + p / record.tracks.length);
    ui.progress(p);
  }
  turntable.update(dt, t);
  screen.update(t, { record, track, playing: jukebox.playing, progress: p });
  refs.screenLight.color.lerp(screen.tint, Math.min(1, dt * 2));
  refs.screenLight.intensity = 0.55 + Math.sin(t * 7.3) * 0.015;
  beat = damp(beat, jukebox.playing ? 1 : 0, 4, dt);
  for (const [i, cone] of refs.cones.entries()) {
    cone.position.x = 0.068 + Math.pow(Math.max(0, Math.sin(t * 7.6 + i * 0.4)), 6) * 0.004 * beat;
  }

  // Lamp.
  const L = app.lamp;
  refs.lamp.light.intensity = L * 1.9;
  refs.lamp.light.castShadow = L > 0.01;
  refs.lamp.shade.emissiveIntensity = L * 2.6;
  refs.lamp.bulb.color.setRGB(L * 3.0, L * 2.0, L * 1.0);
  glass.uniforms.uRoomGlow.value.setRGB(0.012 * L, 0.007 * L, 0.003 * L);

  // Lightning lifts the whole room for an instant.
  const F = app.flash;
  hemi.intensity = BASE.hemi * (1 + F * 4);
  sky.intensity = BASE.sky * (1 + F * 6);
  fillN.intensity = BASE.fillN * (1 + F * 5);
  fillW.intensity = BASE.fillW * (1 + F * 5);

  for (const u of room.updaters) u(t, dt, app);

  nearGlassTimer -= dt;
  if (nearGlassTimer <= 0) {
    nearGlassTimer = 0.25;
    const dN = camera.position.z - ROOM.z0;
    const dW = camera.position.z < ROOM.glassEnd ? camera.position.x - ROOM.x0 : 9;
    ambience.setNearGlass(clamp(1 - (Math.min(dN, dW) - 0.4) / 2.6, 0, 1));
  }

  // Outside first, into the texture the glass reads.
  renderer.getDrawingBufferSize(size);
  const pixelScale = outsideRT.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  outside.update(t, F, pixelScale);
  glass.uniforms.uTime.value = t;
  glass.uniforms.uFlash.value = F;
  renderer.setRenderTarget(outsideRT);
  renderer.render(outside.scene, camera);
  renderer.setRenderTarget(null);

  grade.uniforms.uTime.value = t;
  grade.uniforms.uDim.value = damp(grade.uniforms.uDim.value, app.mode === 'menu' ? 1 : 0, 3, dt);
  composer.render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------------------------
setLamp(prefs.lamp, true);
publish();
loadOwn().then(() => ui.refreshOwn());
// Expose a little for debugging from the console.
window.yumiko = { glass, outside, ui, refs, app, player, jukebox, turntable, playRecord, stopRecord, openPicker, closePicker, records: ALL_RECORDS, camera, renderer };

renderer.compile(scene, camera);
requestAnimationFrame(() => {
  frame();
  ui.ready();
});
