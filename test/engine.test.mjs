// node --test test/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';

const pool = Array.from({ length: 60 }, (_, i) => ({ ar: 'كلمة' + i, en: 'word' + i }));

function seeded(seed = 42) {
  const rng = E.mulberry32(seed);
  return rng;
}

test('buildBoard layout and uniqueness', () => {
  const rng = seeded();
  const board = E.buildBoard(pool, 'red', rng);
  assert.equal(board.length, 25);
  const count = c => board.filter(x => x.color === c).length;
  assert.equal(count('red'), 9);
  assert.equal(count('blue'), 8);
  assert.equal(count('neutral'), 7);
  assert.equal(count('assassin'), 1);
  assert.equal(new Set(board.map(c => c.ar)).size, 25);
});

test('blue starts with 9 blue cards', () => {
  const board = E.buildBoard(pool, 'blue', seeded(7));
  assert.equal(board.filter(c => c.color === 'blue').length, 9);
  assert.equal(board.filter(c => c.color === 'red').length, 8);
});

test('uniqueWords dedupes and prefers arabic', () => {
  const out = E.uniqueWords([
    { ar: 'كشري' }, { ar: 'كشري ', en: 'koshary' }, { ar: 'ملوخية', en: 'molokhia' }, { ar: '' }
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].ar, 'كشري');
});

test('clue sets guess allowance to number + 1', () => {
  const st = E.createState({ pool, firstTeam: 'red', timerSeconds: 120 }, seeded());
  const res = E.setClue(st, 'أكل', 3, 1000);
  assert.equal(res.ok, true);
  assert.equal(st.phase, 'guess');
  assert.equal(st.guessesLeft, 4);
  assert.equal(st.clue.word, 'أكل');
  assert.equal(st.turnEndsAt, 1000 + 120000);
});

test('correct guess keeps the turn, wrong guess flips it', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(3));
  E.setClue(st, 'حاجة', 2);
  const redIndex = st.board.findIndex(c => c.color === 'red');
  const before = st.scores.red;
  const r1 = E.reveal(st, redIndex);
  assert.equal(r1.type, 'correct');
  assert.equal(st.scores.red, before - 1);
  assert.equal(st.turn, 'red');

  const wrongIndex = st.board.findIndex(c => c.color === 'blue' && !c.revealed);
  const blueBefore = st.scores.blue;
  const r2 = E.reveal(st, wrongIndex);
  assert.equal(r2.type, 'wrong');
  assert.equal(st.scores.blue, blueBefore - 1);
  assert.equal(st.turn, 'blue');
  assert.equal(st.phase, 'clue');
});

test('neutral guess ends the turn without scoring', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(11));
  E.setClue(st, 'حاجة', 2);
  const neutral = st.board.findIndex(c => c.color === 'neutral');
  const scores = { ...st.scores };
  const res = E.reveal(st, neutral);
  assert.equal(res.type, 'wrong');
  assert.deepEqual(st.scores, scores);
  assert.equal(st.turn, 'blue');
});

test('assassin loses instantly', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(21));
  E.setClue(st, 'حاجة', 2);
  const killer = st.board.findIndex(c => c.color === 'assassin');
  const res = E.reveal(st, killer);
  assert.equal(res.type, 'assassin');
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 'blue');
});

test('revealing all of a team cards wins', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(5));
  E.setClue(st, 'حاجة', 9);
  const reds = st.board.map((c, i) => ({ c, i })).filter(x => x.c.color === 'red');
  let last;
  for (const x of reds) {
    if (st.phase !== 'guess') E.setClue(st, 'حاجة', 9);
    last = E.reveal(st, x.i);
  }
  assert.equal(last.type, 'win');
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 'red');
  assert.equal(st.scores.red, 0);
});

test('guesses run out and turn passes', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(9));
  E.setClue(st, 'حاجة', 0); // one guess only
  const redIndex = st.board.findIndex(c => c.color === 'red');
  const res = E.reveal(st, redIndex);
  assert.equal(res.type, 'exhausted');
  assert.equal(st.turn, 'blue');
});

test('revealed card cannot be revealed twice', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(13));
  E.setClue(st, 'حاجة', 3);
  const idx = st.board.findIndex(c => c.color === 'red');
  E.reveal(st, idx);
  const again = E.reveal(st, idx);
  assert.equal(again.ok, false);
});

test('makeView hides colours from guessers', () => {
  const st = E.createState({ pool, firstTeam: 'red' }, seeded(17));
  const guesserView = E.makeView(st, { showKey: false });
  assert.ok(guesserView.board.every(c => c.color === null));
  const spyView = E.makeView(st, { showKey: true });
  assert.ok(spyView.board.some(c => c.color === 'red'));

  E.setClue(st, 'حاجة', 2);
  const idx = st.board.findIndex(c => c.color === 'red');
  E.reveal(st, idx);
  const after = E.makeView(st, { showKey: false });
  assert.equal(after.board[idx].color, 'red');
  assert.equal(after.board[idx].revealed, true);
});

test('timer only starts after the clue', () => {
  const st = E.createState({ pool, firstTeam: 'red', timerSeconds: 60 }, seeded());
  assert.equal(st.turnEndsAt, 0);
  E.setClue(st, 'حاجة', 2, 5000);
  assert.equal(st.turnEndsAt, 65000);
  E.endTurn(st, 7000);
  assert.equal(st.turnEndsAt, 0);
});
