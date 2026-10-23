// ============================================================
//  Codenames Masry — UI + game flow (local hot-seat & P2P online)
// ============================================================

import { PACKS } from './data/words.js';
import * as E from './engine.js';
import { Net } from './net.js';

/* ------------------------------------------------------------------ */
/*  dom helpers                                                        */
/* ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ */
/*  constants + app state                                              */
/* ------------------------------------------------------------------ */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_SETTINGS = {
  packs: ['memes', 'stars', 'food', 'places'],
  timer: 0,
  sound: true,
  showEn: true,
  name: '',
  redName: 'الفريق الأحمر',
  blueName: 'الفريق الأزرق'
};

let adultWarned = false;

const app = {
  screen: 'home',
  mode: 'local',                 // local | online
  settings: { ...DEFAULT_SETTINGS },
  custom: { name: 'كلماتي', words: [] },
  tab: 'log',
  clueCount: 2,
  clockOffset: 0,
  endGuard: false,
  shownOver: false,
  seen: new Set(),
  local: {
    state: null,
    phase: 'spymaster',          // handoff-spymaster | spymaster | handoff-guess | guess | over
    revealed: new Set()
  },
  online: {
    net: null,
    room: null,
    isHost: false,
    me: null,
    players: [],
    state: null,
    view: null,
    joining: false
  },
  lastTap: 0,
  toastTimer: null
};

const bridge = window.masry || null;

/* ------------------------------------------------------------------ */
/*  persistence                                                        */
/* ------------------------------------------------------------------ */
const store = {
  async get(name, fallback) {
    try {
      if (bridge) return await bridge.get(name, fallback);
      const raw = localStorage.getItem('cnm:' + name);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  async set(name, value) {
    try {
      if (bridge) return await bridge.set(name, value);
      localStorage.setItem('cnm:' + name, JSON.stringify(value));
    } catch { /* ignore */ }
  }
};
const saveSettings = () => store.set('settings', app.settings);
const saveCustom = () => store.set('custom', app.custom);

/* ------------------------------------------------------------------ */
/*  word packs                                                         */
/* ------------------------------------------------------------------ */
function customPack() {
  return {
    id: 'custom',
    name: app.custom.name || 'كلماتي',
    nameEn: 'My Words',
    emoji: '✍️',
    desc: 'كلماتك انت',
    words: (app.custom.words || []).map(w => [w.ar, w.en || w.ar])
  };
}

function allPacks() {
  return [...PACKS, customPack()];
}

function normalisePackWords(pack) {
  return (pack.words || [])
    .map(w => Array.isArray(w) ? { ar: w[0], en: w[1] || w[0] } : { ar: w.ar, en: w.en || w.ar })
    .filter(w => w.ar);
}

function buildPool() {
  const ids = new Set(app.settings.packs);
  const words = allPacks()
    .filter(p => ids.has(p.id))
    .flatMap(p => normalisePackWords(p));
  return E.uniqueWords(words);
}

function enabledPackCount(id) {
  return normalisePackWords(allPacks().find(p => p.id === id) || { words: [] }).length;
}

/* ------------------------------------------------------------------ */
/*  ui helpers                                                         */
/* ------------------------------------------------------------------ */
function go(screen) {
  app.screen = screen;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screen));
  if (screen === 'home') renderHome();
  if (screen === 'setup') renderSetup();
  if (screen === 'words') renderWords();
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') renderGame();
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function openOverlay(id) { $('#' + id).hidden = false; }
function closeOverlay(id) { $('#' + id).hidden = true; }

function teamName(team) {
  if (app.mode === 'local') {
    return team === 'red' ? app.settings.redName : app.settings.blueName;
  }
  return team === 'red' ? 'الفريق الأحمر' : 'الفريق الأزرق';
}

function genCode(len = 5) {
  let out = '';
  const rnd = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += ALPHABET[rnd[i] % ALPHABET.length];
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/*  sound (tiny synth, no assets)                                      */
/* ------------------------------------------------------------------ */
let audio = null;
function ac() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }
  return audio;
}

function tone(freq, dur = 0.12, type = 'sine', when = 0, vol = 0.06) {
  const ctx = ac();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function sfx(kind) {
  if (!app.settings.sound) return;
  switch (kind) {
    case 'correct': tone(520, 0.1, 'triangle'); tone(780, 0.14, 'triangle', 0.08); break;
    case 'wrong': tone(180, 0.2, 'sawtooth', 0, 0.05); tone(120, 0.25, 'sawtooth', 0.1, 0.04); break;
    case 'turn': tone(430, 0.1, 'sine'); tone(330, 0.16, 'sine', 0.09); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', i * 0.11, 0.07)); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'sine', i * 0.13, 0.06)); break;
    case 'tap': tone(620, 0.05, 'sine', 0, 0.03); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ */
/*  home                                                               */
/* ------------------------------------------------------------------ */
function renderHome() {
  $('#sound-label').textContent = app.settings.sound ? '🔊 الأصوات شغالة' : '🔇 الأصوات مقفولة';
}

/* ------------------------------------------------------------------ */
/*  setup screen                                                       */
/* ------------------------------------------------------------------ */
function renderPackGrid(targetId = 'pack-grid', hostOnly = false) {
  const el = $('#' + targetId);
  if (!el) return;
  el.innerHTML = '';
  for (const pack of allPacks()) {
    const count = normalisePackWords(pack).length;
    if (pack.id === 'custom' && count === 0 && hostOnly) continue;
    const on = app.settings.packs.includes(pack.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pack' + (on ? ' on' : '') + (pack.id === 'adult' ? ' adult' : '');
    b.dataset.pack = pack.id;
    b.innerHTML = `<span class="p-ico">${pack.emoji || '📦'}</span>
      <span><span class="p-name">${escapeHtml(pack.name)}</span><br><span class="p-count">${count} كلمة</span></span>
      <span class="p-check">✓</span>`;
    b.addEventListener('click', () => {
      const has = app.settings.packs.includes(pack.id);
      if (has && app.settings.packs.length === 1) return toast('لازم تختار باكدج واحد على الأقل');
      if (count === 0) return toast('الباكدج ده فاضي — ضيف كلمات من «كلماتي»');
      if (!has && pack.id === 'adult' && !adultWarned) {
        const ok = confirm('باكدج «١٨+ هزار الكبار» فيه كلام للكبار بس.\nمتأكد إن كل اللي هيلعبوا معاك كبار؟');
        if (!ok) return;
        adultWarned = true;
      }
      app.settings.packs = has
        ? app.settings.packs.filter(id => id !== pack.id)
        : [...app.settings.packs, pack.id];
      saveSettings();
      sfx('tap');
      renderPackGrid(targetId, hostOnly);
      updatePoolCounters();
      if (targetId === 'lobby-pack-grid') broadcastLobbySettings();
    });
    el.appendChild(b);
  }
}

function updatePoolCounters() {
  const n = buildPool().length;
  const c = $('#pool-counter');
  if (c) c.textContent = `${n} كلمة`;
  const c2 = $('#lobby-pool-count');
  if (c2) c2.textContent = `${n} كلمة`;
  const hint = $('#pool-hint');
  if (hint) {
    hint.textContent = n < 25
      ? `ناقص ${25 - n} كلمة — اختار باكدج أكتر أو ضيف كلماتك.`
      : `جاهز! ${n} كلمة في السلة، هنختار منهم ٢٥ عشوائي.`;
    hint.style.color = n < 25 ? '#ff9a8d' : '#8fd6a8';
  }
  const start = $('#start-local');
  if (start) start.disabled = n < 25;
  const lstart = $('#lobby-start');
  if (lstart) updateLobbyStartState(n);
}

function renderSetup() {
  $('#name-red').value = app.settings.redName;
  $('#name-blue').value = app.settings.blueName;
  $$('#timer-seg button').forEach(b => b.classList.toggle('on', Number(b.dataset.timer) === app.settings.timer));
  renderPackGrid('pack-grid');
  updatePoolCounters();
}

/* ------------------------------------------------------------------ */
/*  local game                                                         */
/* ------------------------------------------------------------------ */
function startLocal() {
  const pool = buildPool();
  if (pool.length < 25) return toast('محتاج ٢٥ كلمة على الأقل');

  const red = ($('#name-red').value || '').trim() || 'الفريق الأحمر';
  const blue = ($('#name-blue').value || '').trim() || 'الفريق الأزرق';
  app.settings.redName = red;
  app.settings.blueName = blue;
  saveSettings();

  const firstSel = $('#first-seg .on')?.dataset.first || 'random';
  let first = firstSel;
  if (firstSel === 'random') first = Math.random() < 0.5 ? 'red' : 'blue';

  app.mode = 'local';
  app.local.state = E.createState({
    pool,
    firstTeam: first,
    timerSeconds: app.settings.timer,
    mode: 'local',
    packs: app.settings.packs
  });
  app.local.revealed = new Set();
  app.local.phase = 'handoff-spymaster';
  app.shownOver = false;
  app.seen = new Set();
  app.endGuard = false;

  go('game');
  showHandoff('spymaster');
}

function localView() {
  const st = app.local.state;
  if (!st) return null;
  const showKey = app.local.phase === 'spymaster';
  return E.makeView(st, {
    showKey,
    role: showKey ? 'spymaster' : 'guesser',
    players: []
  });
}

function showHandoff(kind) {
  const st = app.local.state;
  const isSpy = kind === 'spymaster';
  app.local.phase = isSpy ? 'handoff-spymaster' : 'handoff-guess';

  const box = $('.handoff');
  box.classList.toggle('red', st.turn === 'red');
  box.classList.toggle('blue', st.turn === 'blue');
  $('#handoff-team').textContent = teamName(st.turn);
  $('#handoff-role').textContent = isSpy ? 'الماستر' : 'الفريق اللي هيخمن';
  $('#handoff-text').innerHTML = isSpy
    ? 'خد الجهاز <b>لوحدك</b> ومتخليش حد يشوف الشاشة.<br>هتشوف ألوان الكروت، وتقول تلميح بكلمة واحدة ورقم.'
    : 'سلّم الجهاز للفريق التاني.<br>متخليش الماستر يوري حد الألوان!';
  $('#handoff-ok').textContent = isSpy ? 'تمام، وري الألوان 👁️' : 'يلا نخمن 🔍';
  openOverlay('overlay-handoff');
  renderGame();
}

function submitClue(word, count) {
  const st = app.local.state;
  if (!st) return;
  const clean = String(word || '').trim();
  if (!clean) return toast('اكتب كلمة التلميح');
  if (st.board.some(c => E.normalise(c.ar) === E.normalise(clean) || E.normalise(c.en) === E.normalise(clean))) {
    return toast('الكلمة دي موجودة على الطاولة! اختار تلميح تاني.');
  }
  const res = E.setClue(st, clean, count);
  if (!res.ok) return toast(res.error);
  app.clueCount = count;
  closeOverlay('overlay-handoff');
  sfx('turn');
  showHandoff('guess');
}

function localReveal(index) {
  const st = app.local.state;
  if (!st || app.local.phase !== 'guess') return;
  const before = st.phase;
  const res = E.reveal(st, index);
  if (!res.ok) return toast(res.error);

  if (res.type === 'correct' || res.type === 'exhausted') sfx('correct');
  else if (res.type === 'wrong') sfx('wrong');
  else if (res.type === 'assassin') sfx('lose');
  else if (res.type === 'win') sfx('win');

  renderGame();

  if (st.phase === 'over') {
    app.local.phase = 'over';
    setTimeout(() => showGameOver(localView()), 620);
    return;
  }
  if (res.type !== 'correct') {
    setTimeout(() => {
      if (st.phase === 'over') return;
      if (app.local.phase === 'guess') showHandoff('spymaster');
    }, 700);
  }
}

function endTurnLocal() {
  const st = app.local.state;
  if (!st || st.phase !== 'guess') return;
  E.endTurn(st);
  sfx('turn');
  showHandoff('spymaster');
}

/* ------------------------------------------------------------------ */
/*  online                                                             */
/* ------------------------------------------------------------------ */
function playerName() {
  const input = $('#player-name');
  const name = (input?.value || app.settings.name || '').trim();
  return name || 'لاعب';
}

function createRoom() {
  if (app.online.joining) return;
  const name = playerName();
  app.settings.name = name;
  saveSettings();
  app.online.joining = true;
  const btn = $('#create-room');
  btn.disabled = true;
  btn.textContent = 'بنفتح الغرفة…';

  const attempt = (tries) => {
    const code = genCode();
    const net = new Net({
      onData: hostOnData,
      onPeerClose: hostOnPeerClose,
      onError: hostOnError
    });
    net.host(code).then(() => {
      const hostPlayer = { id: 'host', name, team: 'red', role: 'spymaster', isHost: true, connected: true };
      app.mode = 'online';
      app.online = {
        net, room: code, isHost: true, me: hostPlayer,
        players: [hostPlayer], state: null, view: null, joining: false
      };
      broadcastLobby();
      sfx('tap');
      go('lobby');
    }).catch((err) => {
      try { net.close(); } catch { /* ignore */ }
      if (err?.type === 'unavailable-id' && tries > 0) return attempt(tries - 1);
      app.online.joining = false;
      btn.disabled = false;
      btn.textContent = 'إنشاء غرفة 🌐';
      toast(peerErrorText(err));
    });
  };
  attempt(3);
}

function joinRoom() {
  if (app.online.joining) return;
  const code = ($('#join-code').value || '').trim().toUpperCase();
  if (code.length < 4) return toast('اكتب كود الغرفة (٥ حروف)');
  const name = playerName();
  app.settings.name = name;
  saveSettings();

  app.online.joining = true;
  const btn = $('#join-room');
  btn.disabled = true;
  btn.textContent = 'بنحاول ندخل…';

  const net = new Net({
    onData: guestOnData,
    onGuestClose: () => {
      toast('الهوست قفل الغرفة أو الاتصال اتقطع');
      leaveOnline();
      go('home');
    },
    onError: (err) => toast(peerErrorText(err)),
    onOpen: () => net.sendHost({ t: 'hello', name })
  });

  net.join(code).then(() => {
    app.mode = 'online';
    app.online = { net, room: code, isHost: false, me: null, players: [], state: null, view: null, joining: false };
    $('#lobby-sub').textContent = 'مستنيين الهوست يبدأ…';
  }).catch((err) => {
    try { net.close(); } catch { /* ignore */ }
    app.online.joining = false;
    btn.disabled = false;
    btn.textContent = 'دخول 🎟️';
    toast(peerErrorText(err));
  });
}

function peerErrorText(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'مفيش غرفة بالكود ده — اتأكد من الكود.';
  if (t === 'unavailable-id') return 'الكود محجوز، بنجرب كود تاني…';
  if (t === 'network' || t === 'server-error') return 'مشكلة في الاتصال بسيرفر التوصيل. جرب تاني.';
  if (t === 'timeout') return 'الاتصال أخد وقت طويل. جرب تاني.';
  if (t === 'browser-incompatible') return 'الجهاز مش بيدعم WebRTC.';
  return err?.message || 'حصلت مشكلة في الاتصال.';
}

/* ---------- host side ---------- */
function hostOnData(msg, peerId) {
  if (!msg || typeof msg !== 'object') return;
  const st = app.online.state;

  switch (msg.t) {
    case 'hello': {
      const exists = app.online.players.find(p => p.id === peerId);
      if (exists) { exists.connected = true; break; }
      const p = { id: peerId, name: String(msg.name || 'لاعب').slice(0, 18), team: null, role: 'spectator', isHost: false, connected: true };
      autoPlace(p);
      app.online.players.push(p);
      app.online.net.send(peerId, { t: 'welcome', you: p, players: app.online.players, room: app.online.room });
      if (st) app.online.net.send(peerId, { t: 'state', view: makeViewFor(p), players: app.online.players });
      broadcastLobby();
      break;
    }
    case 'role': {
      const p = app.online.players.find(x => x.id === peerId);
      if (!p || st) break;
      applyRole(p, msg.team, msg.role);
      break;
    }
    case 'clue': {
      const p = playerById(peerId);
      if (!canAct(p, 'clue')) return;
      const word = String(msg.word || '').trim().slice(0, 30);
      if (!word) return;
      if (st.board.some(c => E.normalise(c.ar) === E.normalise(word) || E.normalise(c.en) === E.normalise(word))) {
        app.online.net.send(peerId, { t: 'toast', message: 'الكلمة دي موجودة على الطاولة!' });
        return;
      }
      E.setClue(st, word, msg.count);
      app.online.net.send(peerId, { t: 'toast', message: 'التلميح اتقال 📣' });
      broadcastState();
      break;
    }
    case 'reveal': {
      const p = playerById(peerId);
      if (!canAct(p, 'reveal')) return;
      E.reveal(st, Number(msg.i));
      broadcastState();
      break;
    }
    case 'endTurn': {
      const p = playerById(peerId);
      if (!canAct(p, 'endTurn')) return;
      E.endTurn(st);
      broadcastState();
      break;
    }
    case 'chat': {
      const p = playerById(peerId);
      if (!p) return;
      pushChat(p, msg.text);
      break;
    }
    case 'again': {
      if (!app.online.isHost) break;
      break;
    }
    default: break;
  }
}

function hostOnPeerClose(peerId) {
  const p = playerById(peerId);
  if (!p) return;
  p.connected = false;
  broadcastLobby();
  if (app.online.state) broadcastState();
}

function hostOnError(err) {
  if (err?.type === 'peer-unavailable') return;
  toast(peerErrorText(err));
}

function playerById(id) {
  return app.online.players.find(p => p.id === id);
}

function autoPlace(p) {
  const reds = app.online.players.filter(x => x.team === 'red').length;
  const blues = app.online.players.filter(x => x.team === 'blue').length;
  p.team = reds <= blues ? 'red' : 'blue';
  const teamHasSpy = app.online.players.some(x => x.team === p.team && x.role === 'spymaster');
  p.role = teamHasSpy ? 'guesser' : 'spymaster';
}

function applyRole(p, team, role) {
  const teams = ['red', 'blue', null];
  const roles = ['spymaster', 'guesser', 'spectator'];
  if (!teams.includes(team) || !roles.includes(role)) return;
  if (team === null || role === 'spectator') {
    p.team = null; p.role = 'spectator';
  } else {
    if (role === 'spymaster') {
      // only one spymaster per team
      for (const other of app.online.players) {
        if (other !== p && other.team === team && other.role === 'spymaster') {
          other.role = 'guesser';
        }
      }
    }
    p.team = team;
    p.role = role;
  }
  broadcastLobby();
}

function makeViewFor(p) {
  const st = app.online.state;
  const showKey = p.role === 'spymaster' && !!p.team;
  return E.makeView(st, {
    showKey,
    role: p.role,
    you: p,
    room: app.online.room,
    players: app.online.players.map(x => ({ id: x.id, name: x.name, team: x.team, role: x.role, connected: x.connected, isHost: x.isHost }))
  });
}

function broadcastLobby() {
  if (!app.online.isHost) return;
  app.online.net.broadcast({
    t: 'lobby',
    players: app.online.players,
    room: app.online.room,
    hostId: 'host'
  });
  if (app.screen === 'lobby') renderLobby();
}

function broadcastLobbySettings() {
  if (!app.online.isHost) return;
  // settings only matter at start; clients get a hint in the lobby
}

function broadcastState() {
  if (!app.online.isHost) return;
  const st = app.online.state;
  if (!st) return;
  app.online.view = makeViewFor(app.online.me);
  app.clockOffset = 0;
  for (const p of app.online.players) {
    if (p.id === 'host' || !p.connected) continue;
    app.online.net.send(p.id, { t: 'state', view: makeViewFor(p), players: app.online.players });
  }
  if (st.phase === 'over') {
    if (!app.shownOver) {
      app.shownOver = true;
      setTimeout(() => showGameOver(app.online.view), 650);
    }
  }
  if (app.screen === 'game') renderGame();
}

function checkReady() {
  const players = app.online.players.filter(p => p.team);
  if (players.length < 2) return { ok: false, reason: 'محتاج لاعبين على الأقل، واحد في كل فريق' };
  for (const team of ['red', 'blue']) {
    const list = players.filter(p => p.team === team);
    if (!list.length) return { ok: false, reason: `مفيش حد في ${teamName(team)}` };
    if (!list.some(p => p.role === 'spymaster')) return { ok: false, reason: `اختار ماستر لـ${teamName(team)}` };
  }
  return { ok: true };
}

function hostStart() {
  if (!app.online.isHost) return;
  const pool = buildPool();
  if (pool.length < 25) return toast('محتاج ٢٥ كلمة على الأقل');
  const ready = checkReady();
  if (!ready.ok) return toast(ready.reason);

  app.online.state = E.createState({
    pool,
    firstTeam: Math.random() < 0.5 ? 'red' : 'blue',
    timerSeconds: app.settings.timer,
    mode: 'online',
    packs: app.settings.packs
  });
  app.shownOver = false;
  app.endGuard = false;
  app.seen = new Set();
  broadcastState();
  go('game');
}

/* ---------- guest side ---------- */
function guestOnData(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome': {
      app.online.me = msg.you;
      app.online.players = msg.players || [msg.you];
      app.online.room = msg.room || app.online.room;
      go('lobby');
      break;
    }
    case 'lobby': {
      app.online.players = msg.players || [];
      if (msg.hostId) app.online.hostId = msg.hostId;
      const me = app.online.players.find(p => p.id === app.online.me?.id);
      if (me) app.online.me = me;
      if (app.screen === 'lobby') renderLobby();
      break;
    }
    case 'state': {
      app.online.view = msg.view;
      app.online.players = msg.players || app.online.players;
      if (app.online.me?.id) {
        const fresh = app.online.players.find(p => p.id === app.online.me.id);
        if (fresh) app.online.me = fresh;
      }
      app.clockOffset = (msg.view.now || Date.now()) - Date.now();
      if (msg.view.version === 1) app.seen = new Set();
      if (app.screen !== 'game') {
        closeOverlay('overlay-handoff');
        go('game');
      } else {
        renderGame();
      }
      if (msg.view.phase === 'over' && !app.shownOver) {
        app.shownOver = true;
        setTimeout(() => showGameOver(msg.view), 650);
      }
      break;
    }
    case 'toast':
      toast(msg.message);
      break;
    default: break;
  }
}

function guestAction(msg) {
  // the host is also a player: apply its own actions locally, guests send them up
  if (app.online.isHost) return hostOnData(msg, 'host');
  app.online.net?.sendHost(msg);
}

/* ---------- shared online helpers ---------- */
function canAct(p, kind) {
  const st = app.online.state;
  if (!st || !p || !p.team) return false;
  if (p.team !== st.turn) return false;
  if (kind === 'clue') return st.phase === 'clue' && p.role === 'spymaster';
  return st.phase === 'guess' && (p.role === 'guesser' || p.role === 'spymaster');
}

function pushChat(p, text) {
  const st = app.online.state;
  const clean = String(text || '').trim().slice(0, 140);
  if (!clean) return;
  const entry = { name: p.name, team: p.team, text: clean, ts: Date.now(), id: p.id };
  const target = st || app.online;
  if (!target.chat) target.chat = [];
  target.chat.push(entry);
  if (target.chat.length > 80) target.chat.shift();
  if (app.online.isHost) {
    broadcastState();
    if (app.screen === 'game') renderTabs();
  }
}

/* ------------------------------------------------------------------ */
/*  lobby rendering                                                    */
/* ------------------------------------------------------------------ */
function renderLobby() {
  $('#room-code').textContent = app.online.room || '-----';
  $('#lobby-sub').textContent = app.online.isHost
    ? 'ابعت الكود لأصحابك — انت الهوست، سيب البرنامج مفتوح'
    : 'انت في غرفة ' + (app.online.room || '');

  const hostOnly = app.online.isHost;
  $('#auto-assign').hidden = !hostOnly;
  $('#lobby-start').hidden = !hostOnly;
  $('#lobby-wait').hidden = hostOnly;
  $('#lobby-settings').hidden = false;

  // pack grid in lobby
  const pg = $('#lobby-pack-grid');
  pg.innerHTML = '';
  for (const pack of allPacks()) {
    const count = normalisePackWords(pack).length;
    if (count === 0) continue;
    const on = app.settings.packs.includes(pack.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pack' + (on ? ' on' : '');
    b.innerHTML = `<span class="p-ico">${pack.emoji || '📦'}</span>
      <span><span class="p-name">${escapeHtml(pack.name)}</span><br><span class="p-count">${count}</span></span>
      <span class="p-check">✓</span>`;
    b.disabled = !hostOnly;
    b.addEventListener('click', () => {
      const has = app.settings.packs.includes(pack.id);
      if (has && app.settings.packs.length === 1) return toast('لازم باكدج واحد على الأقل');
      app.settings.packs = has ? app.settings.packs.filter(id => id !== pack.id) : [...app.settings.packs, pack.id];
      saveSettings();
      renderLobby();
      updatePoolCounters();
    });
    pg.appendChild(b);
  }
  $$('#lobby-timer-seg button').forEach(b => b.classList.toggle('on', Number(b.dataset.timer) === app.settings.timer));

  const list = $('#players-list');
  list.innerHTML = '';
  const players = app.online.players;
  $('#player-count').textContent = `(${players.length})`;

  for (const p of players) {
    const row = document.createElement('div');
    row.className = 'player' + (p.team ? ' ' + p.team : '') + (p.id === app.online.me?.id ? ' self' : '') + (p.connected === false ? ' off' : '');
    const initial = (p.name || '?').trim().charAt(0);
    const roleText = p.role === 'spymaster' ? 'ماستر' : p.role === 'guesser' ? 'خمّن' : 'متفرج';
    const teamText = p.team === 'red' ? 'أحمر' : p.team === 'blue' ? 'أزرق' : '—';

    row.innerHTML = `<div class="pav">${escapeHtml(initial)}</div>
      <div><div class="pname">${escapeHtml(p.name)}${p.isHost ? ' <span class="badge">هوست</span>' : ''}${p.connected === false ? ' <span class="badge">خرج</span>' : ''}</div>
      <div class="ptag">${teamText} · ${roleText}</div></div>`;

    const sel = document.createElement('select');
    const opts = [
      ['red:spymaster', 'أحمر — ماستر'],
      ['red:guesser', 'أحمر — خمّن'],
      ['blue:spymaster', 'أزرق — ماستر'],
      ['blue:guesser', 'أزرق — خمّن'],
      ['spectator', 'متفرج 👀']
    ];
    for (const [val, label] of opts) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = p.team ? `${p.team}:${p.role}` : 'spectator';
    const canChange = app.online.isHost || p.id === app.online.me?.id;
    sel.disabled = !canChange;
    sel.addEventListener('change', () => {
      const [team, role] = sel.value.split(':');
      if (app.online.isHost) {
        applyRole(p, role === 'spectator' ? null : team, role);
      } else {
        guestAction({ t: 'role', team: role === 'spectator' ? null : team, role });
      }
    });
    row.appendChild(sel);
    list.appendChild(row);
  }

  updatePoolCounters();
  const ready = checkReady();
  $('#lobby-hint').textContent = ready.ok
    ? 'جاهزين! اول واحد يبدأ هيبقى عشوائي.'
    : ready.reason;
  $('#lobby-hint').style.color = ready.ok ? '#8fd6a8' : '#ffb08a';
}

function updateLobbyStartState(poolCount) {
  const btn = $('#lobby-start');
  if (!btn) return;
  const ready = checkReady();
  btn.disabled = !ready.ok || poolCount < 25;
}

function autoAssignAll() {
  const players = app.online.players;
  players.forEach((p, i) => { p.team = null; p.role = 'spectator'; });
  const order = [...players].sort((a, b) => (a.id === 'host' ? -1 : b.id === 'host' ? 1 : 0));
  order.forEach((p, i) => {
    p.team = i % 2 === 0 ? 'red' : 'blue';
    p.role = 'guesser';
  });
  const red = players.find(p => p.team === 'red');
  const blue = players.find(p => p.team === 'blue');
  if (red) red.role = 'spymaster';
  if (blue) blue.role = 'spymaster';
  broadcastLobby();
  if (app.screen === 'lobby') renderLobby();
  toast('اتوزعوا! عدّل لو مش عاجبك 😄');
}

/* ------------------------------------------------------------------ */
/*  game rendering                                                     */
/* ------------------------------------------------------------------ */
function currentView() {
  if (app.mode === 'local') return localView();
  return app.online.view;
}

function renderGame() {
  const v = currentView();
  if (!v) return;
  app.clockOffset = app.mode === 'local' ? 0 : (v.now || Date.now()) - Date.now();

  const pill = $('#turn-pill');
  pill.className = 'turn-pill ' + v.turn;
  pill.querySelector('span').textContent = `دور ${teamName(v.turn)}`;

  const sr = $('#score-red');
  const sb = $('#score-blue');
  sr.querySelector('.score-name').textContent = teamName('red');
  sb.querySelector('.score-name').textContent = teamName('blue');
  sr.querySelector('.score-num').textContent = v.scores.red;
  sb.querySelector('.score-num').textContent = v.scores.blue;
  sr.classList.toggle('active', v.turn === 'red' && v.phase !== 'over');
  sb.classList.toggle('active', v.turn === 'blue' && v.phase !== 'over');

  const chip = $('#room-chip');
  if (app.mode === 'online' && app.online.room) {
    chip.hidden = false;
    chip.textContent = 'غرفة ' + app.online.room;
  } else {
    chip.hidden = true;
  }

  const badge = $('#me-badge');
  if (app.mode === 'online' && app.online.me) {
    badge.hidden = false;
    const r = app.online.me.role === 'spymaster' ? 'ماستر' : app.online.me.role === 'guesser' ? 'خمّن' : 'متفرج';
    const t = app.online.me.team === 'red' ? 'أحمر' : app.online.me.team === 'blue' ? 'أزرق' : '—';
    badge.innerHTML = `انت: <b>${escapeHtml(app.online.me.name)}</b> · ${t} · ${r}`;
  } else {
    badge.hidden = true;
  }

  renderBoard(v);
  renderClue(v);
  renderControls(v);
  renderTabs();
  renderBoardFoot(v);
  updateTimerDisplay();
}

function renderBoard(v) {
  const board = $('#board');
  board.innerHTML = '';
  const revealable = isMyTurnToGuess(v) && v.phase === 'guess';

  v.board.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.dataset.i = String(i);
    if (c.ar.length >= 14) btn.classList.add('len-xl');
    else if (c.ar.length >= 10) btn.classList.add('len-l');
    if (!app.settings.showEn) btn.classList.add('hide-en');

    if (c.revealed) {
      btn.classList.add('rev', c.color);
      if (!app.seen.has(c.id)) btn.classList.add('just');
    } else if (c.color) {
      btn.classList.add('key', 'key-' + c.color);
    }

    if (!revealable || c.revealed) btn.classList.add('locked');

    const word = document.createElement('span');
    word.className = 'card-word';
    word.textContent = c.ar;
    const en = document.createElement('span');
    en.className = 'card-en';
    en.textContent = c.en || '';
    btn.append(word, en);

    btn.addEventListener('click', () => onCardClick(i));
    board.appendChild(btn);
  });

  app.local.revealed = new Set(v.board.filter(c => c.revealed).map(c => c.id));
  v.board.filter(c => c.revealed).forEach(c => app.seen.add(c.id));
}

function renderClue(v) {
  const box = $('#clue-box');
  if (!v.clue) {
    box.innerHTML = '<div class="clue-empty">مستنيين التلميح…</div>';
    return;
  }
  const left = v.phase === 'guess' ? Math.max(0, v.guessesLeft) : 0;
  box.innerHTML = '';
  const w = document.createElement('div');
  w.className = 'clue-word';
  w.textContent = v.clue.word;
  const n = document.createElement('small');
  n.textContent = String(v.clue.count);
  w.appendChild(n);
  const meta = document.createElement('div');
  meta.className = 'clue-meta';
  meta.textContent = `تلميح ${teamName(v.clue.team)}`;
  const leftBox = document.createElement('div');
  leftBox.className = 'clue-left';
  leftBox.innerHTML = `<span>تخمينات متبقية</span><span class="pips">${Array.from({ length: Math.max(left, 0) }, () => '<i class="pip on"></i>').join('')}</span>`;
  box.append(w, meta);
  if (v.phase === 'guess') box.appendChild(leftBox);
}

function isMyTurnToGuess(v) {
  if (v.phase !== 'guess') return false;
  if (app.mode === 'local') return app.local.phase === 'guess';
  const me = v.you;
  if (!me || !me.team) return false;
  return me.team === v.turn && (me.role === 'guesser' || me.role === 'spymaster');
}

function canGiveClue(v) {
  if (v.phase !== 'clue') return false;
  if (app.mode === 'local') return app.local.phase === 'spymaster';
  const me = v.you;
  return !!me && me.team === v.turn && me.role === 'spymaster';
}

function renderControls(v) {
  const c = $('#controls');
  c.innerHTML = '';
  if (v.phase === 'over') return;

  if (app.mode === 'local' && (app.local.phase === 'handoff-spymaster' || app.local.phase === 'handoff-guess')) {
    c.innerHTML = '<div class="ctrl-note">سلّم الجهاز وبعدين دوس «تمام» 👀</div>';
    return;
  }

  if (canGiveClue(v)) {
    const wrap = document.createElement('div');
    wrap.className = 'clue-form';
    wrap.innerHTML = `<div class="ctrl-title">انت الماستر — قول تلميح بكلمة واحدة + رقم</div>
      <div class="clue-row">
        <input id="clue-word" maxlength="30" placeholder="مثلاً: أكل" autocomplete="off" />
        <div class="num-stepper">
          <button type="button" data-step="-1">−</button>
          <span id="clue-num">${app.clueCount}</span>
          <button type="button" data-step="1">+</button>
        </div>
      </div>
      <button class="btn primary" id="clue-send">قول التلميح 📣</button>
      <p class="hint tiny" style="text-align:center;margin:2px 0 0">ممنوع تقول كلمة موجودة على الكروت.</p>`;
    c.appendChild(wrap);

    const input = $('#clue-word', wrap);
    const num = $('#clue-num', wrap);
    wrap.querySelectorAll('[data-step]').forEach(b => {
      b.addEventListener('click', () => {
        app.clueCount = Math.max(0, Math.min(9, app.clueCount + Number(b.dataset.step)));
        num.textContent = app.clueCount;
        sfx('tap');
      });
    });
    const send = () => {
      const word = input.value.trim();
      if (!word) return toast('اكتب كلمة التلميح');
      if (app.mode === 'local') submitClue(word, app.clueCount);
      else { guestAction({ t: 'clue', word, count: app.clueCount }); input.value = ''; }
    };
    $('#clue-send', wrap).addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    setTimeout(() => input.focus(), 80);
    return;
  }

  if (isMyTurnToGuess(v)) {
    const note = document.createElement('div');
    note.className = 'ctrl-note';
    note.innerHTML = `دور <b>${teamName(v.turn)}</b> — دوس على الكارت اللي انت متأكد منه.`;
    const end = document.createElement('button');
    end.className = 'btn';
    end.textContent = 'خلاص، الدور علينا التاني ⏭️';
    end.addEventListener('click', () => {
      if (app.mode === 'local') endTurnLocal();
      else guestAction({ t: 'endTurn' });
    });
    c.append(note, end);
    return;
  }

  // waiting states
  let text = '';
  if (v.phase === 'clue') {
    text = `مستنيين الماستر بتاع <b>${teamName(v.turn)}</b> يقول التلميح…`;
  } else if (v.phase === 'guess') {
    text = `دور <b>${teamName(v.turn)}</b> بيخمنوا…`;
    if (app.mode === 'online' && v.you?.role === 'spymaster' && v.you?.team === v.turn) {
      text = 'فريقك بيخمن — متساعدهمش! 🤐';
    }
    if (app.mode === 'online' && !v.you?.team) {
      text = 'انت متفرج 👀 — استمتع بالخناقة.';
    }
  }
  const note = document.createElement('div');
  note.className = 'ctrl-note';
  note.innerHTML = text;
  c.appendChild(note);
}

function renderBoardFoot(v) {
  const foot = $('#board-foot');
  if (v.phase === 'over') { foot.textContent = 'خلصت اللعبة 🎬'; return; }
  if (app.mode === 'local') {
    if (app.local.phase === 'spymaster') foot.textContent = 'الألوان ظاهرة ليك بس — متوصفهاش بشكل مباشر 😉';
    else if (app.local.phase === 'guess') foot.textContent = 'دوس على الكارت اللي شاكك فيه.';
    else foot.textContent = '';
    return;
  }
  if (!v.you?.team) foot.textContent = 'انت متفرج — متقدرش تكشف كروت.';
  else if (v.you.team !== v.turn) foot.textContent = 'دور الفريق التاني…';
  else if (v.phase === 'clue') foot.textContent = 'الماستر بيجهز التلميح.';
  else foot.textContent = 'دوس على الكارت اللي شاكك فيه.';
}

function renderTabs() {
  const isOnline = app.mode === 'online';
  const chatTab = $('#chat-tab');
  chatTab.hidden = !isOnline;
  if (!isOnline && app.tab === 'chat') app.tab = 'log';

  $$('.panel-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === app.tab));
  $('#chat-input').hidden = !(isOnline && app.tab === 'chat');

  const body = $('#tab-body');
  body.innerHTML = '';
  if (app.tab === 'chat') {
    const v = currentView();
    const chat = (app.online.state?.chat) || v?.chat || [];
    if (!chat.length) {
      body.innerHTML = '<div class="log-row">مفيش رسايل لسه — ابدأ الكلام 😄</div>';
      return;
    }
    for (const m of chat) {
      const row = document.createElement('div');
      row.className = 'chat-row' + (m.id === app.online.me?.id ? ' mine' : '');
      row.innerHTML = `<b>${escapeHtml(m.name)}:</b> <span>${escapeHtml(m.text)}</span>`;
      body.appendChild(row);
    }
    body.scrollTop = body.scrollHeight;
    return;
  }

  const v = currentView();
  const log = v?.log || [];
  for (const entry of log) {
    const row = document.createElement('div');
    row.className = 'log-row ' + (entry.kind || '');
    row.textContent = entry.text;
    body.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/*  card click                                                         */
/* ------------------------------------------------------------------ */
function onCardClick(i) {
  const now = Date.now();
  if (now - app.lastTap < 220) return;
  app.lastTap = now;

  if (app.mode === 'local') {
    if (app.local.phase !== 'guess') return;
    localReveal(i);
    return;
  }

  const v = app.online.view;
  if (!v || !isMyTurnToGuess(v)) return;
  if (v.board[i]?.revealed) return;
  guestAction({ t: 'reveal', i });
}

/* ------------------------------------------------------------------ */
/*  game over                                                          */
/* ------------------------------------------------------------------ */
function showGameOver(v) {
  if (!v || v.phase !== 'over') return;
  const win = v.winner;
  const loser = win === 'red' ? 'blue' : 'red';
  const assassin = /القاتل/.test(v.winReason || '');
  $('#go-glyph').textContent = assassin ? '💀' : '🏆';
  $('#go-title').textContent = assassin
    ? `${teamName(loser)} فتحوا القاتل!`
    : `${teamName(win)} كسبوا!`;
  $('#go-title').style.color = win === 'red' ? 'var(--red-2)' : 'var(--blue-2)';
  $('#go-title').style.color = assassin ? '#ff9a8d' : (win === 'red' ? '#ff8072' : '#7cc0ff');
  $('#go-reason').textContent = v.winReason || '';

  const again = $('#go-again');
  const onlineGuest = app.mode === 'online' && !app.online.isHost;
  again.hidden = onlineGuest;
  again.textContent = app.mode === 'online' ? 'لعبة جديدة (نفس الفرق) 🔄' : 'لعبة جديدة 🔄';

  closeOverlay('overlay-handoff');
  openOverlay('overlay-gameover');
  sfx(assassin ? 'lose' : 'win');
}

/* ------------------------------------------------------------------ */
/*  exit / leave                                                       */
/* ------------------------------------------------------------------ */
function leaveOnline() {
  try { app.online.net?.close(); } catch { /* ignore */ }
  app.online = { net: null, room: null, isHost: false, me: null, players: [], state: null, view: null, joining: false };
  $('#create-room').disabled = false;
  $('#create-room').textContent = 'إنشاء غرفة 🌐';
  $('#join-room').disabled = false;
  $('#join-room').textContent = 'دخول 🎟️';
}

function exitGame() {
  if (app.mode === 'online' && app.online.isHost) {
    if (!confirm('انت الهوست — لو خرجت الغرفة هتقفل. متأكد؟')) return;
  }
  closeOverlay('overlay-gameover');
  closeOverlay('overlay-handoff');
  if (app.mode === 'online') leaveOnline();
  app.local.state = null;
  go('home');
}

/* ------------------------------------------------------------------ */
/*  custom words                                                       */
/* ------------------------------------------------------------------ */
function parseWordLines(text) {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const idx = line.indexOf('=');
      const ar = idx >= 0 ? line.slice(0, idx).trim() : line;
      const en = idx >= 0 ? line.slice(idx + 1).trim() : '';
      return { ar, en: en || ar };
    })
    .filter(w => w.ar);
}

function wordsToText(words) {
  return (words || []).map(w => (w.en && w.en !== w.ar ? `${w.ar} = ${w.en}` : w.ar)).join('\n');
}

function renderWords() {
  $('#custom-name').value = app.custom.name || 'كلماتي';
  $('#custom-words').value = wordsToText(app.custom.words);
  updateWordsCount();
}

function updateWordsCount() {
  const words = parseWordLines($('#custom-words').value);
  const n = words.length;
  $('#words-count').textContent = `${n} كلمة — محتاج ٢٥ على الأقل عشان تلعب بالباكدج لوحده.`;
  $('#words-count').style.color = n >= 25 ? '#8fd6a8' : '#ffb08a';
}

function saveCustomWords(silent = false) {
  app.custom.name = ($('#custom-name').value || '').trim() || 'كلماتي';
  app.custom.words = parseWordLines($('#custom-words').value);
  saveCustom();
  if (!silent) toast(`اتحفظوا ${app.custom.words.length} كلمة ✅`);
  updateWordsCount();
}

async function exportWords() {
  saveCustomWords(true);
  const payload = { app: 'codenames-masry', version: 1, name: app.custom.name, words: app.custom.words };
  if (bridge) {
    const res = await bridge.exportPacks(payload);
    if (res?.ok) toast('اتصدّر الملف ✅');
    else if (res && res.ok === false && res.error) toast('مشكلة: ' + res.error);
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'codenames-masry-words.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importWords() {
  let data = null;
  if (bridge) {
    const res = await bridge.importPacks();
    if (!res?.ok) return;
    data = res.data;
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    const file = await new Promise(resolve => {
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
    if (!file) return;
    try { data = JSON.parse(await file.text()); } catch { return toast('الملف مش JSON صحيح'); }
  }
  if (!data) return;
  const words = Array.isArray(data.words)
    ? data.words
    : Array.isArray(data.packs)
      ? data.packs.flatMap(p => p.words || [])
      : Array.isArray(data)
        ? data
        : [];
  const cleaned = words.map(w => Array.isArray(w) ? { ar: w[0], en: w[1] || w[0] } : { ar: w.ar || w.word, en: w.en || w.ar || w.word })
    .filter(w => w.ar);
  if (!cleaned.length) return toast('مفيش كلمات في الملف');
  if (data.name) app.custom.name = String(data.name).slice(0, 24);

  // merge, no duplicates
  const existing = new Set(app.custom.words.map(w => E.normalise(w.ar)));
  const merged = [...app.custom.words];
  let added = 0;
  for (const w of cleaned) {
    const key = E.normalise(w.ar);
    if (!key || existing.has(key)) continue;
    existing.add(key);
    merged.push(w);
    added++;
  }
  app.custom.words = merged;
  saveCustom();
  renderWords();
  toast(`اتضاف ${added} كلمة ✅`);
}

/* ------------------------------------------------------------------ */
/*  timer loop                                                         */
/* ------------------------------------------------------------------ */
function updateTimerDisplay() {
  const v = currentView();
  const el = $('#timer');
  if (!v || v.phase === 'over' || !v.turnEndsAt) {
    el.textContent = '—';
    el.className = 'timer';
    return;
  }
  const now = Date.now() + app.clockOffset;
  const left = Math.max(0, Math.ceil((v.turnEndsAt - now) / 1000));
  const m = Math.floor(left / 60);
  const s = left % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.className = 'timer' + (left <= 10 ? ' crit' : left <= 30 ? ' warn' : '');
}

function tick() {
  updateTimerDisplay();
  const v = currentView();
  if (!v || v.phase === 'over' || !v.turnEndsAt) return;

  const now = Date.now() + app.clockOffset;
  if (now < v.turnEndsAt) return;

  if (app.mode === 'local') {
    if (app.local.phase !== 'guess' || app.endGuard) return;
    app.endGuard = true;
    E.endTurn(app.local.state);
    sfx('turn');
    toast('الوقت خلص ⏰');
    showHandoff('spymaster');
    setTimeout(() => { app.endGuard = false; }, 1200);
  } else if (app.online.isHost && app.online.state && !app.endGuard) {
    app.endGuard = true;
    E.endTurn(app.online.state);
    sfx('turn');
    broadcastState();
    setTimeout(() => { app.endGuard = false; }, 1500);
  }
}

/* ------------------------------------------------------------------ */
/*  event wiring                                                       */
/* ------------------------------------------------------------------ */
function bind() {
  $('#go-local').addEventListener('click', () => { sfx('tap'); go('setup'); });
  $('#go-online').addEventListener('click', () => { sfx('tap'); go('online'); });
  $('#go-join').addEventListener('click', () => {
    sfx('tap');
    go('online');
    setTimeout(() => $('#join-code').focus(), 120);
  });
  $('#go-words').addEventListener('click', () => go('words'));
  $('#go-rules').addEventListener('click', () => openOverlay('overlay-rules'));
  $('#go-sound').addEventListener('click', () => {
    app.settings.sound = !app.settings.sound;
    saveSettings();
    renderHome();
    if (app.settings.sound) sfx('tap');
  });

  $$('[data-back]').forEach(b => b.addEventListener('click', () => go(b.dataset.back)));

  // setup
  $$('#timer-seg button').forEach(b => b.addEventListener('click', () => {
    app.settings.timer = Number(b.dataset.timer);
    saveSettings();
    $$('#timer-seg button').forEach(x => x.classList.toggle('on', x === b));
  }));
  $$('#first-seg button').forEach(b => b.addEventListener('click', () => {
    $$('#first-seg button').forEach(x => x.classList.toggle('on', x === b));
  }));
  $('#name-red').addEventListener('input', e => { app.settings.redName = e.target.value; saveSettings(); });
  $('#name-blue').addEventListener('input', e => { app.settings.blueName = e.target.value; saveSettings(); });
  $('#start-local').addEventListener('click', startLocal);

  // online entry
  $('#create-room').addEventListener('click', createRoom);
  $('#join-room').addEventListener('click', joinRoom);
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  $('#player-name').addEventListener('input', e => {
    app.settings.name = e.target.value;
    saveSettings();
  });
  $('#player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { createRoom(); }
  });

  // lobby
  $('#copy-code').addEventListener('click', async () => {
    const text = app.online.room || '';
    if (bridge) await bridge.copy(text);
    else { try { await navigator.clipboard.writeText(text); } catch { /* ignore */ } }
    toast('الكود اتنسخ: ' + text);
  });
  $('#copy-invite').addEventListener('click', async () => {
    const text = `تعالى العب كلمة سر معانا 😄\nنزّل البرنامج، اختار «عندي كود غرفة» واكتب: ${app.online.room}`;
    if (bridge) await bridge.copy(text);
    else { try { await navigator.clipboard.writeText(text); } catch { /* ignore */ } }
    toast('رسالة الدعوة اتنسخت ✅');
  });
  $('#leave-lobby').addEventListener('click', () => {
    if (app.online.isHost && app.online.players.length > 1) {
      if (!confirm('لو خرجت الغرفة هتقفل على الكل. متأكد؟')) return;
    }
    leaveOnline();
    go('home');
  });
  $('#auto-assign').addEventListener('click', autoAssignAll);
  $('#lobby-start').addEventListener('click', hostStart);
  $$('#lobby-timer-seg button').forEach(b => b.addEventListener('click', () => {
    if (!app.online.isHost) return;
    app.settings.timer = Number(b.dataset.timer);
    saveSettings();
    $$('#lobby-timer-seg button').forEach(x => x.classList.toggle('on', x === b));
  }));

  // game
  $('#exit-game').addEventListener('click', exitGame);
  $('#room-chip').addEventListener('click', async () => {
    if (bridge) await bridge.copy(app.online.room || '');
    toast('كود الغرفة: ' + (app.online.room || ''));
  });
  $$('.panel-tabs button').forEach(b => b.addEventListener('click', () => {
    app.tab = b.dataset.tab;
    renderTabs();
  }));
  $('#chat-send').addEventListener('click', sendChat);
  $('#chat-text').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // handoff
  $('#handoff-ok').addEventListener('click', () => {
    closeOverlay('overlay-handoff');
    if (app.local.phase === 'handoff-spymaster') {
      app.local.phase = 'spymaster';
    } else if (app.local.phase === 'handoff-guess') {
      app.local.phase = 'guess';
      const st = app.local.state;
      if (st && st.timerSeconds > 0) st.turnEndsAt = Date.now() + st.timerSeconds * 1000;
    }
    renderGame();
  });

  // gameover
  $('#go-again').addEventListener('click', () => {
    closeOverlay('overlay-gameover');
    app.shownOver = false;
    if (app.mode === 'local') {
      startLocal();
    } else if (app.online.isHost) {
      hostStart();
    }
  });
  $('#go-home').addEventListener('click', () => {
    closeOverlay('overlay-gameover');
    if (app.mode === 'online') leaveOnline();
    app.local.state = null;
    go('home');
  });

  // rules
  $('#rules-close').addEventListener('click', () => closeOverlay('overlay-rules'));
  $('#rules-ok').addEventListener('click', () => closeOverlay('overlay-rules'));

  // words
  $('#custom-words').addEventListener('input', updateWordsCount);
  $('#save-words').addEventListener('click', () => saveCustomWords());
  $('#export-words').addEventListener('click', exportWords);
  $('#import-words').addEventListener('click', importWords);

  // keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['overlay-rules'].forEach(id => closeOverlay(id));
    }
  });

  // local confirmation screens
  $('#overlay-handoff').addEventListener('click', e => { if (e.target.id === 'overlay-handoff') return; });
}

function sendChat() {
  const input = $('#chat-text');
  const text = (input.value || '').trim();
  if (!text) return;
  if (!app.online.net) return;
  const me = app.online.me;
  if (!me) return;

  if (app.online.isHost) {
    pushChat(me, text);
  } else {
    guestAction({ t: 'chat', text });
    // optimistically show locally so it feels instant
    const st = app.online;
    if (!st.chat) st.chat = [];
    st.chat.push({ name: me.name, team: me.team, text, ts: Date.now(), id: me.id });
    if (st.chat.length > 80) st.chat.shift();
    renderTabs();
  }
  input.value = '';
  sfx('tap');
}

/* ------------------------------------------------------------------ */
/*  boot                                                               */
/* ------------------------------------------------------------------ */
async function waitForFonts() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 16px Cairo', 'كلمة سر'),
      document.fonts.load('700 16px Cairo', 'كلمة سر'),
      document.fonts.load('900 16px Cairo', 'كلمة سر')
    ]);
    await document.fonts.ready;
  } catch { /* ignore */ }
}

async function init() {
  await waitForFonts();
  document.body.classList.remove('booting');
  const splash = document.getElementById('boot-splash');
  if (splash) {
    setTimeout(() => splash.remove(), 450);
  }
  void document.body.offsetHeight;

  const saved = await store.get('settings', null);
  if (saved && typeof saved === 'object') app.settings = { ...DEFAULT_SETTINGS, ...saved };
  const custom = await store.get('custom', null);
  if (custom && Array.isArray(custom.words)) app.custom = { name: custom.name || 'كلماتي', words: custom.words };

  if (!app.settings.packs?.length) app.settings.packs = [...DEFAULT_SETTINGS.packs];
  app.settings.packs = app.settings.packs.filter(id => allPacks().some(p => p.id === id));

  $('#player-name').value = app.settings.name || '';
  $('#custom-name').value = app.custom.name || 'كلماتي';

  if (bridge) {
    try {
      const info = await bridge.info();
      $('#ver-label').textContent = 'v' + info.version;
    } catch { /* ignore */ }
  } else {
    $('#ver-label').textContent = 'browser preview';
  }

  bind();
  renderHome();
  go('home');
  setInterval(tick, 250);
}

init().catch(err => {
  console.error(err);
  document.body.innerHTML = '<pre style="color:#f88;padding:24px;white-space:pre-wrap">' + escapeHtml(err.stack || String(err)) + '</pre>';
});
