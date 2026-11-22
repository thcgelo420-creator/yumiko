import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng, fbm, noise3, weld, roundBox, clamp } from './util.js';
import * as T from './textures.js';
import { ALL_RECORDS } from './records.js';
import { getCover } from './covers.js';

// Room footprint in metres. North (-z) and the north half of west (-x) are glass.
export const ROOM = { x0: -2.3, x1: 2.3, z0: -2.2, z1: 2.6, h: 2.6, glassEnd: 0.6 };

export function createRoom(glassMaterial) {
  const group = new THREE.Group();
  const colliders = [];       // { x0, x1, z0, z1 } boxes the player cannot walk into
  const interactables = [];   // { proxy, type, label, ... }
  const updaters = [];        // (t, dt) => void

  const std = (color, roughness = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };
  const box = (w, h, d, mat, x, y, z, opts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return add(m, opts);
  };
  const collide = (x0, x1, z0, z1) => colliders.push({ x0, x1, z0, z1 });
  const proxy = (w, h, d, x, y, z, data) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z);
    group.add(m);
    const item = { proxy: m, ...data };
    m.userData.item = item;
    interactables.push(item);
    return item;
  };

  const { x0, x1, z0, z1, h: H, glassEnd } = ROOM;
  const W = x1 - x0, D = z1 - z0;

  // --- Shell -----------------------------------------------------------------
  const plasterBump = T.plaster(3);
  const wallMat = std(0xaeb2bb, 0.96, { bumpMap: plasterBump, bumpScale: 0.6 });
  const ceilMat = std(0xbfc2c9, 0.98, { bumpMap: plasterBump, bumpScale: 0.4 });
  const wood = T.woodFloor();
  const floorMat = std(0xffffff, 0.5, { map: wood.map, bumpMap: wood.bumpMap, bumpScale: 1.2 });
  const frameMat = std(0x0b0c0f, 0.55, { metalness: 0.4 });
  const trimMat = std(0x9fa3ac, 0.8);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  add(floor, { cast: false });

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((x0 + x1) / 2, H, (z0 + z1) / 2);
  add(ceiling, { cast: false });

  const TH = 0.16;
  box(TH, H, D + TH * 2, wallMat, x1 + TH / 2, H / 2, (z0 + z1) / 2);                        // east
  box(W + TH * 2, H, TH, wallMat, (x0 + x1) / 2, H / 2, z1 + TH / 2);                        // south
  box(TH, H, z1 - glassEnd, wallMat, x0 - TH / 2, H / 2, (glassEnd + z1) / 2);               // west, solid part

  // Window surrounds: a low sill and a header box that hides the curtain track.
  const SILL = 0.09, HEAD = 2.42;
  box(W + TH * 2, SILL, TH, frameMat, (x0 + x1) / 2, SILL / 2, z0 - TH / 2 + 0.02);
  box(W + TH * 2, H - HEAD, TH + 0.1, wallMat, (x0 + x1) / 2, (H + HEAD) / 2, z0 - TH / 2 + 0.05);
  box(TH, SILL, glassEnd - z0, frameMat, x0 - TH / 2 + 0.02, SILL / 2, (z0 + glassEnd) / 2);
  box(TH + 0.1, H - HEAD, glassEnd - z0 + TH, wallMat, x0 - TH / 2 + 0.05, (H + HEAD) / 2, (z0 + glassEnd) / 2 - TH / 2);
  // A roof slab outside, so the low "sky" light cannot leak in over the header.
  box(W + 3, 0.1, D + 3, wallMat, 0, H + 0.06, 0, { receive: false });

  // Frames and mullions.
  const F = 0.05;
  const post = (x, z) => box(F, HEAD - SILL, F, frameMat, x, (HEAD + SILL) / 2, z);
  post(x0 + F / 2, z0 + F / 2);                       // the corner
  post(-0.05, z0 + F / 2);                            // north mullion
  post(x1 - F / 2, z0 + F / 2);
  post(x0 + F / 2, -0.85);                            // west mullion
  post(x0 + F / 2, glassEnd - F / 2);
  box(W, F, F, frameMat, 0, HEAD - F / 2, z0 + F / 2);
  box(W, F, F, frameMat, 0, SILL + F / 2, z0 + F / 2);
  box(F, F, glassEnd - z0, frameMat, x0 + F / 2, HEAD - F / 2, (z0 + glassEnd) / 2);
  box(F, F, glassEnd - z0, frameMat, x0 + F / 2, SILL + F / 2, (z0 + glassEnd) / 2);

  // Glass. aPane carries metres along the pane so the drops are the same size on both walls.
  const pane = (w, h, x, y, z, rotY, offset) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    const a = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      a[i * 2] = uv.getX(i) * w + offset;
      a[i * 2 + 1] = uv.getY(i) * h;
    }
    g.setAttribute('aPane', new THREE.BufferAttribute(a, 2));
    const m = new THREE.Mesh(g, glassMaterial);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    group.add(m);
    return m;
  };
  const gh = HEAD - SILL;
  pane(W, gh, 0, (HEAD + SILL) / 2, z0 + 0.012, 0, 0);
  pane(glassEnd - z0, gh, x0 + 0.012, (HEAD + SILL) / 2, (z0 + glassEnd) / 2, Math.PI / 2, 31.7);

  // Skirting on the solid walls.
  const SK = 0.07;
  box(0.015, SK, D, trimMat, x1 - 0.008, SK / 2, (z0 + z1) / 2, { cast: false });
  box(W, SK, 0.015, trimMat, 0, SK / 2, z1 - 0.008, { cast: false });
  box(0.015, SK, z1 - glassEnd, trimMat, x0 + 0.008, SK / 2, (glassEnd + z1) / 2, { cast: false });

  // Door on the south wall.
  const doorMat = std(0x9a9da6, 0.7);
  box(0.92, 2.06, 0.03, doorMat, 1.1, 1.03, z1 - 0.012, { cast: false });
  box(1.04, 0.06, 0.05, trimMat, 1.1, 2.1, z1 - 0.02, { cast: false });
  box(0.06, 2.1, 0.05, trimMat, 0.61, 1.05, z1 - 0.02, { cast: false });
  box(0.06, 2.1, 0.05, trimMat, 1.59, 1.05, z1 - 0.02, { cast: false });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.12, 10), std(0x30333a, 0.35, { metalness: 0.9 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.76, 1.02, z1 - 0.06);
  add(handle, { cast: false });

  // --- Shared soft goods -------------------------------------------------------
  const weaveFine = T.weave(1);
  const cloth = (color, repeat = 30, extra = {}) => {
    const bump = weaveFine.clone();
    bump.repeat.set(repeat, repeat);
    bump.needsUpdate = true;
    return new THREE.MeshPhysicalMaterial({
      color, roughness: 0.96, bumpMap: bump, bumpScale: 0.35,
      sheen: 0.55, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x9fb0d0), ...extra,
    });
  };
  const planarUV = (g, sx, sz) => {
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * sx; uv[i * 2 + 1] = p.getZ(i) * sz; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  };
  const blobTex = T.blobShadow();
  const blob = (w, d, x, z, opacity = 0.75, y = 0.004) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false, color: 0x000000 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.renderOrder = 1;
    group.add(m);
    return m;
  };

  // --- Bed (head against the east wall, long side along the north window) --------
  const bed = { x0: 0.18, x1: 2.26, z0: -2.06, z1: -0.56 };
  const bcx = (bed.x0 + bed.x1) / 2, bcz = (bed.z0 + bed.z1) / 2;
  const bl = bed.x1 - bed.x0, bw = bed.z1 - bed.z0;
  const baseMat = cloth(0x23262e, 60);
  const base = new THREE.Mesh(new RoundedBoxGeometry(bl, 0.2, bw, 3, 0.03), baseMat);
  base.position.set(bcx, 0.17, bcz);
  add(base);
  for (const [lx, lz] of [[bed.x0 + 0.1, bed.z0 + 0.1], [bed.x0 + 0.1, bed.z1 - 0.1], [bed.x1 - 0.1, bed.z0 + 0.1], [bed.x1 - 0.1, bed.z1 - 0.1]]) {
    box(0.05, 0.07, 0.05, frameMat, lx, 0.035, lz);
  }
  const headboard = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.82, bw + 0.06, 3, 0.03), baseMat);
  headboard.position.set(x1 - 0.05, 0.62, bcz);
  add(headboard);

  const sheetMat = cloth(0xa9afbd, 70);
  const mattress = new THREE.Mesh(new RoundedBoxGeometry(bl - 0.04, 0.2, bw - 0.04, 4, 0.06), sheetMat);
  mattress.position.set(bcx - 0.01, 0.37, bcz);
  add(mattress);
  const MAT_TOP = 0.47;

  // Duvet: a soft slab, rumpled with folded noise, pulled most of the way up and hanging
  // a little over the side that faces the room.
  {
    const dl = 1.62, dw = bw + 0.16, dh = 0.13;
    const g = weld(new THREE.BoxGeometry(dl, dh, dw, 96, 4, 84));
    roundBox(g, dl / 2, dh / 2, dw / 2, 0.06);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const top = clamp((y + dh / 2) / dh, 0, 1);
      // Long diagonal folds, sharper on their crests.
      const f1 = 1 - Math.abs(fbm(x * 1.5 + z * 0.9, z * 1.9 - x * 0.5, 1.3, 3) * 2 - 1);
      const f2 = 1 - Math.abs(fbm(x * 3.6 - z * 2.1, z * 4.2 + x * 1.3, 5.9, 3) * 2 - 1);
      const lump = fbm(x * 0.9, z * 0.9, 9.1, 2);
      let lift = (Math.pow(f1, 2.2) * 0.075 + Math.pow(f2, 3.0) * 0.028 + (lump - 0.5) * 0.09) * top;
      // The edge nearest the pillows is turned back into a thick roll.
      const roll = Math.exp(-Math.pow((x - (dl / 2 - 0.1)) / 0.11, 2));
      lift += roll * 0.05 * top;
      // Overhang on the room side droops.
      const over = clamp((z - (bw / 2 - 0.05)) / 0.12, 0, 1);
      y -= over * over * 0.11;
      // A crooked hem.
      x += (noise3(z * 2.3, 2.2, 0.4) - 0.5) * 0.07 * clamp((x + dl / 2) / dl, 0, 1);
      p.setXYZ(i, x, y + lift, z);
    }
    g.computeVertexNormals();
    planarUV(g, 1, 1);
    const duvet = new THREE.Mesh(g, cloth(0x7f8798, 55));
    duvet.position.set(bed.x0 + dl / 2 + 0.01, MAT_TOP + dh / 2 - 0.012, bcz + 0.04);
    add(duvet);
  }

  const pillow = (x, z, rot, color, puff = 1) => {
    const pw = 0.46, ph = 0.2 * puff, pd = 0.68;
    const g = weld(new THREE.BoxGeometry(pw, ph, pd, 30, 8, 40));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i) / (pw / 2), Z = p.getZ(i) / (pd / 2);
      // Pinched seam round the edge, full in the middle, a shallow dent where a head has been.
      const fill = Math.pow(Math.max(0, (1 - Math.pow(Math.abs(X), 2.6)) * (1 - Math.pow(Math.abs(Z), 2.6))), 0.42);
      const dent = 1 - 0.22 * Math.exp(-(X * X + Z * Z) * 3.5);
      const wr = (fbm(X * 2.6 + 4, Z * 2.6, 2.4 + x, 3) - 0.5) * 0.035;
      const y = p.getY(i) * (0.08 + fill * 0.92) * (p.getY(i) > 0 ? dent : 1) + wr * fill;
      p.setXYZ(i, p.getX(i) * (1 + 0.04 * (1 - fill)), y, p.getZ(i) * (1 + 0.03 * (1 - fill)));
    }
    g.computeVertexNormals();
    planarUV(g, 1, 1);
    const m = new THREE.Mesh(g, cloth(color, 45));
    m.position.set(x, MAT_TOP + ph * 0.42, z);
    m.rotation.set(0, rot, 0.05);
    add(m);
    return m;
  };
  pillow(1.93, -1.68, 0.06, 0xb7bcc9);
  pillow(1.95, -0.96, -0.1, 0xb7bcc9);
  pillow(1.78, -0.9, -0.38, 0x596275, 0.8);

  collide(bed.x0, x1, bed.z0 - 0.2, bed.z1);
  proxy(bl, 0.5, bw, bcx, 0.55, bcz, { type: 'lie', label: 'lie down' });

  // --- Nightstand and lamp -------------------------------------------------------
  const walnut = std(0x2a1d16, 0.6);
  const ns = { x: 2.02, z: -0.26 };
  box(0.42, 0.03, 0.4, walnut, ns.x, 0.5, ns.z);
  box(0.42, 0.03, 0.4, walnut, ns.x, 0.2, ns.z);
  for (const [dx, dz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) box(0.025, 0.5, 0.025, frameMat, ns.x + dx, 0.25, ns.z + dz);
  collide(ns.x - 0.21, x1, ns.z - 0.2, ns.z + 0.2);
  // A couple of paperbacks on the lower shelf, a glass of water on top.
  box(0.2, 0.03, 0.14, std(0x6b3038, 0.8), ns.x - 0.02, 0.23, ns.z + 0.02);
  box(0.19, 0.025, 0.13, std(0x39506b, 0.8), ns.x, 0.258, ns.z);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.028, 0.11, 20, 1, true),
    new THREE.MeshPhysicalMaterial({ color: 0xcfe0ff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  glass.position.set(ns.x - 0.1, 0.57, ns.z + 0.1);
  add(glass, { cast: false });

  const lamp = new THREE.Group();
  lamp.position.set(ns.x + 0.06, 0.515, ns.z - 0.04);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 24), std(0x1a1b20, 0.4, { metalness: 0.6 }));
  lampBase.position.y = 0.01;
  const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 10), lampBase.material);
  lampStem.position.y = 0.13;
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffb066, emissiveIntensity: 0 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.115, 0.15, 28, 1, true), shadeMat);
  shade.position.y = 0.31;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  bulb.position.y = 0.28;
  lamp.add(lampBase, lampStem, shade, bulb);
  lamp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  group.add(lamp);
  const lampLight = new THREE.PointLight(0xffa25a, 0, 6, 1.8);
  lampLight.position.set(ns.x + 0.06, 0.83, ns.z - 0.04);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(512, 512);
  lampLight.shadow.bias = -0.004;
  lampLight.shadow.camera.near = 0.12;
  group.add(lampLight);
  const lampItem = proxy(0.3, 0.42, 0.3, ns.x + 0.06, 0.72, ns.z - 0.04, { type: 'lamp', label: 'switch the lamp on' });

  // --- Desk under the west window ---------------------------------------------------
  const desk = { x0: -2.22, x1: -1.56, z0: -2.02, z1: -0.28, top: 0.74 };
  const dcx = (desk.x0 + desk.x1) / 2, dcz = (desk.z0 + desk.z1) / 2;
  const deskTop = new THREE.Mesh(new RoundedBoxGeometry(desk.x1 - desk.x0, 0.035, desk.z1 - desk.z0, 2, 0.008), std(0x2e2018, 0.5));
  deskTop.position.set(dcx, desk.top - 0.0175, dcz);
  add(deskTop);
  for (const z of [desk.z0 + 0.06, desk.z1 - 0.06]) {
    for (const x of [desk.x0 + 0.05, desk.x1 - 0.05]) box(0.03, desk.top - 0.035, 0.03, frameMat, x, (desk.top - 0.035) / 2, z);
    box(desk.x1 - desk.x0 - 0.1, 0.03, 0.03, frameMat, dcx, 0.16, z);
  }
  box(0.02, 0.03, desk.z1 - desk.z0 - 0.12, frameMat, desk.x0 + 0.05, desk.top - 0.06, dcz);
  collide(x0, desk.x1, desk.z0 - 0.2, desk.z1);
  blob(1.1, 2.1, dcx + 0.05, dcz, 0.6);

  // Stool.
  const stool = new THREE.Group();
  stool.position.set(-1.14, 0, -1.48);
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.185, 0.07, 32), cloth(0x3b4252, 20));
  seat.position.y = 0.455;
  stool.add(seat);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.44, 8), walnut);
    leg.position.set(Math.cos(a) * 0.15, 0.21, Math.sin(a) * 0.15);
    leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    stool.add(leg);
  }
  stool.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(stool);
  collide(-1.33, -0.95, -1.67, -1.29);
  blob(0.6, 0.6, -1.14, -1.48, 0.55);
  proxy(0.42, 0.5, 0.42, -1.14, 0.3, -1.48, { type: 'sit', label: 'sit at the desk' });

  // Laptop. The lid's picture is drawn elsewhere and handed in through `screen.material.map`.
  const laptop = new THREE.Group();
  laptop.position.set(-1.9, desk.top, -1.52);
  laptop.rotation.y = Math.PI / 2 - 0.22;          // open side faces the room, turned a little to the bed
  const alu = std(0x3a3d44, 0.45, { metalness: 0.75 });
  const deck = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.014, 0.225, 2, 0.006), alu);
  deck.position.y = 0.007;
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.105), std(0x0d0e11, 0.7));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 0.0145, -0.03);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.06), std(0x2c2f35, 0.35, { metalness: 0.6 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.0145, 0.07);
  const lid = new THREE.Group();
  lid.position.set(0, 0.014, -0.11);
  lid.rotation.x = -0.3;                             // leaned back past upright
  const lidShell = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.215, 0.008, 2, 0.004), alu);
  lidShell.position.set(0, 0.1075, -0.004);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.194), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  screen.position.set(0, 0.108, 0.0006);
  lid.add(lidShell, screen);
  laptop.add(deck, keys, pad, lid);
  laptop.traverse((o) => { if (o.isMesh && o !== screen) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(laptop);
  const screenLight = new THREE.PointLight(0x9db8ff, 0.5, 3.2, 1.6);
  screenLight.position.set(-1.72, desk.top + 0.2, -1.5);
  group.add(screenLight);

  // Small things on the desk.
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 24), std(0xb8b2a6, 0.5));
  mug.position.set(-1.7, desk.top + 0.045, -1.92);
  add(mug);
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), std(0x101114, 0.4));
  mouse.scale.set(1, 0.55, 1.6);
  mouse.position.set(-1.72, desk.top + 0.012, -1.24);
  mouse.rotation.y = Math.PI / 2 - 0.3;
  add(mouse);
  const bookTones = [0x4a5c7a, 0x8a8478, 0x2b2e38, 0x6e3b42];
  bookTones.forEach((c, i) => {
    const b = box(0.21 - i * 0.012, 0.022 + (i % 2) * 0.008, 0.15 - i * 0.008, std(c, 0.85), -2.02, desk.top + 0.012 + i * 0.027, -1.88);
    b.rotation.y = (i - 1.5) * 0.09;
  });

  // Speakers either side of the turntable; the cones move a little with the music.
  const cones = [];
  const speaker = (z) => {
    const s = new THREE.Group();
    s.position.set(-2.0, desk.top, z);
    const cab = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.26, 0.15, 2, 0.008), std(0x15161a, 0.7));
    cab.position.y = 0.13;
    cab.rotation.y = Math.PI / 2;
    s.add(cab);
    const ringMat = std(0x26282e, 0.4, { metalness: 0.5 });
    const coneMat = std(0x0a0a0c, 0.55);
    for (const [y, rad] of [[0.085, 0.052], [0.195, 0.02]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, rad * 0.14, 8, 28), ringMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0.076, y, 0);
      const cone = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), coneMat);
      cone.rotation.z = -Math.PI / 2;
      cone.scale.y = 0.35;
      cone.position.set(0.068, y, 0);
      s.add(ring, cone);
      if (rad > 0.03) cones.push(cone);
    }
    s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(s);
  };
  speaker(-1.12);
  speaker(-0.42);

  // --- Record wall: picture ledges on the solid part of the west wall ---------------
  const sleeves = [];
  const ledgeMat = std(0x2a1d16, 0.6);
  const S = 0.315;
  const rows = [
    { y: 1.62, items: ALL_RECORDS.slice(0, 4) },
    { y: 1.16, items: ALL_RECORDS.slice(4) },
  ];
  const wallZ0 = glassEnd + 0.22, wallZ1 = z1 - 0.3;
  for (const row of rows) {
    const span = wallZ1 - wallZ0;
    box(0.075, 0.018, span + 0.1, ledgeMat, x0 + 0.04, row.y - 0.012, (wallZ0 + wallZ1) / 2, { cast: false });
    box(0.012, 0.03, span + 0.1, ledgeMat, x0 + 0.072, row.y, (wallZ0 + wallZ1) / 2, { cast: false });
    const stepZ = span / 4;
    // Facing the wall, +z is to the left, so lay the row out from the far end back.
    const lead = ((4 - row.items.length) / 2) * stepZ;
    row.items.forEach((rec, i) => {
      const cover = getCover(rec);
      const card = std(0x16171b, 0.8);
      // A touch of self-light keeps the art readable in the dark end of the room.
      const front = new THREE.MeshStandardMaterial({ map: cover.texture, roughness: 0.62, emissive: 0xffffff, emissiveMap: cover.texture, emissiveIntensity: 0.1 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.007, S, S), [front, card, card, card, card, card]);
      const z = wallZ1 - lead - stepZ * (i + 0.5);
      const rest = new THREE.Vector3(x0 + 0.045, row.y + S / 2, z);
      m.position.copy(rest);
      m.rotation.z = 0.085;                        // leaning back on the ledge
      add(m, { cast: false });
      const item = proxy(0.1, S, S, x0 + 0.06, row.y + S / 2, z, {
        type: 'record', record: rec, label: rec.own ? 'your own record' : `play ${rec.artist.toLowerCase()} · ${rec.title}`,
      });
      sleeves.push({ record: rec, mesh: m, rest, item, lift: 0 });
    });
  }
  updaters.push((t, dt, ctx) => {
    for (const s of sleeves) {
      const want = ctx.focus === s.item ? 1 : 0;
      s.lift += (want - s.lift) * Math.min(1, dt * 10);
      s.mesh.position.x = s.rest.x + s.lift * 0.035;
      s.mesh.position.y = s.rest.y + s.lift * 0.012;
    }
  });

  // A crate of more sleeves on the floor under the ledges.
  const crate = new THREE.Group();
  crate.position.set(x0 + 0.24, 0, 1.25);
  const crateMat = std(0x4a3526, 0.8);
  const cw = 0.36, cd = 0.5, ch = 0.26;
  const slat = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), crateMat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    crate.add(m);
  };
  slat(cw, 0.012, cd, 0, 0.006, 0);
  for (const y of [0.06, 0.15, 0.24]) {
    slat(0.012, 0.07, cd, -cw / 2, y, 0);
    slat(0.012, 0.07, cd, cw / 2, y, 0);
    slat(cw, 0.07, 0.012, 0, y, -cd / 2);
    slat(cw, 0.07, 0.012, 0, y, cd / 2);
  }
  const rr = rng(77);
  const spineTones = [0x8a2f3a, 0x2f4a6b, 0xc9c2b2, 0x1c1d22, 0x6a7a55, 0xb98a4a, 0x40354f, 0x9aa3b5];
  for (let i = 0; i < 13; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(S, S, 0.006), std(spineTones[i % spineTones.length], 0.75));
    m.position.set((rr() - 0.5) * 0.02, 0.012 + S / 2 + rr() * 0.004, -cd / 2 + 0.05 + i * 0.031);
    m.rotation.x = -0.1 - rr() * 0.12;
    m.castShadow = m.receiveShadow = true;
    crate.add(m);
  }
  group.add(crate);
  collide(x0, x0 + 0.46, 0.98, 1.52);
  blob(0.6, 0.75, x0 + 0.25, 1.25, 0.6);
  proxy(0.4, 0.4, 0.52, x0 + 0.24, 0.22, 1.25, { type: 'crate', label: 'dig through the crate' });

  // --- Rug, dresser, prints, plant ---------------------------------------------------
  const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.5), std(0xffffff, 0.95, { map: T.rug() }));
  rugMesh.rotation.set(-Math.PI / 2, 0, 0.06);
  rugMesh.position.set(-0.15, 0.006, 0.95);
  add(rugMesh, { cast: false });

  const dr = { x0: -1.35, x1: -0.15, z0: z1 - 0.42, top: 0.78 };
  const drMat = std(0x3d2c22, 0.55);
  box(dr.x1 - dr.x0, dr.top - 0.08, 0.42, drMat, (dr.x0 + dr.x1) / 2, (dr.top + 0.08) / 2, z1 - 0.21);
  for (const x of [dr.x0 + 0.05, dr.x1 - 0.05]) for (const z of [z1 - 0.38, z1 - 0.05]) box(0.04, 0.08, 0.04, frameMat, x, 0.04, z);
  const knobMat = std(0x8a7a5a, 0.35, { metalness: 0.8 });
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const dx = dr.x0 + 0.3 + col * 0.6, dy = 0.2 + row * 0.215;
      box(0.57, 0.19, 0.012, std(0x46332a, 0.5), dx, dy, z1 - 0.425, { cast: false });
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), knobMat);
      k.position.set(dx, dy, z1 - 0.438);
      add(k, { cast: false });
    }
  }
  collide(dr.x0, dr.x1, dr.z0, z1);
  blob(1.5, 0.8, (dr.x0 + dr.x1) / 2, z1 - 0.3, 0.6);
  // On the dresser: a leaning print, a candle, a stack of tapes.
  const frame = (tex, w, h, x, y, z, rotY, tilt = 0) => {
    const f = new THREE.Group();
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.016), std(0x101114, 0.5));
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std(0xffffff, 0.75, { map: tex }));
    pic.position.z = 0.0085;
    f.add(fr, pic);
    f.position.set(x, y, z);
    f.rotation.set(tilt, rotY, 0, 'YXZ');
    f.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    group.add(f);
    return f;
  };
  frame(T.posterType(), 0.36, 0.48, -1.0, dr.top + 0.255, z1 - 0.07, Math.PI, 0.12);
  frame(T.posterMoon(), 0.48, 0.64, x1 - 0.012, 1.62, -1.3, -Math.PI / 2);
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 20), std(0xd8d2c4, 0.6));
  candle.position.set(-0.45, dr.top + 0.045, z1 - 0.2);
  add(candle);
  for (let i = 0; i < 5; i++) box(0.11, 0.017, 0.07, std([0x1d1f25, 0xc0b8a8, 0x73303a, 0x2e4057, 0x1d1f25][i], 0.6), -0.68 + (i % 2) * 0.006, dr.top + 0.009 + i * 0.0175, z1 - 0.22);

  // A hoodie over the stool would hide the laptop from the bed, so it hangs on the door instead.
  const hook = box(0.02, 0.02, 0.05, frameMat, 1.12, 1.74, z1 - 0.045, { cast: false });
  hook.name = 'hook';
  {
    const g = weld(new THREE.BoxGeometry(0.42, 0.72, 0.09, 18, 26, 4));
    roundBox(g, 0.21, 0.36, 0.045, 0.04);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const hang = (0.36 - y) / 0.72;                               // 0 at the hook, 1 at the hem
      const fold = Math.sin(x * 26 + y * 3) * 0.012 * hang + (fbm(x * 5, y * 4, 3.1, 3) - 0.5) * 0.03;
      p.setXYZ(i, x * (0.55 + 0.45 * Math.min(1, hang * 2.2)), y, z + (z > 0 ? -fold : fold * 0.2));
    }
    g.computeVertexNormals();
    const hoodie = new THREE.Mesh(g, cloth(0x2a2c35, 30));
    hoodie.position.set(1.12, 1.38, z1 - 0.075);
    add(hoodie);
  }

  // Plant in the south-east corner.
  {
    const pl = new THREE.Group();
    pl.position.set(1.92, 0, 2.2);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.3, 24), std(0x8f8a80, 0.85));
    pot.position.y = 0.15;
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), std(0x17130f, 1));
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.285;
    pl.add(pot, soil);
    const leafMat = std(0x41705a, 0.55, { side: THREE.DoubleSide });
    const stemMat = std(0x2a3a2c, 0.7);
    const pr = rng(31);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2.6 + pr() * 0.5;
      const reach = 0.14 + pr() * 0.26, height = 0.4 + pr() * 0.7;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, height, 6), stemMat);
      stem.position.set(Math.cos(a) * reach * 0.5, 0.28 + height / 2, Math.sin(a) * reach * 0.5);
      stem.rotation.set(Math.sin(a) * reach * 0.6, 0, -Math.cos(a) * reach * 0.6);
      // Leaf: a pointed oval, creased down the middle and drooping at the tip.
      const lw = 0.13 + pr() * 0.07, ll = 0.36 + pr() * 0.18;
      const lg = new THREE.PlaneGeometry(lw * 2, ll, 6, 8);
      const lp = lg.attributes.position;
      for (let k = 0; k < lp.count; k++) {
        const u = lp.getX(k) / lw, v = clamp(lp.getY(k) / ll + 0.5, 0, 1);
        const widthAt = Math.sin(Math.PI * Math.pow(v, 0.75));
        lp.setXYZ(k, u * lw * widthAt, v * ll, Math.abs(u) * widthAt * 0.035 - v * v * 0.09);
      }
      lg.computeVertexNormals();
      const leaf = new THREE.Mesh(lg, leafMat);
      leaf.position.set(Math.cos(a) * reach, 0.28 + height, Math.sin(a) * reach);
      leaf.rotation.set(0.75 + pr() * 0.6, -a + Math.PI / 2, 0, 'YXZ');
      pl.add(stem, leaf);
    }
    pl.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(pl);
    collide(1.7, x1, 1.98, z1);
    blob(0.7, 0.7, 1.92, 2.2, 0.6);
  }

  // --- Sheer curtains, pushed to the ends of each window ----------------------------
  const sheer = new THREE.MeshStandardMaterial({ color: 0xc4cbdb, roughness: 1, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  const curtain = (w, x, z, rotY, seed) => {
    const hC = HEAD - 0.03;
    const g = new THREE.PlaneGeometry(w, hC, 48, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w + 0.5, v = p.getY(i) / hC + 0.5;
      const folds = Math.sin(u * Math.PI * 7 + seed) * 0.035 + Math.sin(u * Math.PI * 17 + seed * 3) * 0.008;
      p.setZ(i, folds * (0.55 + 0.45 * (1 - v)) + (noise3(u * 3, v * 2, seed) - 0.5) * 0.03);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, sheer);
    m.position.set(x, hC / 2 + 0.02, z);
    m.rotation.y = rotY;
    m.renderOrder = 2;
    add(m, { cast: false, receive: false });
  };
  curtain(0.55, x1 - 0.3, z0 + 0.13, 0, 1.0);
  curtain(0.5, x0 + 0.38, z0 + 0.13, 0, 2.7);
  curtain(0.6, x0 + 0.13, glassEnd - 0.33, Math.PI / 2, 4.1);
  box(W, 0.025, 0.03, frameMat, 0, HEAD - 0.012, z0 + 0.13, { cast: false });
  box(0.03, 0.025, glassEnd - z0, frameMat, x0 + 0.13, HEAD - 0.012, (z0 + glassEnd) / 2, { cast: false });

  blob(2.5, 1.9, bcx, bcz, 0.65);
  blob(0.6, 0.6, ns.x, ns.z, 0.5);

  return {
    group, colliders, interactables, updaters,
    refs: {
      screen, screenLight, lamp: { light: lampLight, shade: shadeMat, bulb: bulb.material, item: lampItem },
      cones, sleeves, deskTop: desk.top,
      turntableSpot: new THREE.Vector3(-1.9, desk.top, -0.77),
      poses: {
        lie: { pos: new THREE.Vector3(1.86, 0.79, -1.62), yaw: Math.PI / 2 - 0.25, pitch: 0.1, yawRange: 2.2, pitchMin: -0.5, pitchMax: 1.45, exit: new THREE.Vector3(1.2, 0, -0.2) },
        sit: { pos: new THREE.Vector3(-1.1, 1.14, -1.42), yaw: Math.PI / 2 + 0.15, pitch: -0.28, yawRange: 2.6, pitchMin: -1.0, pitchMax: 1.0, exit: new THREE.Vector3(-0.72, 0, -1.3) },
        deck: { pos: new THREE.Vector3(-1.18, 1.28, -0.5), yaw: Math.PI / 2 - 0.36, pitch: -0.9 },
        wall: { pos: new THREE.Vector3(-0.55, 1.45, 1.42), yaw: Math.PI / 2, pitch: -0.03 },
      },
    },
  };
}
