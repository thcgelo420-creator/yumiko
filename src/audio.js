import { rng } from './util.js';

// --- Room tone: rain, record crackle, thunder. All synthesised, nothing to download. -------

export function createAmbience() {
  let ctx = null, rainGain, crackleGain, master, rainBuf, crackleBuf, crackleSrc = null;
  let rainLevel = 0.55, muffle;

  function noiseBuffers() {
    const sr = ctx.sampleRate;
    // Rain: pink-ish hiss, plus thousands of tiny ticks for drops hitting the pane.
    const len = Math.floor(sr * 9);
    rainBuf = ctx.createBuffer(2, len, sr);
    const r = rng(5150);
    for (let ch = 0; ch < 2; ch++) {
      const d = rainBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      }
      const ticks = 5200;
      for (let k = 0; k < ticks; k++) {
        const at = Math.floor(r() * (len - 900));
        const amp = Math.pow(r(), 3) * 0.5;
        const decay = 60 + r() * 500;
        const tone = 0.15 + r() * 0.6;
        let ph = 0;
        for (let i = 0; i < 800; i++) {
          ph += tone;
          d[at + i] += Math.sin(ph) * Math.exp(-i / decay) * amp * (r() * 0.6 + 0.4);
        }
      }
      // Fade the loop point so it does not click.
      const f = Math.floor(sr * 0.05);
      for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[len - 1 - i] *= k; }
    }
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
      noiseBuffers();
      master = ctx.createGain();
      master.connect(ctx.destination);
      // The glass takes the top off the rain.
      muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 2600;
      muffle.Q.value = 0.3;
      const body = ctx.createBiquadFilter();
      body.type = 'highpass';
      body.frequency.value = 140;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      const src = ctx.createBufferSource();
      src.buffer = rainBuf;
      src.loop = true;
      src.connect(body).connect(muffle).connect(rainGain).connect(master);
      src.start();
      rainGain.gain.linearRampToValueAtTime(rainLevel * 0.9, ctx.currentTime + 3);
      crackleGain = ctx.createGain();
      crackleGain.gain.value = 0;
      crackleGain.connect(master);
    },
    setRain(v) {
      rainLevel = v;
      if (ctx) rainGain.gain.setTargetAtTime(v * 0.9, ctx.currentTime, 0.2);
    },
    // Nearer the glass the rain is louder and brighter.
    setNearGlass(k) {
      if (!ctx) return;
      muffle.frequency.setTargetAtTime(2200 + k * 2600, ctx.currentTime, 0.4);
      rainGain.gain.setTargetAtTime(rainLevel * (0.7 + k * 0.45), ctx.currentTime, 0.4);
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
      crackleGain.gain.setTargetAtTime(on ? level * 0.22 : 0, ctx.currentTime, on ? 0.05 : 0.4);
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
      g.gain.value = strength * rainLevel * 2.2;
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
