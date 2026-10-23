// ============================================================
//  Codenames Masry — pure game engine (no DOM, no network)
// ============================================================

export const RED = 'red';
export const BLUE = 'blue';
export const NEUTRAL = 'neutral';
export const ASSASSIN = 'assassin';

export const TEAM_LABEL = { red: 'الأحمر', blue: 'الأزرق' };

/* ---------- powerups (optional game modifier) ---------- */
export const POWERUP_IDS = ['surge', 'shield', 'reveal'];
export const POWERUP_INFO = {
  surge: { id: 'surge', emoji: '⚡', name: 'دفعة تخمينات', desc: '+٢ تخمينات' },
  shield: { id: 'shield', emoji: '🛡️', name: 'درع', desc: 'بيمنع غلطة واحدة (وحتى القاتل مرة)' },
  reveal: { id: 'reveal', emoji: '👁️', name: 'كشف', desc: 'بيكشف كارت من كروت فريقك' }
};

/* ---------- traps (optional game modifier) ---------- */
export const TRAP_IDS = ['mine', 'snare', 'leak'];
export const TRAP_INFO = {
  mine: { id: 'mine', emoji: '💥', name: 'لغم', desc: 'فريقك يخسر دوره الجاي' },
  snare: { id: 'snare', emoji: '🪤', name: 'مصيدة', desc: '‏−١ تخمين في دورك الجاي' },
  leak: { id: 'leak', emoji: '📢', name: 'تسريب', desc: 'كارت من كروتك لونه بيتكشف للكل' }
};

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

// One powerup under a random red card, one under a blue card, and one under a
// neutral card. The types are dealt randomly, so nobody knows what is where.
export function dealPowerups(board, rng = Math.random) {
  const byColour = { [RED]: [], [BLUE]: [], [NEUTRAL]: [] };
  for (const card of board) {
    if (byColour[card.color]) byColour[card.color].push(card);
  }
  const types = shuffle(POWERUP_IDS, rng);
  [RED, BLUE, NEUTRAL].forEach((colour, i) => {
    const list = byColour[colour];
    if (!list.length) return;
    const card = list[Math.floor(rng() * list.length)];
    card.powerup = types[i];
    card.powerupUsed = false;
  });
}

// Three traps, one of each type, hidden under different neutral ("innocent")
// cards. Cards already holding a powerup are skipped so a single card can't
// reward and punish at the same time.
export function dealTraps(board, rng = Math.random) {
  const neutrals = board.filter(c => c.color === NEUTRAL && !c.powerup);
  const picks = shuffle(neutrals, rng).slice(0, TRAP_IDS.length);
  const types = shuffle(TRAP_IDS, rng);
  picks.forEach((card, i) => {
    card.trap = types[i];
    card.trapUsed = false;
  });
}

/* ---------- state ---------- */
export function createState(opts = {}, rng = Math.random) {
  const {
    pool = [],
    firstTeam = RED,
    timerSeconds = 0,
    now = Date.now(),
    mode = 'local',
    packs = [],
    powerups = false,
    traps = false
  } = opts;

  const board = buildBoard(pool, firstTeam, rng);
  if (powerups) dealPowerups(board, rng);
  if (traps) dealTraps(board, rng);
  const state = {
    version: 1,
    mode,
    packs,
    board,
    modifiers: { powerups: !!powerups, traps: !!traps },
    startTeam: firstTeam,
    turn: firstTeam,
    scores: { red: board.filter(c => c.color === RED).length, blue: board.filter(c => c.color === BLUE).length },
    shields: { red: 0, blue: 0 },
    bonusGuesses: { red: 0, blue: 0 },
    skipTurn: { red: 0, blue: 0 },
    trapPenalty: { red: 0, blue: 0 },
    lastPowerup: null,
    lastTrap: null,
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
  const bonus = state.bonusGuesses?.[state.turn] || 0;
  const penalty = state.trapPenalty?.[state.turn] || 0;
  state.clue = { word: clean, count: n, team: state.turn };
  state.phase = 'guess';
  // official: number + 1 guesses (+ powerup bonus − trap penalty)
  state.guessesLeft = Math.max(1, n + 1 + bonus - penalty);
  if (bonus) {
    state.bonusGuesses[state.turn] = 0;
    addLog(state, 'power', `⚡ ${TEAM_LABEL[state.turn]}: +${bonus} تخمين من الباور أب`);
  }
  if (penalty) {
    state.trapPenalty[state.turn] = 0;
    addLog(state, 'trap', `🪤 ${TEAM_LABEL[state.turn]}: −${penalty} تخمين بسبب المصيدة`);
  }
  if (state.timerSeconds > 0) state.turnEndsAt = now + state.timerSeconds * 1000;
  addLog(state, 'clue', `${TEAM_LABEL[state.turn]}: «${clean}» ${n}`);
  state.version++;
  return { ok: true };
}

export function reveal(state, index, rng = Math.random) {
  if (state.phase !== 'guess') return { ok: false, error: 'مش وقت التخمين' };
  const card = state.board[index];
  if (!card) return { ok: false, error: 'كارت غلط' };
  if (card.revealed) return { ok: false, error: 'الكارت مكشوف already' };

  const team = state.turn;
  card.revealed = true;
  state.version++;

  let type = 'correct';
  let assassinSaved = false;

  if (card.color === ASSASSIN) {
    if ((state.shields?.[team] || 0) > 0) {
      state.shields[team]--;
      assassinSaved = true;
      type = 'saved';
      addLog(state, 'power', `🛡️ درع ${TEAM_LABEL[team]} أنقذهم من القاتل!`);
    } else {
      state.phase = 'over';
      state.winner = team === RED ? BLUE : RED;
      state.winReason = `الفريق ${TEAM_LABEL[team]} فتحوا القاتل 💀`;
      addLog(state, 'bad', `💀 ${card.ar} — القاتل!`);
      return { ok: true, type: 'assassin' };
    }
  } else if (card.color === team) {
    state.scores[team]--;
    state.guessesLeft = Math.max(0, state.guessesLeft - 1);
    addLog(state, 'good', `✅ ${card.ar}`);
  } else {
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
    type = 'wrong';
  }

  // A powerup hidden under the revealed card goes to the team that flipped it.
  const powerup = (card.powerup && !card.powerupUsed)
    ? applyPowerup(state, card, team, rng)
    : null;

  // A trap hidden under an innocent (neutral) card punishes the team that
  // stepped on it. Only the spymaster can see these, so they can steer away.
  const trap = (card.trap && !card.trapUsed)
    ? applyTrap(state, card, team, rng)
    : null;

  if (state.scores[team] === 0) {
    state.phase = 'over';
    state.winner = team;
    state.winReason = `الفريق ${TEAM_LABEL[team]} كشف كل كلماته`;
    addLog(state, 'win', `🏆 ${TEAM_LABEL[team]} كسبوا!`);
    return { ok: true, type: 'win', powerup, trap };
  }

  if (type === 'wrong' || assassinSaved) {
    // A shield (found earlier, or under this very card) saves the turn.
    if ((state.shields?.[team] || 0) > 0) {
      state.shields[team]--;
      addLog(state, 'power', `🛡️ درع ${TEAM_LABEL[team]} منع خسارة الدور`);
      return { ok: true, type: 'shielded', powerup, trap };
    }
    endTurn(state);
    return { ok: true, type: assassinSaved ? 'saved' : 'wrong', powerup, trap };
  }

  if (state.guessesLeft === 0) {
    endTurn(state);
    return { ok: true, type: 'exhausted', powerup, trap };
  }
  return { ok: true, type: 'correct', powerup, trap };
}

/* ---------- powerup effects ---------- */
function autoRevealOwn(state, team, rng) {
  const own = state.board.filter(c => !c.revealed && c.color === team);
  if (!own.length) return null;
  // Prefer cards without a powerup so one pickup can't chain into another.
  const safe = own.filter(c => !c.powerup || c.powerupUsed);
  const pool = safe.length ? safe : own;
  const card = pool[Math.floor(rng() * pool.length)];
  card.revealed = true;
  state.scores[team] = Math.max(0, state.scores[team] - 1);
  addLog(state, 'power', `👁️ كشف مجاني: ${card.ar}`);
  return card;
}

function applyPowerup(state, card, team, rng) {
  const type = card.powerup;
  if (!type) return null;
  card.powerupUsed = true;
  const info = POWERUP_INFO[type] || { emoji: '🎁', name: 'باور أب' };
  const wrong = card.color !== team && card.color !== ASSASSIN;
  const event = { type, team, cardAr: card.ar, ts: Date.now(), autoCard: null };

  if (type === 'surge') {
    if (wrong) {
      state.bonusGuesses[team] = (state.bonusGuesses[team] || 0) + 2;
      addLog(state, 'power', `${info.emoji} ${TEAM_LABEL[team]} لاقوا ${info.name} — +٢ تخمين في دورهم الجاي`);
    } else {
      state.guessesLeft += 2;
      addLog(state, 'power', `${info.emoji} ${TEAM_LABEL[team]} لاقوا ${info.name} — +٢ تخمين`);
    }
  } else if (type === 'shield') {
    state.shields[team] = 1;
    addLog(state, 'power', `${info.emoji} ${TEAM_LABEL[team]} لاقوا ${info.name} — بيمنع غلطة واحدة`);
  } else if (type === 'reveal') {
    const target = autoRevealOwn(state, team, rng);
    event.autoCard = target ? target.ar : null;
    if (!target) addLog(state, 'power', `${info.emoji} ${TEAM_LABEL[team]} لاقوا ${info.name} بس مفيش كروت تتكشف`);
  }

  state.lastPowerup = event;
  state.version++;
  return event;
}

/* ---------- trap effects ---------- */
function leakOwnCard(state, team, rng) {
  const own = state.board.filter(c => !c.revealed && c.color === team && !c.leaked);
  if (!own.length) return null;
  const card = own[Math.floor(rng() * own.length)];
  card.leaked = true;
  return card;
}

function applyTrap(state, card, team, rng) {
  const type = card.trap;
  if (!type) return null;
  card.trapUsed = true;
  const event = { type, team, cardAr: card.ar, ts: Date.now(), leakedCard: null };

  if (type === 'mine') {
    state.skipTurn[team] = (state.skipTurn[team] || 0) + 1;
    addLog(state, 'trap', `💥 لغم! ${TEAM_LABEL[team]} هيفقدوا دورهم الجاي`);
  } else if (type === 'snare') {
    state.trapPenalty[team] = (state.trapPenalty[team] || 0) + 1;
    addLog(state, 'trap', `🪤 مصيدة! ${TEAM_LABEL[team]} −١ تخمين في دورهم الجاي`);
  } else if (type === 'leak') {
    const target = leakOwnCard(state, team, rng);
    event.leakedCard = target ? target.ar : null;
    addLog(state, 'trap', target
      ? `📢 تسريب! لون كارت ${target.ar} اتكشف للكل`
      : '📢 تسريب! بس مفيش كروت تتكشف');
  }

  state.lastTrap = event;
  state.version++;
  return event;
}

export function endTurn(state, now = Date.now()) {
  if (state.phase === 'over') return;
  let next = state.turn === RED ? BLUE : RED;
  // A landmine makes the other team skip their whole next turn.
  if ((state.skipTurn?.[next] || 0) > 0) {
    state.skipTurn[next]--;
    addLog(state, 'trap', `💥 ${TEAM_LABEL[next]} فقدوا دورهم بسبب اللغم`);
    next = state.turn;
  }
  state.turn = next;
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
      color: showKey || c.revealed || c.leaked ? c.color : null,
      leaked: !!c.leaked,
      powerup: c.powerup ? { used: !!c.powerupUsed, type: c.powerupUsed ? c.powerup : null } : null,
      trap: showKey && c.trap && !c.trapUsed ? c.trap : null
    })),
    turn: state.turn,
    startTeam: state.startTeam,
    scores: { ...state.scores },
    shields: { ...(state.shields || { red: 0, blue: 0 }) },
    modifiers: { ...(state.modifiers || { powerups: false, traps: false }) },
    lastPowerup: state.lastPowerup || null,
    lastTrap: state.lastTrap || null,
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
