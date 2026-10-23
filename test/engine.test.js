import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeck, createGame, legalMoves, applyMove, startNextRound, isLegal, cardPoints, topCard, COLORS,
} from '../src/engine.js';
import { mulberry32 } from '../src/rng.js';

const card = (id, color, value) => Object.freeze({ id, color, value });

// Builds a controlled mid-round state from a real game.
function fixture({ hands, top, color, current = 0, opts = {}, drawPile }) {
  const s = createGame({ numPlayers: hands.length, ...opts }, 7);
  s.players.forEach((p, i) => { p.hand = hands[i]; p.saidLast = false; });
  s.discard = [top];
  s.currentColor = color ?? top.color;
  s.current = current;
  s.direction = 1;
  s.phase = 'play';
  s.pendingDraw = 0;
  s.drawnCardId = null;
  s.lastWindow = null;
  if (drawPile) s.drawPile = drawPile;
  return s;
}

const totalCards = (s) => s.drawPile.length + s.discard.length + s.players.reduce((a, p) => a + p.hand.length, 0);

test('deck has 108 cards with the right composition', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108);
  for (const color of COLORS) {
    const cs = deck.filter((c) => c.color === color);
    assert.equal(cs.length, 25);
    assert.equal(cs.filter((c) => c.value === '0').length, 1);
    for (const v of ['1', '5', '9', 'skip', 'reverse', 'draw2']) {
      assert.equal(cs.filter((c) => c.value === v).length, 2, `${color} ${v}`);
    }
  }
  assert.equal(deck.filter((c) => c.value === 'wild').length, 4);
  assert.equal(deck.filter((c) => c.value === 'wild4').length, 4);
  assert.equal(deck.reduce((a, c) => a + cardPoints(c), 0), 4 * (45 * 2 + 120) + 400);
});

test('deal: 7 cards each, never starts on Wild Draw Four, conserves cards', () => {
  for (let seed = 0; seed < 300; seed++) {
    const s = createGame({ numPlayers: 4 }, seed);
    s.players.forEach((p) => assert.ok(p.hand.length === 7 || p.hand.length === 9));
    assert.notEqual(s.log[0].card.value, 'wild4');
    assert.equal(totalCards(s), 108);
  }
});

test('same seed gives the same game', () => {
  const a = createGame({ numPlayers: 3 }, 42);
  const b = createGame({ numPlayers: 3 }, 42);
  assert.deepEqual(a.players.map((p) => p.hand.map((c) => c.id)), b.players.map((p) => p.hand.map((c) => c.id)));
});

test('playable cards match color or value; wild always', () => {
  const s = fixture({
    hands: [[card('a', 'red', '5'), card('b', 'blue', '7'), card('c', 'green', '3'), card('w', null, 'wild')], [card('x', 'red', '1')]],
    top: card('t', 'blue', '5'),
  });
  const ids = legalMoves(s, 0).filter((m) => m.type === 'play').map((m) => m.cardId);
  assert.deepEqual([...new Set(ids)].sort(), ['a', 'b', 'w']);
  assert.equal(legalMoves(s, 0).some((m) => m.type === 'draw'), false);
});

test('Wild Draw Four only legal without a card of the current color', () => {
  const hand = [card('w4', null, 'wild4'), card('r', 'red', '2'), card('g', 'green', '9')];
  const s = fixture({ hands: [hand, [card('x', 'red', '1')]], top: card('t', 'red', '5') });
  assert.equal(legalMoves(s, 0).some((m) => m.cardId === 'w4'), false);
  const s2 = fixture({ hands: [hand, [card('x', 'red', '1')]], top: card('t', 'blue', '5') });
  assert.equal(legalMoves(s2, 0).some((m) => m.cardId === 'w4'), true);
});

test('illegal moves throw', () => {
  const s = fixture({
    hands: [[card('a', 'red', '5'), card('g', 'green', '3')], [card('x', 'red', '1')]],
    top: card('t', 'blue', '5'),
  });
  assert.throws(() => applyMove(s, { type: 'play', playerId: 0, cardId: 'g' }));
  assert.throws(() => applyMove(s, { type: 'play', playerId: 1, cardId: 'x' }));
  assert.throws(() => applyMove(s, { type: 'draw', playerId: 0 }));
  assert.throws(() => applyMove(s, { type: 'pass', playerId: 0 }));
  assert.throws(() => applyMove(s, { type: 'bogus', playerId: 0 }));
  assert.throws(() => applyMove(s, null));
});

test('applyMove does not mutate the input state', () => {
  const s = fixture({
    hands: [[card('a', 'red', '5'), card('g', 'green', '3'), card('h', 'green', '4')], [card('x', 'red', '1')]],
    top: card('t', 'red', '9'),
  });
  const before = JSON.stringify(s);
  applyMove(s, { type: 'play', playerId: 0, cardId: 'a' });
  assert.equal(JSON.stringify(s), before);
});

test('skip, reverse and draw two', () => {
  const hands = () => [
    [card('s', 'red', 'skip'), card('r', 'red', 'reverse'), card('d', 'red', 'draw2'), card('z', 'red', '1')],
    [card('b1', 'blue', '1'), card('b2', 'blue', '2')],
    [card('c1', 'blue', '3'), card('c2', 'blue', '4')],
  ];
  let s = applyMove(fixture({ hands: hands(), top: card('t', 'red', '5') }), { type: 'play', playerId: 0, cardId: 's' });
  assert.equal(s.current, 2);
  s = applyMove(fixture({ hands: hands(), top: card('t', 'red', '5') }), { type: 'play', playerId: 0, cardId: 'r' });
  assert.equal(s.direction, -1);
  assert.equal(s.current, 2);
  s = applyMove(fixture({ hands: hands(), top: card('t', 'red', '5') }), { type: 'play', playerId: 0, cardId: 'd' });
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.current, 2);
});

test('reverse acts as skip with two players', () => {
  const s = fixture({
    hands: [[card('r', 'red', 'reverse'), card('z', 'red', '1'), card('y', 'red', '2')], [card('b', 'blue', '1')]],
    top: card('t', 'red', '5'),
  });
  const s2 = applyMove(s, { type: 'play', playerId: 0, cardId: 'r' });
  assert.equal(s2.current, 0);
});

test('wild draw four sets color and makes next player draw 4', () => {
  const s = fixture({
    hands: [[card('w', null, 'wild4'), card('z', 'red', '1'), card('y', 'red', '2')], [card('b', 'blue', '1')], [card('c', 'blue', '2')]],
    top: card('t', 'green', '5'),
  });
  const s2 = applyMove(s, { type: 'play', playerId: 0, cardId: 'w', chosenColor: 'red' });
  assert.equal(s2.currentColor, 'red');
  assert.equal(s2.players[1].hand.length, 5);
  assert.equal(s2.current, 2);
});

test('draw: playable drawn card may be played or passed; unplayable passes the turn', () => {
  const base = { hands: [[card('g', 'green', '3')], [card('x', 'red', '1')]], top: card('t', 'red', '5') };
  let s = fixture({ ...base, drawPile: [card('p', 'red', '8')] });
  s = applyMove(s, { type: 'draw', playerId: 0 });
  assert.equal(s.current, 0);
  assert.equal(s.drawnCardId, 'p');
  const moves = legalMoves(s, 0);
  assert.ok(moves.some((m) => m.type === 'pass'));
  assert.ok(moves.every((m) => m.type !== 'play' || m.cardId === 'p'));
  assert.equal(applyMove(s, { type: 'pass', playerId: 0 }).current, 1);

  let u = fixture({ ...base, drawPile: [card('q', 'blue', '8')] });
  u = applyMove(u, { type: 'draw', playerId: 0 });
  assert.equal(u.current, 1);
  assert.equal(u.drawnCardId, null);
});

test('empty draw pile reshuffles the discard pile, keeping the top card', () => {
  const s = fixture({ hands: [[card('g', 'green', '3')], [card('x', 'red', '1')]], top: card('t', 'red', '5'), drawPile: [] });
  s.discard = [card('d1', 'blue', '1'), card('d2', 'blue', '2'), card('t', 'red', '5')];
  const s2 = applyMove(s, { type: 'draw', playerId: 0 });
  assert.equal(topCard(s2).id, 't');
  assert.equal(s2.discard.length, 1);
  assert.equal(s2.drawPile.length + s2.players[0].hand.length, 3);
});

test('last card: missing the call costs 2 cards when the next player acts', () => {
  const s = fixture({
    hands: [[card('a', 'red', '1'), card('b', 'red', '2')], [card('x', 'red', '3'), card('y', 'red', '4')]],
    top: card('t', 'red', '5'),
  });
  const s1 = applyMove(s, { type: 'play', playerId: 0, cardId: 'a' });
  assert.equal(s1.lastWindow, 0);
  assert.ok(isLegal(s1, { type: 'callLast', playerId: 0 }));
  const s2 = applyMove(s1, { type: 'play', playerId: 1, cardId: 'x' });
  assert.equal(s2.players[0].hand.length, 3);
  assert.ok(s2.log.some((e) => e.type === 'lastPenalty'));
});

test('last card: calling before or after playing avoids the penalty', () => {
  const s = fixture({
    hands: [[card('a', 'red', '1'), card('b', 'red', '2')], [card('x', 'red', '3'), card('y', 'red', '4')]],
    top: card('t', 'red', '5'),
  });
  // before
  let a = applyMove(s, { type: 'callLast', playerId: 0 });
  a = applyMove(a, { type: 'play', playerId: 0, cardId: 'a' });
  assert.equal(a.lastWindow, null);
  a = applyMove(a, { type: 'play', playerId: 1, cardId: 'x' });
  assert.equal(a.players[0].hand.length, 1);
  // after (while it is already the next player's turn)
  let b = applyMove(s, { type: 'play', playerId: 0, cardId: 'a' });
  b = applyMove(b, { type: 'callLast', playerId: 0 });
  b = applyMove(b, { type: 'play', playerId: 1, cardId: 'x' });
  assert.equal(b.players[0].hand.length, 1);
});

test('round end scoring and game end', () => {
  const s = fixture({
    hands: [[card('a', 'red', '1')], [card('x', 'red', '3'), card('w', null, 'wild'), card('s', 'blue', 'skip')]],
    top: card('t', 'red', '5'),
  });
  s.players[0].saidLast = true;
  const s2 = applyMove(s, { type: 'play', playerId: 0, cardId: 'a' });
  assert.equal(s2.phase, 'roundOver');
  assert.equal(s2.roundWinner, 0);
  assert.equal(s2.players[0].score, 73);
  assert.deepEqual(legalMoves(s2, 1), []);
  const s3 = startNextRound(s2);
  assert.equal(s3.round, s2.round + 1);
  assert.equal(s3.players[0].score, 73);
  assert.equal(totalCards(s3), 108);

  const g = fixture({ ...{ hands: [[card('a', 'red', '1')], [card('w', null, 'wild4'), card('v', null, 'wild4'), card('u', null, 'wild4'), card('q', null, 'wild4')]] }, top: card('t', 'red', '5') });
  g.players[0].saidLast = true;
  const g2 = applyMove(g, { type: 'play', playerId: 0, cardId: 'a' });
  assert.equal(g2.phase, 'gameOver');
  assert.equal(g2.gameWinner, 0);
});

test('winning on a Draw Two still makes the next player draw for scoring', () => {
  const s = fixture({ hands: [[card('d', 'red', 'draw2')], [card('x', 'red', '3')]], top: card('t', 'red', '5') });
  s.players[0].saidLast = true;
  const s2 = applyMove(s, { type: 'play', playerId: 0, cardId: 'd' });
  assert.equal(s2.players[1].hand.length, 3);
  assert.equal(s2.phase, 'roundOver');
});

test('stacking Draw Two (option)', () => {
  const s = fixture({
    opts: { stackDrawTwo: true },
    hands: [[card('d', 'red', 'draw2'), card('z', 'red', '1')], [card('e', 'blue', 'draw2'), card('y', 'blue', '9')], [card('f', 'green', '1'), card('g', 'green', '2')]],
    top: card('t', 'red', '5'),
  });
  let s2 = applyMove(s, { type: 'play', playerId: 0, cardId: 'd' });
  assert.equal(s2.pendingDraw, 2);
  assert.equal(s2.current, 1);
  assert.deepEqual(legalMoves(s2, 1).filter((m) => m.type === 'play').map((m) => m.cardId), ['e']);
  s2 = applyMove(s2, { type: 'play', playerId: 1, cardId: 'e' });
  assert.equal(s2.pendingDraw, 4);
  assert.deepEqual(legalMoves(s2, 2).map((m) => m.type), ['draw']);
  s2 = applyMove(s2, { type: 'draw', playerId: 2 });
  assert.equal(s2.players[2].hand.length, 6);
  assert.equal(s2.current, 0);
  assert.equal(s2.pendingDraw, 0);
});

test('challenging a Wild Draw Four (option)', () => {
  const mk = (hand0) => fixture({
    opts: { challengeWild4: true },
    hands: [hand0, [card('x', 'blue', '3'), card('y', 'blue', '4')], [card('f', 'green', '1')]],
    top: card('t', 'red', '5'),
  });
  // Bluff (holds red) -> challenge succeeds: offender draws 4, victim plays.
  let s = applyMove(mk([card('w', null, 'wild4'), card('r', 'red', '1'), card('q', 'blue', '1')]), { type: 'play', playerId: 0, cardId: 'w', chosenColor: 'blue' });
  assert.equal(s.phase, 'challenge');
  assert.deepEqual(legalMoves(s, 1).map((m) => m.type).sort(), ['challenge', 'draw']);
  const caught = applyMove(s, { type: 'challenge', playerId: 1 });
  assert.equal(caught.players[0].hand.length, 6);
  assert.equal(caught.players[1].hand.length, 2);
  assert.equal(caught.current, 1);
  // Honest -> challenger draws 6 and is skipped.
  s = applyMove(mk([card('w', null, 'wild4'), card('g', 'green', '1'), card('q', 'blue', '1')]), { type: 'play', playerId: 0, cardId: 'w', chosenColor: 'blue' });
  const lost = applyMove(s, { type: 'challenge', playerId: 1 });
  assert.equal(lost.players[1].hand.length, 8);
  assert.equal(lost.current, 2);
  // Accept -> draw 4 and skipped.
  const accepted = applyMove(s, { type: 'draw', playerId: 1 });
  assert.equal(accepted.players[1].hand.length, 6);
  assert.equal(accepted.current, 2);
});

test('starting Wild lets the first player choose a color', () => {
  let found = 0;
  for (let seed = 0; seed < 400 && found < 3; seed++) {
    const s = createGame({ numPlayers: 3 }, seed);
    if (s.log[0].card.value !== 'wild') continue;
    found++;
    assert.equal(s.phase, 'chooseColor');
    const moves = legalMoves(s, s.current);
    assert.deepEqual(moves.map((m) => m.color), COLORS);
    const s2 = applyMove(s, moves[2]);
    assert.equal(s2.currentColor, COLORS[2]);
    assert.equal(s2.phase, 'play');
  }
  assert.ok(found > 0);
});

function playRandomGame(seed, opts) {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  let s = createGame(opts, seed);
  let moves = 0;
  while (s.phase !== 'gameOver') {
    if (s.phase === 'roundOver') {
      s = startNextRound(s);
      continue;
    }
    // Some other player may call "last card" out of turn.
    if (s.lastWindow !== null && s.lastWindow !== s.current && rand() < 0.5) {
      s = applyMove(s, { type: 'callLast', playerId: s.lastWindow });
    }
    const legal = legalMoves(s, s.current);
    if (legal.length === 0) throw new Error(`Stuck state, seed ${seed}`);
    s = applyMove(s, legal[Math.floor(rand() * legal.length)]);
    if (totalCards(s) !== 108) throw new Error(`Card count drift, seed ${seed}`);
    if (++moves > 50000) throw new Error(`Game did not finish, seed ${seed}`);
  }
  return s;
}

test('1,000 seeded random games finish with no illegal moves or stuck states', () => {
  const optionSets = [
    { numPlayers: 2 },
    { numPlayers: 3, stackDrawTwo: true },
    { numPlayers: 4, challengeWild4: true },
    { numPlayers: 4, stackDrawTwo: true, challengeWild4: true },
  ];
  for (let seed = 1; seed <= 1000; seed++) {
    const s = playRandomGame(seed, optionSets[seed % optionSets.length]);
    assert.ok(s.players[s.gameWinner].score >= 200);
  }
});
