import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKS } from '../src/data/words.js';

const MIN_WORDS = 80;

test('every pack has at least 80 words', () => {
  for (const pack of PACKS) {
    assert.ok(
      pack.words.length >= MIN_WORDS,
      `${pack.id} has only ${pack.words.length} words (need ${MIN_WORDS})`
    );
  }
});

test('no pack has duplicate words', () => {
  for (const pack of PACKS) {
    const seen = new Set();
    for (const [ar] of pack.words) {
      const key = String(ar).trim().toLowerCase();
      assert.ok(!seen.has(key), `duplicate "${ar}" in pack ${pack.id}`);
      seen.add(key);
    }
  }
});

test('every word has arabic and english text', () => {
  for (const pack of PACKS) {
    for (const word of pack.words) {
      assert.ok(word[0] && String(word[0]).trim(), `missing arabic in ${pack.id}`);
      assert.ok(word[1] && String(word[1]).trim(), `missing english in ${pack.id}`);
    }
  }
});

test('expected packs exist, including the 18+ opt-in pack', () => {
  const ids = PACKS.map(p => p.id);
  for (const id of ['stars', 'memes', 'movies', 'food', 'places', 'daily', 'heritage', 'gaming', 'english', 'adult']) {
    assert.ok(ids.includes(id), `missing pack ${id}`);
  }
});
