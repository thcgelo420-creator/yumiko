import { rng } from './util.js';

// --- Room tone: rain, record crackle, thunder. The rain is a recording; the rest is synthesised. ---

const RAIN_URL = new URL('../audio/rain.mp3', import.meta.url);
// At the default rain setting, away from the glass, the rain sits about 20 dB under a record.
const RAIN_GAIN = 1.2;

// Folds the end of a recording over its start so it loops without a seam. The margin skips encoder padding.
function seamless(ctx, src, fade = 1.5, margin = 0.15) {
  const sr = src.sampleRate, m = Math.floor(margin * sr), f = Math.floor(fade * sr);
  const n = src.length - 2 * m - f;
  if (n <= f) return src;
  const out = ctx.createBuffer(src.numberOfChannels, n, sr);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const s = src.getChannelData(ch), d = out.getChannelData(ch);
    d.set(s.subarray(m, m + n));
    for (let i = 0; i < f; i++) {
      const k = (i / f) * Math.PI / 2;
      d[i] = s[m + i] * Math.sin(k) + s[m + n + i] * Math.cos(k);
    }
  }
  return out;
}

export function createAmbience() {
  let ctx = null, rainGain, crackleGain, master, crackleBuf, crackleSrc = null;
  let rainLevel = 0.55, nearGlass = 0, raining = false, muffle, crackleOn = false;
  const rainFile = fetch(RAIN_URL).then((res) => (res.ok ? res.arrayBuffer() : null)).catch(() => null);

  // The slider is squared so its lower half is usable; nearer the glass the rain is louder.
  const rainTarget = () => (raining ? rainLevel * rainLevel * (0.7 + nearGlass * 0.45) * RAIN_GAIN : 0);

  function crackleBuffer() {
    const sr = ctx.sampleRate;
    const r = rng(5150);
    // Crackle: a quiet bed of surface noise with sparse pops.
    const clen = Math.floor(sr * 5);
    crackleBuf = ctx.createBuffer(1, clen, sr);
    const c = crackleBuf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < clen; i++) {
      lp = lp * 0.9 + (r() * 2 - 1) * 0.1;
      c[i] = lp * 0.05;
    }
    for (let k = 0; k < 150; k++) {
      const at = Math.floor(r() * (clen - 200));
      const amp = Math.pow(r(), 4) * 0.9 + 0.03;
      for (let i = 0; i < 40 + r() * 100; i++) c[at + i] += (r() * 2 - 1) * amp * Math.exp(-i / (4 + r() * 12));
    }
  }

  return {
    get ctx() { return ctx; },
    start() {
      if (ctx) { ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      crackleBuffer();
      master = ctx.createGain();
      master.connect(ctx.destination);
      // The glass takes the top off the rain.
      muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 4500;
      muffle.Q.value = -3;
      const body = ctx.createBiquadFilter();
      body.type = 'highpass';
      body.frequency.value = 400;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      body.connect(muffle).connect(rainGain).connect(master);
      rainFile
        .then((bytes) => bytes && new Promise((ok, no) => ctx.decodeAudioData(bytes, ok, no)))
        .then((recording) => {
          if (!recording) return;
          // Two layers of the one loop, the second slower, deeper and quieter, so the pattern does not come round.
          const loop = seamless(ctx, recording);
          for (const [rate, offset, level] of [[1, 0, 1], [0.83, 9, 0.45]]) {
            const src = ctx.createBufferSource(), layer = ctx.createGain();
            src.buffer = loop;
            src.loop = true;
            src.playbackRate.value = rate;
            layer.gain.value = level;
            src.connect(layer).connect(body);
            src.start(0, offset);
          }
          raining = true;
          rainGain.gain.setTargetAtTime(rainTarget(), ctx.currentTime, 1);
        })
        .catch(() => { /* no rain sound; the room still works */ });
      crackleGain = ctx.createGain();
      crackleGain.gain.value = 0;
      crackleGain.connect(master);
    },
    setRain(v) {
      rainLevel = v;
      if (ctx) rainGain.gain.setTargetAtTime(rainTarget(), ctx.currentTime, 0.2);
    },
    // Nearer the glass the rain is louder and brighter.
    setNearGlass(k) {
      nearGlass = k;
      if (!ctx) return;
      muffle.frequency.setTargetAtTime(4500 + k * 3000, ctx.currentTime, 0.4);
      rainGain.gain.setTargetAtTime(rainTarget(), ctx.currentTime, 0.4);
    },
    crackle(on, level = 0.5) {
      if (!ctx) return;
      if (on && !crackleSrc) {
        crackleSrc = ctx.createBufferSource();
        crackleSrc.buffer = crackleBuf;
        crackleSrc.loop = true;
        crackleSrc.connect(crackleGain);
        crackleSrc.start();
      }
      crackleOn = on;
      crackleGain.gain.setTargetAtTime(on ? level * 0.22 : 0, ctx.currentTime, on ? 0.05 : 0.4);
    },
    // Follow the music volume while a record is already crackling.
    setCrackleLevel(level) {
      if (ctx && crackleOn) crackleGain.gain.setTargetAtTime(level * 0.22, ctx.currentTime, 0.05);
    },
    // The soft thump of a stylus landing.
    needleDrop(level = 0.5) {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(110, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.18);
      g.gain.setValueAtTime(level * 0.5, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.32);
    },
    thunder(strength = 0.5) {
      if (!ctx) return;
      const sr = ctx.sampleRate, len = Math.floor(sr * 6);
      const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / sr;
        b = b * 0.985 + (Math.random() * 2 - 1) * 0.12;
        const roll = 0.55 + 0.45 * Math.sin(tt * 5.3 + Math.sin(tt * 2.1) * 2.0);
        d[i] = b * roll * Math.min(1, tt * 6) * Math.exp(-tt * 0.75);
      }
      const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf;
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      g.gain.value = strength * rainLevel * rainLevel * 1.6;
      src.connect(lp).connect(g).connect(master);
      src.start();
    },
  };
}

// --- The jukebox: plays a record's tracks through YouTube's player or an <audio> element. ----

let ytReady = null;
function loadYouTube() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytReady = null; reject(new Error('YouTube player could not be loaded')); };
    document.head.appendChild(s);
  });
  return ytReady;
}

export function parseYouTubeId(text) {
  const t = text.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export class Jukebox extends EventTarget {
  constructor(holderId) {
    super();
    this.holderId = holderId;
    this.record = null;
    this.index = -1;
    this.playing = false;      // sound is (meant to be) coming out
    this.volume = 0.7;
    this.kind = null;          // 'yt' | 'file'
    this.yt = null;
    this.ytOk = false;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.failures = 0;
    this.token = 0;
    this.audio.addEventListener('ended', () => this.kind === 'file' && this.#ended());
    this.audio.addEventListener('error', () => this.kind === 'file' && this.audio.src && this.#failed('that file would not play'));
    this.audio.addEventListener('playing', () => { if (this.kind === 'file') { this.failures = 0; this.#set(true); } });
    this.audio.addEventListener('pause', () => { if (this.kind === 'file' && !this.audio.ended) this.#set(false); });
  }

  get track() { return this.record ? this.record.tracks[this.index] : null; }
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #set(playing) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.#emit('state');
  }

  async #ensureYT() {
    if (this.yt) return this.ytPromise;
    const YT = await loadYouTube();
    this.ytPromise = new Promise((resolve) => {
      this.yt = new YT.Player(this.holderId, {
        width: 256, height: 144,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => { this.ytOk = true; this.yt.setVolume(this.volume * 100); resolve(); },
          onStateChange: (e) => {
            if (this.kind !== 'yt') return;
            const S = YT.PlayerState;
            if (e.data === S.PLAYING) { this.failures = 0; this.#set(true); }
            else if (e.data === S.PAUSED) this.#set(false);
            else if (e.data === S.ENDED) this.#ended();
          },
          onError: (e) => {
            if (this.kind !== 'yt') return;
            const blocked = e.data === 101 || e.data === 150;
            this.#failed(blocked ? 'that upload does not allow playback here' : 'that video is unavailable');
          },
        },
      });
    });
    return this.ytPromise;
  }

  // Warm the YouTube player up early so the first needle drop is quick.
  warm() { this.#ensureYT().catch(() => {}); }

  #silence() {
    this.audio.pause();
    if (this.ytOk) try { this.yt.stopVideo(); } catch { /* player not ready */ }
  }

  // Pick the track; nothing is audible until start() is called (after the needle lands).
  cue(record, index) {
    this.token++;
    this.#silence();
    // The give-up count is per record: an earlier record's dead tracks must not count against this one.
    if (record !== this.record) this.failures = 0;
    this.record = record;
    this.index = index;
    this.kind = null;
    this.#set(false);
    this.#emit('track');
  }

  async start() {
    const track = this.track, token = this.token;
    if (!track) return;
    if (track.yt) {
      this.kind = 'yt';
      try {
        await this.#ensureYT();
      } catch (err) {
        if (token === this.token) this.#failed('YouTube could not be reached');
        return;
      }
      if (token !== this.token) return;
      this.yt.setVolume(this.volume * 100);
      this.yt.loadVideoById(track.yt);
    } else {
      this.kind = 'file';
      this.audio.src = track.src;
      this.audio.volume = this.volume;
      this.audio.play().catch(() => this.#emit('blocked'));
    }
    this.#emit('track');
  }

  #ended() {
    this.#set(false);
    this.#emit('ended');
  }

  #failed(reason) {
    this.failures++;
    this.#set(false);
    this.#emit('error', { reason, track: this.track, giveUp: !this.record || this.failures >= this.record.tracks.length });
  }

  toggle() {
    if (!this.track || !this.kind) return;
    if (this.kind === 'yt' && this.ytOk) this.playing ? this.yt.pauseVideo() : this.yt.playVideo();
    else if (this.kind === 'file') this.playing ? this.audio.pause() : this.audio.play().catch(() => {});
  }

  stop() {
    this.token++;
    this.#silence();
    this.kind = null;
    this.record = null;
    this.index = -1;
    this.#set(false);
    this.#emit('track');
  }

  setVolume(v) {
    this.volume = v;
    this.audio.volume = v;
    if (this.ytOk) this.yt.setVolume(v * 100);
  }

  // 0..1 through the current track, or 0 when unknown.
  progress() {
    try {
      if (this.kind === 'yt' && this.ytOk) {
        const d = this.yt.getDuration();
        return d > 0 ? this.yt.getCurrentTime() / d : 0;
      }
      if (this.kind === 'file' && this.audio.duration > 0) return this.audio.currentTime / this.audio.duration;
    } catch { /* not ready */ }
    return 0;
  }

  // Title as YouTube reports it, used to name tracks pasted in by link.
  liveTitle() {
    try { return this.kind === 'yt' && this.ytOk ? this.yt.getVideoData().title : ''; } catch { return ''; }
  }
}
