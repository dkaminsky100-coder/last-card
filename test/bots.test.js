import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, startNextRound, isLegal } from '../src/engine.js';
import { chooseMove, DIFFICULTIES } from '../src/bots.js';
import { mulberry32 } from '../src/rng.js';
import { runMatch } from '../sim.js';

const card = (id, color, value) => Object.freeze({ id, color, value });

function fixture({ hands, top, color, current = 0, opts = {} }) {
  const s = createGame({ numPlayers: hands.length, ...opts }, 3);
  s.players.forEach((p, i) => { p.hand = hands[i]; p.saidLast = false; });
  s.discard = [top];
  s.currentColor = color ?? top.color;
  s.current = current;
  s.direction = 1;
  s.phase = 'play';
  s.pendingDraw = 0;
  s.drawnCardId = null;
  s.lastWindow = null;
  s.log = [];
  return s;
}

const filler = (prefix, n) => Array.from({ length: n }, (_, i) => card(`${prefix}${i}`, 'green', String((i % 9) + 1)));

test('every difficulty always returns a legal move across many games and options', () => {
  const optionSets = [{}, { stackDrawTwo: true }, { challengeWild4: true }, { stackDrawTwo: true, challengeWild4: true }];
  for (let seed = 1; seed <= 120; seed++) {
    const n = 2 + (seed % 3);
    const diffs = Array.from({ length: n }, (_, i) => DIFFICULTIES[(seed + i) % 3]);
    const rand = mulberry32(seed);
    let s = createGame({ numPlayers: n, ...optionSets[seed % 4] }, seed);
    let moves = 0;
    while (s.phase !== 'gameOver') {
      if (s.phase === 'roundOver') { s = startNextRound(s); continue; }
      const m = chooseMove(s, s.current, diffs[s.current], rand);
      assert.ok(isLegal(s, m), `illegal bot move ${JSON.stringify(m)}`);
      s = applyMove(s, m);
      assert.ok(++moves < 50000);
    }
  }
});

test('medium prefers a number card and saves the wild', () => {
  const s = fixture({
    hands: [[card('w', null, 'wild'), card('s', 'red', 'skip'), card('n', 'red', '4')], filler('o', 7)],
    top: card('t', 'red', '9'),
  });
  assert.equal(chooseMove(s, 0, 'medium').cardId, 'n');
});

test('medium dumps action cards when an opponent is close to winning', () => {
  const s = fixture({
    hands: [[card('s', 'red', 'skip'), card('n', 'red', '4'), card('x', 'blue', '1')], filler('o', 2)],
    top: card('t', 'red', '9'),
  });
  assert.equal(chooseMove(s, 0, 'medium').cardId, 's');
});

test('medium plays a wild only with no other option and picks its most-held color', () => {
  const s = fixture({
    hands: [[card('w', null, 'wild'), card('b1', 'blue', '1'), card('b2', 'blue', '2'), card('y', 'yellow', '3')], filler('o', 7)],
    top: card('t', 'red', '9'),
  });
  const m = chooseMove(s, 0, 'medium');
  assert.equal(m.cardId, 'w');
  assert.equal(m.chosenColor, 'blue');
});

test('medium and hard always call last card; easy sometimes forgets', () => {
  const hands = () => [[card('a', 'red', '1'), card('b', 'red', '2')], filler('o', 7)];
  for (const d of ['medium', 'hard']) {
    const s = fixture({ hands: hands(), top: card('t', 'red', '9') });
    assert.equal(chooseMove(s, 0, d).type, 'callLast');
  }
  const rand = mulberry32(99);
  let forgot = 0;
  for (let i = 0; i < 2000; i++) {
    const s = fixture({ hands: hands(), top: card('t', 'red', '9') });
    if (chooseMove(s, 0, 'easy', rand).type !== 'callLast') forgot++;
  }
  assert.ok(forgot > 400 && forgot < 600, `easy forgot ${forgot}/2000`);
});

test('hard targets a next player holding 2 or fewer cards with Draw Two', () => {
  const s = fixture({
    hands: [[card('d', 'red', 'draw2'), card('n', 'red', '4'), card('m', 'red', '7'), card('x', 'blue', '1')], filler('o', 2), filler('p', 6)],
    top: card('t', 'red', '9'),
  });
  assert.equal(chooseMove(s, 0, 'hard').cardId, 'd');
  // With a big next hand it keeps the Draw Two for later.
  const calm = fixture({
    hands: [[card('d', 'red', 'draw2'), card('n', 'red', '4'), card('m', 'red', '7'), card('x', 'blue', '1')], filler('o', 7), filler('p', 6)],
    top: card('t', 'red', '9'),
  });
  assert.notEqual(chooseMove(calm, 0, 'hard').cardId, 'd');
});

test('hard steers into a color the next player just drew on', () => {
  // Next player drew on blue: they lack it. Hard plays the blue 9 over the green 9.
  const s = fixture({
    hands: [[card('g', 'green', '9'), card('b', 'blue', '9'), card('g2', 'green', '2'), card('b2', 'blue', '2')], filler('o', 3)],
    top: card('t', 'red', '9'),
  });
  s.log = [{ type: 'draw', player: 1, color: 'blue', value: '5' }];
  assert.equal(chooseMove(s, 0, 'hard').cardId, 'b');
});

test('hard keeps a lone wild as its final card', () => {
  const s = fixture({
    hands: [[card('w', null, 'wild'), card('n', 'red', '4')], filler('o', 7)],
    top: card('t', 'red', '9'),
  });
  s.players[0].saidLast = true;
  assert.equal(chooseMove(s, 0, 'hard').cardId, 'n');
});

test('simulation ranks easy < medium < hard', () => {
  const em = runMatch(['easy', 'medium'], 300, {}, 500);
  assert.ok(em[1].games > 0.65, `medium vs easy ${em[1].games}`);
  const mh = runMatch(['medium', 'hard'], 600, {}, 900);
  assert.ok(mh[1].games > 0.53, `hard vs medium ${mh[1].games}`);
});
