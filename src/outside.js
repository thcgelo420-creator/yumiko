import * as THREE from 'three';
import { rng } from './util.js';

// Everything beyond the glass: sky, a fogged-in city, traffic, falling rain.
// It lives in its own scene and is drawn into a texture that the window shader reads.

const FOG = new THREE.Color(0.150, 0.180, 0.235);
const GROUND_Y = -96;

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform float uFlash;
  vec3 applyFog(vec3 col, vec3 world) {
    float d = length(world - cameraPosition);
    // Thicker near the ground, so streets dissolve into a glow.
    float low = smoothstep(40.0, -96.0, world.y);
    float f = 1.0 - exp(-pow(d * uFogDensity * (1.0 + low * 0.25), 1.35));
    return mix(col, uFog * (1.0 + uFlash * 2.5), clamp(f, 0.0, 1.0));
  }
`;

export function createOutside() {
  const scene = new THREE.Scene();
  const shared = {
    uTime: { value: 0 },
    uFog: { value: FOG },
    uFogDensity: { value: 0.0056 },
    uFlash: { value: 0 },
  };

  // --- Sky -----------------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: shared,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = modelViewMatrix * vec4(position, 0.0);
          gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
          gl_Position.z = gl_Position.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uFog; uniform float uFlash;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.02+7.1; a*=0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 zenith = vec3(0.060, 0.078, 0.118);
          vec3 col = mix(uFog, zenith, smoothstep(0.0, 0.75, h));
          // Low cloud deck sliding past.
          vec2 cuv = d.xz / max(0.12, d.y + 0.25) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
          float c = fbm(cuv);
          col += (c - 0.5) * 0.05 * smoothstep(-0.05, 0.4, h);
          // The city lights the underside of the clouds.
          col += vec3(0.10, 0.065, 0.045) * 0.22 * smoothstep(0.35, -0.05, h) * (0.6 + c);
          col *= 1.0 + uFlash * (2.0 + 4.0 * c);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // --- Buildings -------------------------------------------------------------
  const r = rng(20240);
  const blocks = [];
  const addTower = (x, z, w, d, h, lit) => blocks.push({ x, z, w, d, h, lit, seed: r() * 100 });

  // Hand-placed towers that frame the two windows (north is -z, west is -x).
  addTower(-52, -150, 30, 30, 196, 0.10);
  addTower(46, -205, 38, 34, 168, 0.14);
  addTower(96, -128, 26, 26, 132, 0.12);
  addTower(-150, -250, 34, 44, 240, 0.08);
  addTower(-168, -58, 30, 32, 176, 0.12);
  addTower(-130, 62, 26, 28, 140, 0.14);
  addTower(-270, -150, 40, 40, 250, 0.07);
  addTower(-10, -330, 44, 38, 215, 0.09);
  addTower(170, -260, 34, 34, 185, 0.10);
  addTower(-84, -84, 18, 20, 84, 0.16);

  // Then a loose street grid of lower blocks filling the rest.
  const STEP = 46;
  for (let gx = -16; gx <= 9; gx++) {
    for (let gz = -16; gz <= 6; gz++) {
      const cx = gx * STEP + (r() - 0.5) * 8;
      const cz = gz * STEP + (r() - 0.5) * 8;
      const dist = Math.hypot(cx, cz);
      if (dist < 62) continue;                        // our own building's footprint
      if (cx > 40 && cz > 20) continue;               // never visible from the room
      if (blocks.some((b) => Math.abs(b.x - cx) < (b.w + 30) / 2 && Math.abs(b.z - cz) < (b.d + 30) / 2)) continue;
      const tall = r();
      let h = 26 + r() * 44;
      if (tall > 0.8) h = 66 + r() * 50;
      if (tall > 0.97 && dist > 170) h = 120 + r() * 80;
      const w = 18 + r() * 18, d = 18 + r() * 18;
      addTower(cx, cz, w, d, h, 0.05 + r() * 0.13);
      if (r() > 0.6) addTower(cx + (r() - 0.5) * 10, cz + (r() - 0.5) * 10, w * 0.5, d * 0.5, h + 6 + r() * 16, 0.04 + r() * 0.1);
    }
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const count = blocks.length;
  const aSize = new Float32Array(count * 3);
  const aSeed = new Float32Array(count * 2);
  const city = new THREE.InstancedMesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader: /* glsl */ `
        attribute vec3 aSize; attribute vec2 aSeed;
        varying vec3 vLocal; varying vec3 vNormal; varying vec3 vWorld; varying vec2 vSeed; varying vec3 vSize;
        void main() {
          vLocal = position * aSize;
          vSize = aSize;
          vNormal = normal;
          vSeed = aSeed;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vLocal; varying vec3 vNormal; varying vec3 vWorld; varying vec2 vSeed; varying vec3 vSize;
        ${FOG_GLSL}
        float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        void main() {
          vec3 n = normalize(vNormal);
          vec3 base = vec3(0.020, 0.026, 0.038) * (0.7 + vSeed.x * 0.006);
          vec3 col = base;
          if (abs(n.y) < 0.5) {
            float u = abs(n.x) > 0.5 ? vLocal.z : vLocal.x;
            u += abs(n.x) > 0.5 ? vSize.z * 0.5 : vSize.x * 0.5;
            float side = abs(n.x) > 0.5 ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
            vec2 cellSize = vec2(3.1, 3.5);
            vec2 g = vec2(u, vLocal.y) / cellSize;
            vec2 id = floor(g);
            vec2 f = fract(g);
            float rnd = hash(id + vSeed.x + side * 17.0);
            // Whole floors go dark together now and then; offices switch off in runs.
            float floorRnd = hash(vec2(id.y, vSeed.x * 3.1));
            float lit = step(rnd, vSeed.y * (0.3 + 1.4 * floorRnd * floorRnd));
            float win = smoothstep(0.16, 0.22, f.x) * smoothstep(0.84, 0.78, f.x) * smoothstep(0.30, 0.36, f.y) * smoothstep(0.80, 0.74, f.y);
            float tone = hash(id * 1.7 + vSeed.x + 3.0);
            vec3 warm = vec3(1.0, 0.62, 0.30);
            vec3 cool = vec3(0.55, 0.75, 1.0);
            vec3 tv = vec3(0.35, 0.55, 1.0) * (0.6 + 0.4 * sin(uTime * (3.0 + tone * 9.0) + rnd * 40.0));
            vec3 lamp = tone < 0.68 ? warm : (tone < 0.93 ? cool : tv);
            float bright = 0.35 + 1.5 * pow(hash(id + 9.0 + vSeed.x), 2.0);
            col += lamp * lit * win * bright * 0.9;
            // Dark glass still catches a little sky.
            col += vec3(0.02, 0.03, 0.045) * win * (1.0 - lit) * smoothstep(0.0, 200.0, vLocal.y);
            // Edge of the slab.
            col *= 0.75 + 0.25 * smoothstep(0.0, 0.6, min(u, (abs(n.x) > 0.5 ? vSize.z : vSize.x) - u));
          } else {
            col = base * 1.4;
          }
          gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
        }
      `,
    }),
    count
  );
  const m = new THREE.Matrix4();
  blocks.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d);
    m.setPosition(b.x, GROUND_Y, b.z);
    city.setMatrixAt(i, m);
    aSize.set([b.w, b.h, b.d], i * 3);
    aSeed.set([b.seed, b.lit], i * 2);
  });
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 2));
  city.frustumCulled = false;
  scene.add(city);

  // Ground plane so the gaps between blocks read as wet streets, not sky.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader: /* glsl */ `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld; ${FOG_GLSL}
        void main(){ gl_FragColor = vec4(applyFog(vec3(0.03, 0.022, 0.018), vWorld), 1.0); }
      `,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);

  // --- Points of light: street lamps, traffic, signs, beacons ----------------
  const pts = { pos: [], col: [], size: [], move: [], blink: [] };
  const addPoint = (x, y, z, c, size, move = [0, 0, 0, 0], blink = 0) => {
    pts.pos.push(x, y, z);
    pts.col.push(c[0], c[1], c[2]);
    pts.size.push(size);
    pts.move.push(...move);
    pts.blink.push(blink);
  };
  const SODIUM = [1.0, 0.50, 0.16], HEAD = [0.95, 0.95, 1.0], TAIL = [1.0, 0.08, 0.05];
  for (let g = -16; g <= 9; g++) {
    const line = g * STEP + STEP / 2;
    for (let s = -740; s < 420; s += 15) {
      if (r() > 0.25) addPoint(line + 5, GROUND_Y + 7, s, SODIUM, 2.6 + r() * 1.2);
      if (r() > 0.25) addPoint(s, GROUND_Y + 7, line + 5, SODIUM, 2.6 + r() * 1.2);
    }
    // Cars: each one loops along its street. move = (dirX, dirZ, speed, span).
    for (let k = 0; k < 16; k++) {
      const speed = 7 + r() * 9, start = -740 + r() * 1160;
      const fwd = r() > 0.5;
      addPoint(line + (fwd ? 2 : -2), GROUND_Y + 1, start, fwd ? HEAD : TAIL, 2.0, [0, fwd ? 1 : -1, speed, 1160]);
      addPoint(start, GROUND_Y + 1, line + (fwd ? -2 : 2), fwd ? TAIL : HEAD, 2.0, [fwd ? -1 : 1, 0, speed, 1160]);
    }
  }
  // Neon signs and lit shopfronts low on the towers; red beacons on the tall roofs.
  const NEON = [[0.25, 0.55, 1.0], [1.0, 0.25, 0.45], [0.2, 1.0, 0.85], [1.0, 0.72, 0.2], [0.75, 0.4, 1.0]];
  for (const b of blocks) {
    if (b.h > 120) addPoint(b.x, GROUND_Y + b.h + 3, b.z, [1.0, 0.06, 0.04], 3.4, [0, 0, 0, 0], 1 + r() * 3);
    if (r() > 0.55) {
      const c = NEON[Math.floor(r() * NEON.length)];
      const face = r() > 0.5;
      const y = GROUND_Y + 8 + r() * Math.min(40, b.h * 0.5);
      const n = 3 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const o = (i - n / 2) * 1.6;
        if (face) addPoint(b.x + o, y, b.z + b.d / 2 + 0.5, c, 3.2);
        else addPoint(b.x + b.w / 2 + 0.5, y, b.z + o, c, 3.2);
      }
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pts.pos, 3));
  pg.setAttribute('aColor', new THREE.Float32BufferAttribute(pts.col, 3));
  pg.setAttribute('aSize', new THREE.Float32BufferAttribute(pts.size, 1));
  pg.setAttribute('aMove', new THREE.Float32BufferAttribute(pts.move, 4));
  pg.setAttribute('aBlink', new THREE.Float32BufferAttribute(pts.blink, 1));
  const lights = new THREE.Points(
    pg,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { ...shared, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uScale; uniform float uFogDensity;
        attribute vec3 aColor; attribute float aSize; attribute vec4 aMove; attribute float aBlink;
        varying vec3 vColor; varying float vFade;
        void main() {
          vec3 p = position;
          if (aMove.w > 0.0) {
            float start = dot(position.xz, abs(aMove.xy));
            float along = mod(start + (aMove.x + aMove.y) * uTime * aMove.z + 740.0, aMove.w) - 740.0;
            p.xz = mix(p.xz, vec2(along), abs(aMove.xy));
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = length(mv.xyz);
          // Fog eats the core but leaves a wide, dim halo: scale up a little with distance.
          vFade = exp(-pow(d * uFogDensity * 0.85, 1.25));
          float blink = aBlink > 0.0 ? smoothstep(0.75, 0.9, sin(uTime * 1.9 + aBlink * 7.0)) : 1.0;
          vColor = aColor * blink;
          gl_PointSize = clamp(aSize * uScale / d * (1.0 + d * 0.004), 1.0, 60.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(0.35, 0.0, d);
          float halo = pow(max(0.0, 1.0 - d), 2.5);
          gl_FragColor = vec4(vColor * (core * 3.2 + halo * 0.8) * vFade, 1.0);
        }
      `,
    })
  );
  lights.frustumCulled = false;
  scene.add(lights);

  // --- Rain falling past the windows ------------------------------------------
  const DROPS = 2600;
  const rp = new Float32Array(DROPS * 6), ro = new Float32Array(DROPS * 4), re = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    // Keep it to the two glazed sides: a band north of the room and a band to the west.
    let x, z;
    if (r() < 0.55) { x = -9 + r() * 15; z = -2.6 - r() * 16; }
    else { x = -2.7 - r() * 16; z = -9 + r() * 13; }
    const y = r() * 14;
    const speed = 13 + r() * 6, len = 0.35 + r() * 0.55;
    for (let k = 0; k < 2; k++) {
      rp.set([x, y, z], i * 6 + k * 3);
      ro.set([speed, len], i * 4 + k * 2);
      re[i * 2 + k] = k;
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rg.setAttribute('aRain', new THREE.BufferAttribute(ro, 2));
  rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
  const rain = new THREE.LineSegments(
    rg,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: shared,
      vertexShader: /* glsl */ `
        uniform float uTime; attribute vec2 aRain; attribute float aEnd; varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * aRain.x, 14.0) - 6.0 + aEnd * aRain.y;
          p.x += aEnd * aRain.y * 0.12;   // wind lean
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (1.0 - aEnd * 0.7) * smoothstep(22.0, 3.0, length(mv.xyz));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlash; varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.34, 0.40, 0.50) * vA * (0.28 + uFlash * 2.0), 1.0); }
      `,
    })
  );
  rain.frustumCulled = false;
  scene.add(rain);

  return {
    scene,
    uniforms: shared,
    fogColor: FOG,
    update(t, flash, pixelScale) {
      shared.uTime.value = t;
      shared.uFlash.value = flash;
      lights.material.uniforms.uScale.value = pixelScale;
    },
  };
}
