import * as THREE from 'three';

// Window glass. The city is drawn to a texture first; this shader looks that texture up at the
// pixel's own screen position, so the view through the pane is geometrically right, then bends
// and blurs it: misted glass is a blurry lookup, a water drop is a sharp lookup through a lens.

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tOutside;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uRain;      // 0..1 how hard it is raining
  uniform float uMist;      // 0..1 how fogged the pane is
  uniform float uFlash;
  uniform vec3 uRoomGlow;   // light from the room caught by the pane
  varying vec2 vPane;       // metres across the pane
  varying vec3 vWorld;

  float h11(float n) { return fract(sin(n * 91.345) * 47453.5453); }
  float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
  vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n * 37.0)); }

  // Beads that sit still, swell, and vanish. Returns (lens offset xy, coverage).
  vec3 beads(vec2 uv, float cell, float t) {
    vec2 g = uv / cell;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 rnd = h22(id);
    float life = fract(t * (0.02 + rnd.x * 0.05) + rnd.y);
    float alive = step(rnd.x, 0.25 + uRain * 0.6);
    vec2 c = (rnd - 0.5) * 0.6;
    float rad = (0.12 + 0.26 * rnd.y) * smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.75, life);
    vec2 d = f - c;
    float m = smoothstep(rad, rad * 0.55, length(d)) * alive;
    return vec3(d * m / max(rad, 0.001), m);
  }

  // Drops that run. One per tall cell; the cell grid scrolls down while the drop bobs inside
  // it, which reads as stick, slip, stick. Returns (lens xy, drop coverage, trail coverage).
  vec4 runners(vec2 uv, vec2 cell, float t, float seed) {
    float col = floor(uv.x / cell.x);
    float colRnd = h11(col + seed);
    float speed = 0.05 + colRnd * 0.11;
    vec2 p = uv;
    p.y += t * speed + colRnd * 7.0;
    vec2 g = p / cell;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 rnd = h22(id + seed);
    if (rnd.x > 0.18 + uRain * 0.36) return vec4(0.0);

    float phase = t * (0.35 + rnd.y * 0.5) + rnd.x * 6.283;
    // Sawtooth-like bob: slow climb relative to the grid (so it hangs), then a quick slide.
    float bob = sin(phase + sin(phase + sin(phase) * 0.5)) * 0.38;
    float x = (rnd.x - 0.5) * 0.5;
    float wiggle = uv.y * 9.0 + rnd.y * 20.0;
    x += sin(wiggle) * sin(wiggle * 2.3) * 0.11;

    vec2 d = (f - vec2(x, bob)) * vec2(1.0, cell.y / cell.x);
    d.y *= 0.72;                               // slightly tall, heavy at the bottom
    d.y -= d.x * d.x * 1.4;
    float rad = 0.20 + rnd.y * 0.14;
    float drop = smoothstep(rad, rad * 0.5, length(d));

    // The wet track it leaves: a clear stripe above the drop, beaded with leftovers.
    float above = smoothstep(bob - 0.02, bob + 0.04, f.y);
    float fadeUp = smoothstep(0.5, bob, f.y);
    float stripe = smoothstep(rad * 0.5, rad * 0.12, abs(f.x - x));
    float trail = stripe * above * fadeUp;

    // Leftover beads stay where they were dropped, so they are placed in pane space.
    float gap = cell.x * 0.5;
    vec2 tg = vec2(f.x - x, (fract(uv.y / gap + rnd.x) - 0.5) * 0.5);
    float bead = smoothstep(0.10, 0.05, length(tg)) * above * fadeUp;

    vec2 lens = d / rad * drop + tg / 0.10 * bead;
    return vec4(lens, max(drop, bead), trail);
  }

  // Rivulets: thin wavering threads of water, each a broken line running down its own lane.
  vec2 rivulets(vec2 uv, float t) {
    float lane = uv.x * 95.0;
    float id = floor(lane);
    float rnd = h11(id + 3.7);
    float fx = fract(lane) - 0.5 + sin(uv.y * (14.0 + rnd * 10.0) + rnd * 30.0) * 0.16;
    float flow = uv.y * (1.2 + rnd * 1.6) + t * (0.10 + rnd * 0.45) + rnd * 13.0;
    float a = h11(floor(flow) + id * 7.13), b = h11(floor(flow) + 1.0 + id * 7.13);
    float k = fract(flow);
    float run = smoothstep(0.62 - uRain * 0.22, 0.95, mix(a, b, k * k * (3.0 - 2.0 * k)));
    float line = smoothstep(0.26, 0.04, abs(fx)) * run;
    return vec2(fx * line, line);
  }

  vec3 lookup(vec2 uv, float lod) {
    // A few taps around the point hide the blocky look of plain mip blur.
    vec2 px = exp2(lod) / uRes;
    vec3 c = textureLod(tOutside, uv, lod).rgb * 0.4;
    c += textureLod(tOutside, uv + px * vec2(0.9, 0.35), lod).rgb * 0.15;
    c += textureLod(tOutside, uv + px * vec2(-0.35, 0.9), lod).rgb * 0.15;
    c += textureLod(tOutside, uv + px * vec2(-0.9, -0.35), lod).rgb * 0.15;
    c += textureLod(tOutside, uv + px * vec2(0.35, -0.9), lod).rgb * 0.15;
    return c;
  }

  void main() {
    vec2 screen = gl_FragCoord.xy / uRes;
    float t = uTime;
    vec2 uv = vPane;

    vec4 r1 = runners(uv, vec2(0.042, 0.34), t, 0.0);
    vec4 r2 = runners(uv * 1.37 + 3.1, vec2(0.042, 0.30), t * 1.2, 17.0);
    vec4 r3 = runners(uv * 0.61 + 9.7, vec2(0.042, 0.38), t * 0.8, 41.0);
    vec3 b1 = beads(uv, 0.026, t);
    vec3 b2 = beads(uv + 0.37, 0.011, t * 1.7);
    vec2 riv = rivulets(uv, t);

    float trail = max(r1.w, max(r2.w, r3.w * 0.8));
    // Small beads cannot survive where a runner just wiped the glass.
    b1 *= 1.0 - trail;
    b2 *= 1.0 - trail;

    riv *= 1.0 - trail;
    vec2 lens = r1.xy + r2.xy + r3.xy + b1.xy * 0.8 + b2.xy * 0.6 + vec2(riv.x * 1.6, 0.0);
    float water = clamp(r1.z + r2.z + r3.z + b1.z + b2.z + riv.y * 0.45, 0.0, 1.0);

    // How clear the glass is here: fully through water, mostly along fresh tracks.
    float clear = clamp(water + trail * 0.55, 0.0, 1.0);
    float lod = mix(0.8 + uMist * 2.9, 0.0, clear);

    // Water acts as a tiny wide-angle lens: it shows a flipped, shrunken piece of the view.
    vec2 bend = -lens * (0.045 + 0.02 * water);
    // The sheet of water itself wobbles the view a little.
    bend += 0.0025 * vec2(sin(uv.y * 31.0 + t * 0.7 + uv.x * 9.0), cos(uv.x * 27.0 - t * 0.5));
    vec3 col = lookup(screen + bend, lod);

    // Mist scatters light: lift the dark, flatten the contrast.
    float mist = (1.0 - clear) * uMist;
    col = mix(col, col * 0.86 + vec3(0.010, 0.013, 0.019), mist);

    // Rim and sparkle so drops read as volume.
    float rim = water * smoothstep(0.35, 1.0, length(lens));
    col *= 1.0 - rim * 0.45;
    vec3 n = normalize(vec3(lens * 1.4, 1.0));
    float spec = pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 40.0);
    col += water * spec * vec3(0.42, 0.52, 0.70) * (0.55 + uFlash * 4.0);

    // The room, faintly, in the pane.
    col += uRoomGlow * (0.6 + 0.4 * mist);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createGlassMaterial(outsideTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tOutside: { value: outsideTexture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uRain: { value: 0.75 },
      uMist: { value: 0.5 },
      uFlash: { value: 0 },
      uRoomGlow: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aPane;
      varying vec2 vPane; varying vec3 vWorld;
      void main() {
        vPane = aPane;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: fragment,
  });
}
