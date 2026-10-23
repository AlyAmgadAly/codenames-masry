// ============================================================
//  Codenames Masry — pure game engine (no DOM, no network)
// ============================================================

export const RED = 'red';
export const BLUE = 'blue';
export const NEUTRAL = 'neutral';
export const ASSASSIN = 'assassin';

export const TEAM_LABEL = { red: 'الأحمر', blue: 'الأزرق' };

/* ---------- tiny rng helpers (seeded rng optional) ---------- */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- word helpers ---------- */
export function normalise(word) {
  return String(word || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function uniqueWords(list) {
  const seen = new Set();
  const out = [];
  for (const w of list) {
    const key = normalise(w.ar || w.en);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ar: w.ar || w.en, en: w.en || w.ar });
  }
  return out;
}

/* ---------- board ---------- */
const LAYOUT = {
  red: { red: 9, blue: 8, neutral: 7, assassin: 1 },
  blue: { red: 8, blue: 9, neutral: 7, assassin: 1 }
};

export function buildBoard(pool, firstTeam = RED, rng = Math.random) {
  if (pool.length < 25) throw new Error('need at least 25 words');
  const words = shuffle(pool, rng).slice(0, 25);
  const counts = LAYOUT[firstTeam] || LAYOUT.red;
  const colours = [
    ...Array(counts.red).fill(RED),
    ...Array(counts.blue).fill(BLUE),
    ...Array(counts.neutral).fill(NEUTRAL),
    ...Array(counts.assassin).fill(ASSASSIN)
  ];
  const shuffled = shuffle(colours, rng);
  return words.map((w, i) => ({
    id: i,
    ar: w.ar,
    en: w.en,
    color: shuffled[i],
    revealed: false
  }));
}

/* ---------- state ---------- */
export function createState(opts = {}, rng = Math.random) {
  const {
    pool = [],
    firstTeam = RED,
    timerSeconds = 0,
    now = Date.now(),
    mode = 'local',
    packs = []
  } = opts;

  const board = buildBoard(pool, firstTeam, rng);
  const state = {
    version: 1,
    mode,
    packs,
    board,
    startTeam: firstTeam,
    turn: firstTeam,
    scores: { red: board.filter(c => c.color === RED).length, blue: board.filter(c => c.color === BLUE).length },
    clue: null,
    phase: 'clue',          // clue | guess | over
    clueNumber: 0,
    guessesLeft: 0,
    timerSeconds,
    turnEndsAt: 0,
    winner: null,
    winReason: '',
    log: [],
    chat: [],
    createdAt: now
  };
  addLog(state, 'start', `بدأت اللعبة — ${TEAM_LABEL[firstTeam]} بيبدأ`);
  return state;
}

export function addLog(state, kind, text) {
  state.log.unshift({ kind, text, ts: Date.now() });
  if (state.log.length > 60) state.log.length = 60;
}

export function setClue(state, word, count, now = Date.now()) {
  if (state.phase !== 'clue') return { ok: false, error: 'مش وقت التلميح' };
  const clean = String(word || '').trim();
  if (!clean) return { ok: false, error: 'اكتب كلمة التلميح' };
  const n = Math.max(0, Math.min(9, Number(count) || 0));
  state.clue = { word: clean, count: n, team: state.turn };
  state.phase = 'guess';
  state.guessesLeft = n + 1;              // official: number + 1 guesses
  if (state.timerSeconds > 0) state.turnEndsAt = now + state.timerSeconds * 1000;
  addLog(state, 'clue', `${TEAM_LABEL[state.turn]}: «${clean}» ${n}`);
  state.version++;
  return { ok: true };
}

export function reveal(state, index) {
  if (state.phase !== 'guess') return { ok: false, error: 'مش وقت التخمين' };
  const card = state.board[index];
  if (!card) return { ok: false, error: 'كارت غلط' };
  if (card.revealed) return { ok: false, error: 'الكارت مكشوف already' };

  card.revealed = true;
  state.version++;

  if (card.color === ASSASSIN) {
    state.phase = 'over';
    state.winner = state.turn === RED ? BLUE : RED;
    state.winReason = `الفريق ${TEAM_LABEL[state.turn]} فتحوا القاتل 💀`;
    addLog(state, 'bad', `💀 ${card.ar} — القاتل!`);
    return { ok: true, type: 'assassin' };
  }

  if (card.color === state.turn) {
    state.scores[card.color]--;
    state.guessesLeft = Math.max(0, state.guessesLeft - 1);
    addLog(state, 'good', `✅ ${card.ar}`);
    if (state.scores[card.color] === 0) {
      state.phase = 'over';
      state.winner = card.color;
      state.winReason = `الفريق ${TEAM_LABEL[card.color]} كشف كل كلماته`;
      addLog(state, 'win', `🏆 ${TEAM_LABEL[card.color]} كسبوا!`);
      return { ok: true, type: 'win' };
    }
    if (state.guessesLeft === 0) {
      endTurn(state);
      return { ok: true, type: 'exhausted' };
    }
    return { ok: true, type: 'correct' };
  }

  // wrong card (opponent or neutral) — turn ends
  if (card.color !== NEUTRAL) {
    state.scores[card.color]--;
    addLog(state, 'bad', card.color === RED ? `🔴 ${card.ar}` : `🔵 ${card.ar}`);
    if (state.scores[card.color] === 0) {
      state.phase = 'over';
      state.winner = card.color;
      state.winReason = `الفريق ${TEAM_LABEL[card.color]} كشف كل كلماته`;
      addLog(state, 'win', `🏆 ${TEAM_LABEL[card.color]} كسبوا!`);
      return { ok: true, type: 'win' };
    }
  } else {
    addLog(state, 'bad', `⚪ ${card.ar}`);
  }
  endTurn(state);
  return { ok: true, type: 'wrong' };
}

export function endTurn(state, now = Date.now()) {
  if (state.phase === 'over') return;
  state.turn = state.turn === RED ? BLUE : RED;
  state.phase = 'clue';
  state.clue = null;
  state.guessesLeft = 0;
  state.turnEndsAt = 0;
  addLog(state, 'turn', `دور ${TEAM_LABEL[state.turn]}`);
  state.version++;
}

export function timeLeft(state, now = Date.now()) {
  if (!state.turnEndsAt || state.phase === 'over') return 0;
  return Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000));
}

/* ---------- views ---------- */
export function makeView(state, opts = {}) {
  const { showKey = false, role = 'guesser', you = null, room = null, players = [] } = opts;
  return {
    version: state.version,
    mode: state.mode,
    board: state.board.map(c => ({
      id: c.id,
      ar: c.ar,
      en: c.en,
      revealed: c.revealed,
      color: showKey || c.revealed ? c.color : null
    })),
    turn: state.turn,
    startTeam: state.startTeam,
    scores: { ...state.scores },
    clue: state.clue,
    phase: state.phase,
    guessesLeft: state.guessesLeft,
    timerSeconds: state.timerSeconds,
    turnEndsAt: state.turnEndsAt,
    now: Date.now(),
    winner: state.winner,
    winReason: state.winReason,
    log: state.log,
    chat: state.chat,
    role,
    you,
    room,
    players
  };
}

/* ---------- scoring helpers for the UI ---------- */
export function cardsLeft(state, team) {
  return state.board.filter(c => c.color === team && !c.revealed).length;
}
