// node --test test/traps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';

const pool = Array.from({ length: 60 }, (_, i) => ({ ar: 'كلمة' + i, en: 'word' + i }));
const seeded = (seed = 42) => E.mulberry32(seed);

// Build a state with a known board so trap effects are easy to target.
function rigged() {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(1));
  st.board = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    ar: 'كارت' + i,
    en: 'card' + i,
    color: i < 9 ? 'red' : i < 17 ? 'blue' : i < 24 ? 'neutral' : 'assassin',
    revealed: false
  }));
  st.scores = { red: 9, blue: 8 };
  st.turn = 'red';
  st.phase = 'guess';
  st.guessesLeft = 3;
  return st;
}

test('dealTraps hides one of each trap on neutral cards only', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const board = E.buildBoard(pool, 'red', seeded(seed));
    E.dealPowerups(board, seeded(seed + 100));
    E.dealTraps(board, seeded(seed + 200));
    const trapped = board.filter(c => c.trap);
    assert.equal(trapped.length, 3);
    assert.deepEqual([...new Set(trapped.map(c => c.trap))].sort(), [...E.TRAP_IDS].sort());
    for (const card of trapped) {
      assert.equal(card.color, 'neutral');
      assert.equal(!!card.powerup, false);
      assert.equal(card.trapUsed, false);
    }
  }
});

test('traps can be turned off', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(3));
  assert.equal(st.modifiers.traps, false);
  assert.equal(st.board.filter(c => c.trap).length, 0);
});

test('traps deal automatically when enabled', () => {
  const st = E.createState({ pool, firstTeam: 'red', traps: true }, seeded(5));
  assert.equal(st.modifiers.traps, true);
  assert.equal(st.board.filter(c => c.trap).length, 3);
  assert.equal(st.skipTurn.red, 0);
  assert.equal(st.trapPenalty.red, 0);
});

test('mine makes the team skip their next turn', () => {
  const st = rigged();
  st.board[17].trap = 'mine';
  const res = E.reveal(st, 17);
  assert.equal(res.trap.type, 'mine');
  assert.equal(st.skipTurn.red, 1);
  assert.equal(st.turn, 'blue');

  E.endTurn(st); // blue ends their turn normally
  assert.equal(st.turn, 'blue'); // red was skipped, blue plays again
  assert.equal(st.skipTurn.red, 0);
  assert.ok(st.log.some(l => l.kind === 'trap' && l.text.includes('فقدوا دورهم')));
});

test('snare removes one guess from the next clue', () => {
  const st = rigged();
  st.board[17].trap = 'snare';
  const res = E.reveal(st, 17);
  assert.equal(res.trap.type, 'snare');
  assert.equal(st.trapPenalty.red, 1);
  assert.equal(st.turn, 'blue');

  st.turn = 'red';
  st.phase = 'clue';
  E.setClue(st, 'حاجة', 2); // 2 + 1 - 1
  assert.equal(st.guessesLeft, 2);
  assert.equal(st.trapPenalty.red, 0);
  assert.ok(st.log.some(l => l.kind === 'trap' && l.text.includes('−1')));
});

test('snare never drops the allowance below one guess', () => {
  const st = rigged();
  st.trapPenalty.red = 1;
  st.phase = 'clue';
  E.setClue(st, 'صفر', 0); // 0 + 1 - 1 would be 0
  assert.equal(st.guessesLeft, 1);
});

test('leak exposes one own card colour without scoring it', () => {
  const st = rigged();
  st.board[17].trap = 'leak';
  const res = E.reveal(st, 17, seeded(9));
  assert.equal(res.trap.type, 'leak');
  assert.ok(res.trap.leakedCard);

  const leaked = st.board.find(c => c.leaked);
  assert.ok(leaked);
  assert.equal(leaked.color, 'red');
  assert.equal(leaked.revealed, false);
  assert.equal(st.scores.red, 9);

  const guesserView = E.makeView(st, { showKey: false });
  const spyView = E.makeView(st, { showKey: true });
  assert.equal(guesserView.board.find(c => c.id === leaked.id).color, 'red');
  assert.equal(guesserView.board.find(c => c.id === leaked.id).leaked, true);
  assert.equal(spyView.board.find(c => c.id === leaked.id).color, 'red');
});

test('trap badges are visible to spymasters only', () => {
  const st = E.createState({ pool, firstTeam: 'red', traps: true }, seeded(7));
  const guesser = E.makeView(st, { showKey: false });
  const spy = E.makeView(st, { showKey: true });
  assert.equal(guesser.board.filter(c => c.trap).length, 0);
  assert.equal(spy.board.filter(c => c.trap).length, 3);
});
