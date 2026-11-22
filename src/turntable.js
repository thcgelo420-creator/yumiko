import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { vinylDisc } from './textures.js';
import { getCover } from './covers.js';
import { damp } from './util.js';

const RPM33 = (33.333 / 60) * Math.PI * 2;

// The deck is modelled with its front toward +z and turned to face the room by the caller.
export function createTurntable(tweens) {
  const group = new THREE.Group();
  const m = (color, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const shadow = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };

  const TOP = 0.062;
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.046, 0.36, 3, 0.008), m(0x6a4732, 0.5));
  plinth.position.y = 0.039;
  group.add(plinth);
  for (const [x, z] of [[-0.19, -0.15], [0.19, -0.15], [-0.19, 0.15], [0.19, 0.15]]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.016, 16), m(0x0c0c0e, 0.8));
    foot.position.set(x, 0.008, z);
    group.add(foot);
  }
  const deckPlate = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.003, 0.34), m(0x8a8d94, 0.42, { metalness: 0.7 }));
  deckPlate.position.y = TOP + 0.0015;
  group.add(deckPlate);

  // Platter with strobe dots and a rubber mat.
  const C = new THREE.Vector3(-0.05, TOP, 0.005);
  const platter = new THREE.Group();
  platter.position.copy(C);
  const steel = m(0x9a9da4, 0.28, { metalness: 0.95 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.158, 0.158, 0.02, 64), steel);
  rim.position.y = 0.013;
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.004, 48), m(0x0b0b0d, 0.95));
  mat.position.y = 0.025;
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.022, 10), steel);
  spindle.position.y = 0.036;
  platter.add(rim, mat, spindle);
  const dotGeo = new THREE.BoxGeometry(0.003, 0.006, 0.002);
  const dots = new THREE.InstancedMesh(dotGeo, m(0x1a1b1f, 0.5), 90);
  const dm = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    dm.makeRotationY(-a);
    dm.setPosition(Math.cos(a) * 0.1585, 0.013, Math.sin(a) * 0.1585);
    dots.setMatrixAt(i, dm);
  }
  platter.add(dots);
  group.add(platter);

  // The record itself: lives on the platter once seated, otherwise wherever it is being carried.
  const REC_Y = 0.0285;
  const discMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1505, 0.1505, 0.0022, 72), [m(0x050506, 0.4), discMat, m(0x050506, 0.4)]);
  disc.visible = false;
  disc.position.y = REC_Y;
  platter.add(disc);

  // Tonearm.
  const PIVOT = new THREE.Vector3(0.168, TOP + 0.048, -0.1);
  const ARM = 0.212;
  const pivotBase = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.044, 24), m(0x1b1c20, 0.35, { metalness: 0.7 }));
  pivotBase.position.set(PIVOT.x, TOP + 0.022, PIVOT.z);
  group.add(pivotBase);
  const arm = new THREE.Group();
  arm.position.copy(PIVOT);
  arm.rotation.order = 'YXZ';
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, ARM + 0.045, 10), steel);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = (ARM - 0.045) / 2;
  const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 20), m(0x2a2b30, 0.35, { metalness: 0.8 }));
  weight.rotation.x = Math.PI / 2;
  weight.position.z = -0.045;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.004, 0.036), m(0x101114, 0.4, { metalness: 0.5 }));
  shell.position.set(0, -0.001, ARM - 0.004);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.011, 0.018), m(0xc9a37a, 0.5));
  cart.position.set(0, -0.0085, ARM - 0.002);
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.03, 6), steel);
  lift.rotation.z = Math.PI / 2;
  lift.position.set(0.018, 0, ARM - 0.006);
  arm.add(tube, weight, shell, cart, lift);
  group.add(arm);
  const armRest = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.044, 8), m(0x1b1c20, 0.4, { metalness: 0.7 }));
  armRest.position.set(PIVOT.x, TOP + 0.022, PIVOT.z + 0.15);
  group.add(armRest);

  // Angles: 0 is parked (arm pointing at the front edge). Solve where the stylus meets a groove radius.
  const toCentre = new THREE.Vector2(C.x - PIVOT.x, C.z - PIVOT.z);
  const dist = toCentre.length();
  const bearing = Math.atan2(-toCentre.x, toCentre.y);       // swing from +z toward -x
  const angleFor = (radius) => -(bearing - Math.acos((dist * dist + ARM * ARM - radius * radius) / (2 * dist * ARM)));
  const A_IN = angleFor(0.144), A_OUT = angleFor(0.062);
  const DOWN = Math.atan2(PIVOT.y - (C.y + REC_Y + 0.0155), ARM), UP = DOWN - 0.085, PARK = DOWN - 0.03;
  arm.rotation.x = PARK;

  // Controls and pilot light.
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 20), steel);
  knob.position.set(-0.185, TOP + 0.008, 0.145);
  const slider = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.07), m(0x0b0b0d, 0.6));
  slider.position.set(0.195, TOP + 0.004, 0.09);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x331008 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), ledMat);
  led.position.set(-0.15, TOP + 0.005, 0.15);
  group.add(knob, slider, led);
  const glow = new THREE.PointLight(0xff5a2a, 0, 0.5, 2);
  glow.position.set(-0.15, TOP + 0.04, 0.15);
  group.add(glow);
  shadow(group);

  // The sleeve of whatever is on, propped behind the deck.
  const propMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 });
  const card = m(0x16171b, 0.8);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.315, 0.315, 0.007), [card, card, card, card, propMat, card]);
  prop.position.set(-0.03, 0.16, -0.205);
  prop.rotation.x = -0.16;
  prop.visible = false;
  prop.castShadow = true;
  group.add(prop);

  const state = { speed: 0, target: 0, record: null, seated: false, needle: false, progress: 0, busy: 0 };
  const setArm = (yaw, pitch) => { arm.rotation.y = yaw; arm.rotation.x = pitch; };

  const angleAt = (p) => A_IN + (A_OUT - A_IN) * p;
  const armTween = (dur, fn) => tweens.add(dur, fn, { channel: 'arm' });
  const power = (on) => {
    ledMat.color.set(on ? 0xff5a2a : 0x331008);
    glow.intensity = on ? 0.05 : 0;
  };
  // Each arm move gives up quietly (returns false) if a newer move takes over the arm.
  // Swing over the groove that is `p` of the way through the side, then set the needle down.
  async function lower(p = 0) {
    const y0 = arm.rotation.y, x0 = arm.rotation.x, y1 = angleAt(p);
    if (!(await armTween(1.0, (k) => setArm(y0 + (y1 - y0) * k, x0 + (UP - x0) * Math.min(1, k * 3))))) return false;
    if (!(await armTween(0.45, (k) => setArm(y1, UP + (DOWN - UP) * k)))) return false;
    state.progress = p;
    state.needle = true;
    return true;
  }
  async function raise() {
    state.needle = false;
    const x0 = arm.rotation.x;
    return armTween(0.3, (k) => setArm(arm.rotation.y, x0 + (UP - x0) * k));
  }
  async function park() {
    state.needle = false;
    if (Math.abs(arm.rotation.y) < 1e-4) return armTween(0.2, (k) => setArm(0, arm.rotation.x + (PARK - arm.rotation.x) * k));
    const y0 = arm.rotation.y, x0 = arm.rotation.x;
    if (!(await armTween(0.3, (k) => setArm(y0, x0 + (UP - x0) * k)))) return false;
    if (!(await armTween(0.8, (k) => setArm(y0 * (1 - k), UP)))) return false;
    return armTween(0.3, (k) => setArm(0, UP + (PARK - UP) * k));
  }

  return {
    group,
    get record() { return state.record; },
    get needleDown() { return state.needle; },
    get seated() { return state.seated; },
    // Swap in a record: lift the arm, change discs, spin up, drop the needle. Resolves on needle-down,
    // or with false if another call superseded this one.
    async load(record) {
      const ticket = ++state.busy;
      const current = () => ticket === state.busy;
      await park();
      if (!current()) return false;
      if (state.seated) {
        state.target = 0;
        state.seated = false;
        discMat.transparent = true;
        discMat.needsUpdate = true;
        await tweens.add(0.5, (k) => { disc.position.y = REC_Y + k * 0.12; discMat.opacity = 1 - k; }, { channel: 'disc' });
        if (!current()) return false;
      }
      state.record = record;
      discMat.map?.dispose();
      discMat.map = vinylDisc(record.colors[0], record.ink ? '#10141f' : '#141012', record.title, record.artist);
      discMat.transparent = true;
      discMat.needsUpdate = true;
      propMat.map = getCover(record).texture;
      propMat.needsUpdate = true;
      prop.visible = true;
      disc.visible = true;
      await tweens.add(0.7, (k) => { disc.position.y = REC_Y + (1 - k) * 0.12; discMat.opacity = Math.min(1, k * 2); }, { channel: 'disc' });
      if (!current()) return false;
      discMat.transparent = false;
      discMat.needsUpdate = true;
      state.seated = true;
      state.target = RPM33;
      power(true);
      return (await lower(0)) && current();
    },
    // Move the needle to another track on the record that is already on.
    async recue(p) {
      const ticket = ++state.busy;
      state.target = RPM33;
      power(true);
      if (state.needle || arm.rotation.x > UP + 0.01) await raise();
      if (ticket !== state.busy) return false;
      return (await lower(p)) && ticket === state.busy;
    },
    async stop() {
      ++state.busy;
      state.target = 0;
      power(false);
      await park();
    },
    setSpinning(on) { state.target = on && state.seated ? RPM33 : 0; },
    setProgress(p) { state.progress = Math.min(1, Math.max(0, p)); },
    update(dt, t) {
      state.speed = damp(state.speed, state.target, state.target > state.speed ? 2.2 : 1.1, dt);
      platter.rotation.y -= state.speed * dt;
      if (state.needle) {
        // Track inward with the song, riding the slight warp of the disc.
        const want = angleAt(state.progress);
        arm.rotation.y = damp(arm.rotation.y, want, 3, dt);
        arm.rotation.x = DOWN + Math.sin(platter.rotation.y) * 0.004 * (state.speed / RPM33);
      }
    },
  };
}
