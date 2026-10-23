// node --test test/powerups.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';

const pool = Array.from({ length: 60 }, (_, i) => ({ ar: 'كلمة' + i, en: 'word' + i }));
const seeded = (seed = 42) => E.mulberry32(seed);

// Build a state with a known board so effects are easy to target.
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

test('dealPowerups puts one per team colour and one on a neutral card', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const board = E.buildBoard(pool, 'red', seeded(seed));
    E.dealPowerups(board, seeded(seed + 100));
    const withPu = board.filter(c => c.powerup);
    assert.equal(withPu.length, 3);
    assert.equal(withPu.filter(c => c.color === 'red').length, 1);
    assert.equal(withPu.filter(c => c.color === 'blue').length, 1);
    assert.equal(withPu.filter(c => c.color === 'neutral').length, 1);
    assert.equal(withPu.filter(c => c.color === 'assassin').length, 0);
    assert.deepEqual([...new Set(withPu.map(c => c.powerup))].sort(), [...E.POWERUP_IDS].sort());
  }
});

test('powerups can be turned off', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(3));
  assert.equal(st.modifiers.powerups, false);
  assert.equal(st.board.filter(c => c.powerup).length, 0);
});

test('powerups deal automatically when enabled', () => {
  const st = E.createState({ pool, firstTeam: 'red', powerups: true }, seeded(5));
  assert.equal(st.modifiers.powerups, true);
  assert.equal(st.board.filter(c => c.powerup).length, 3);
  assert.equal(st.shields.red, 0);
  assert.equal(st.shields.blue, 0);
});

test('surge on a correct card adds two guesses immediately', () => {
  const st = rigged();
  st.board[0].powerup = 'surge';
  const res = E.reveal(st, 0);
  assert.equal(res.type, 'correct');
  assert.equal(res.powerup.type, 'surge');
  assert.equal(st.guessesLeft, 4); // 3 - 1 + 2
});

test('shield saves a wrong guess and keeps the turn', () => {
  const st = rigged();
  st.shields.red = 1;
  const blueBefore = st.scores.blue;
  const res = E.reveal(st, 9); // blue card
  assert.equal(res.type, 'shielded');
  assert.equal(st.turn, 'red');
  assert.equal(st.phase, 'guess');
  assert.equal(st.shields.red, 0);
  assert.equal(st.scores.blue, blueBefore - 1);
});

test('shield survives the assassin once', () => {
  const st = rigged();
  st.shields.red = 1;
  const res = E.reveal(st, 24);
  assert.equal(res.type, 'saved');
  assert.equal(st.phase, 'clue');
  assert.equal(st.winner, null);
  assert.equal(st.turn, 'blue');
  assert.equal(st.shields.red, 0);
});

test('finding a shield on a bad card saves that same turn', () => {
  const st = rigged();
  st.board[17].powerup = 'shield';
  const res = E.reveal(st, 17); // neutral
  assert.equal(res.type, 'shielded');
  assert.equal(st.turn, 'red');
  assert.equal(st.shields.red, 0);
});

test('reveal powerup uncovers an extra card of your team', () => {
  const st = rigged();
  st.board[0].powerup = 'reveal';
  const res = E.reveal(st, 0);
  assert.equal(res.powerup.type, 'reveal');
  assert.ok(res.powerup.autoCard);
  assert.equal(st.scores.red, 7); // the flipped card + the free reveal
  assert.equal(st.board.filter(c => c.revealed && c.color === 'red').length, 2);
});

test('surge found on a wrong card applies to the next clue', () => {
  const st = rigged();
  st.board[17].powerup = 'surge';
  const res = E.reveal(st, 17); // neutral, turn ends
  assert.equal(res.type, 'wrong');
  assert.equal(st.turn, 'blue');
  assert.equal(st.bonusGuesses.red, 2);

  st.turn = 'red';
  st.phase = 'clue';
  E.setClue(st, 'تلميح', 1);
  assert.equal(st.guessesLeft, 4); // 1 + 1 + 2
  assert.equal(st.bonusGuesses.red, 0);
});

test('views expose shields but hide unused powerup types', () => {
  const st = E.createState({ pool, firstTeam: 'red', powerups: true }, seeded(7));
  st.shields.red = 1;
  const view = E.makeView(st, { showKey: false });
  assert.equal(view.shields.red, 1);
  assert.equal(view.modifiers.powerups, true);

  const hidden = view.board.find(c => c.powerup && !c.revealed);
  assert.ok(hidden);
  assert.equal(hidden.powerup.used, false);
  assert.equal(hidden.powerup.type, null);

  E.setClue(st, 'حاجة', 5);
  E.reveal(st, hidden.id);
  const after = E.makeView(st, { showKey: false });
  const used = after.board.find(c => c.id === hidden.id);
  assert.equal(used.powerup.used, true);
  assert.ok(used.powerup.type);
  assert.ok(after.lastPowerup);
});
