import { ALL_RECORDS } from './records.js';
import { getCover } from './covers.js';

const $ = (id) => document.getElementById(id);
const PREFS = 'yumiko.prefs.v1';

export function createUI(handlers) {
  const el = {
    hud: $('hud'), prompt: $('prompt'), toast: $('toast'), hints: $('hints'), np: $('nowplaying'),
    npTitle: $('np-title'), npArtist: $('np-artist'), npBar: $('np-bar').firstElementChild, npDisc: $('np-disc'),
    picker: $('picker'), sleeves: $('sleeves'), tracks: $('tracks'), dArtist: $('detail-artist'), dTitle: $('detail-title'),
    own: $('own'), ownForm: $('own-form'), ownUrl: $('own-url'), ownFiles: $('own-files'),
    menu: $('menu'), enter: $('enter'), load: $('menu-load'), drop: $('drop'), touch: $('touch'),
    play: $('tp-play'), prev: $('tp-prev'), next: $('tp-next'), stop: $('tp-stop'),
  };
  const prefs = { music: 70, rain: 55, sens: 100, thunder: true, lowq: false, video: true, lamp: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch { /* use defaults */ }
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ } };

  let selected = ALL_RECORDS[0];
  let now = { record: null, index: -1, playing: false };
  let toastTimer = 0, hintTimer = 0, promptText = '';

  // ---- settings ----
  const bind = (id, key, isCheck) => {
    const input = $(id);
    if (isCheck) input.checked = prefs[key]; else input.value = prefs[key];
    input.addEventListener('input', () => {
      prefs[key] = isCheck ? input.checked : Number(input.value);
      savePrefs();
      handlers.onPrefs(prefs, key);
    });
  };
  bind('s-music', 'music'); bind('s-rain', 'rain'); bind('s-sens', 'sens');
  bind('s-thunder', 'thunder', true); bind('s-lowq', 'lowq', true);

  // ---- record crate ----
  const coverUrl = (record) => {
    try { return getCover(record).canvas.toDataURL('image/jpeg', 0.82); } catch { return ''; }
  };
  const sleeveButtons = new Map();
  for (const record of ALL_RECORDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sleeve';
    b.setAttribute('role', 'option');
    b.style.setProperty('--label', record.colors[0]);
    b.innerHTML = '<div class="art"><i class="disc"></i><i class="cover"></i></div><div class="who"></div><div class="what"></div>';
    b.querySelector('.who').textContent = record.artist.toLowerCase();
    b.querySelector('.what').textContent = record.title;
    b.querySelector('.cover').style.backgroundImage = `url(${coverUrl(record)})`;
    b.addEventListener('click', () => { select(record); });
    b.addEventListener('dblclick', () => { if (record.tracks.length) handlers.onPlay(record, 0); });
    el.sleeves.appendChild(b);
    sleeveButtons.set(record.id, b);
  }
  window.addEventListener('cover', (e) => {
    const record = ALL_RECORDS.find((r) => r.id === e.detail);
    if (record) sleeveButtons.get(record.id).querySelector('.cover').style.backgroundImage = `url(${coverUrl(record)})`;
  });

  function renderTracks() {
    el.dArtist.textContent = selected.artist.toLowerCase();
    el.dTitle.textContent = selected.own
      ? (selected.tracks.length ? `${selected.tracks.length} of your own` : 'nothing pressed yet')
      : `${selected.title} · ${selected.tracks.length} tracks`;
    el.tracks.replaceChildren();
    selected.tracks.forEach((track, i) => {
      const li = document.createElement('li');
      if (now.record === selected && now.index === i) li.className = 'current';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'play';
      const span = document.createElement('span');
      span.textContent = track.title;
      play.appendChild(span);
      play.addEventListener('click', () => handlers.onPlay(selected, i));
      li.appendChild(play);
      if (selected.own) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.textContent = 'remove';
        rm.setAttribute('aria-label', `Remove ${track.title}`);
        rm.addEventListener('click', () => handlers.onRemoveOwn(i));
        li.appendChild(rm);
      }
      el.tracks.appendChild(li);
    });
    el.own.hidden = !selected.own;
    for (const [id, b] of sleeveButtons) {
      b.setAttribute('aria-selected', String(id === selected.id));
      b.classList.toggle('on', now.record != null && now.record.id === id);
    }
    el.play.textContent = now.playing ? 'pause' : 'play';
    el.prev.disabled = el.next.disabled = el.stop.disabled = !now.record;
    el.play.disabled = !now.record && !selected.tracks.length;
  }
  function select(record) {
    selected = record;
    renderTracks();
  }

  $('picker-close').addEventListener('click', () => handlers.onClosePicker());
  el.play.addEventListener('click', () => (now.record ? handlers.onToggle() : selected.tracks.length && handlers.onPlay(selected, 0)));
  el.prev.addEventListener('click', () => handlers.onSkip(-1));
  el.next.addEventListener('click', () => handlers.onSkip(1));
  el.stop.addEventListener('click', () => handlers.onStop());
  el.ownForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = el.ownUrl.value;
    if (v.trim()) handlers.onAddLink(v).then((ok) => { if (ok) el.ownUrl.value = ''; });
  });
  el.ownFiles.addEventListener('change', () => { handlers.onAddFiles(el.ownFiles.files); el.ownFiles.value = ''; });
  // Typing a link must not walk the player around.
  el.ownUrl.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });

  // ---- drag audio files in ----
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; el.drop.hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.drop.hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.drop.hidden = true;
    handlers.onAddFiles(e.dataTransfer.files);
  });

  el.enter.addEventListener('click', () => handlers.onEnter());
  el.np.classList.toggle('no-video', !prefs.video);

  return {
    prefs, savePrefs, el,
    ready() {
      el.enter.disabled = false;
      el.load.textContent = 'best with headphones';
    },
    loading(text) { el.enter.disabled = true; el.load.textContent = text; },
    fail(text) { el.enter.hidden = true; el.load.textContent = text; },
    showMenu(paused) {
      el.menu.inert = false;
      el.menu.classList.remove('gone');
      el.menu.classList.toggle('paused', paused);
      if (paused) { el.enter.textContent = 'back to the room'; el.load.textContent = ''; }
    },
    hideMenu() {
      // Faded out is not gone: without this, Tab could still land on its button.
      el.menu.inert = true;
      el.menu.classList.add('gone');
      el.hud.hidden = false;
      clearTimeout(hintTimer);
      el.hints.classList.remove('quiet');
      hintTimer = setTimeout(() => el.hints.classList.add('quiet'), 14000);
    },
    setTouch(on) {
      document.body.classList.toggle('touch', on);
      el.touch.hidden = !on;
    },
    prompt(text, focused) {
      el.hud.classList.toggle('focus', !!focused);
      if (text === promptText) return;
      promptText = text;
      if (text) el.prompt.innerHTML = text;
      el.prompt.classList.toggle('show', !!text);
    },
    setMode({ posed, picking, free }) {
      el.hud.classList.toggle('posed', !!posed);
      el.hud.classList.toggle('picking', !!picking);
      el.hud.classList.toggle('free', !!free);
    },
    toast(text, ms = 3600) {
      el.toast.textContent = text;
      el.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
    },
    openPicker(record) {
      el.picker.hidden = false;
      select(record || now.record || selected);
      // Focus the sheet, not a control: Space keeps meaning play / pause until Tab picks a control.
      if (selected.own && !selected.tracks.length) el.ownUrl.focus({ preventScroll: true });
      else el.picker.focus({ preventScroll: true });
    },
    closePicker() { el.picker.hidden = true; },
    get pickerOpen() { return !el.picker.hidden; },
    refreshOwn() { renderTracks(); },
    toggleVideo() {
      prefs.video = !prefs.video;
      savePrefs();
      el.np.classList.toggle('no-video', !prefs.video);
      return prefs.video;
    },
    nowPlaying(state) {
      now = state;
      const track = state.record ? state.record.tracks[state.index] : null;
      el.np.classList.toggle('np-empty', !track);
      el.np.classList.toggle('spinning', !!track && state.playing);
      el.npTitle.textContent = track ? track.title : 'nothing playing';
      el.npArtist.textContent = track ? `${state.record.artist.toLowerCase()} · ${state.record.title}` : 'pick a sleeve off the wall, or press R';
      if (track) el.npDisc.style.setProperty('--label', state.record.colors[0]);
      if (!track) el.npBar.style.width = '0';
      renderTracks();
    },
    progress(p) { el.npBar.style.width = `${(p * 100).toFixed(1)}%`; },
  };
}
