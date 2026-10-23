// Bot decision functions. No DOM access.
//
// chooseMove(state, playerId, difficulty, rand) returns one of
// legalMoves(state, playerId). `rand` defaults to Math.random; simulations
// pass a seeded function to stay reproducible.

import { COLORS, legalMoves, isWild, isAction, isNumber, nextIndex } from './engine.js';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export function chooseMove(state, playerId, difficulty = 'medium', rand = Math.random) {
  const legal = legalMoves(state, playerId);
  if (legal.length === 0) throw new Error(`Player ${playerId} has no legal moves`);
  if (legal.length === 1) return legal[0];
  const ctx = makeContext(state, playerId, difficulty, rand);

  const call = legal.find((m) => m.type === 'callLast');
  if (call) {
    if (difficulty !== 'easy' || rand() < 0.75) return call;
  }
  const rest = legal.filter((m) => m.type !== 'callLast');
  if (rest.length === 1) return rest[0];

  if (state.phase === 'chooseColor') {
    return rest.find((m) => m.color === pickColor(ctx, ctx.hand)) ?? rest[0];
  }
  if (state.phase === 'challenge') return decideChallenge(ctx, rest);

  if (difficulty === 'easy') return easyMove(ctx, rest);
  return smartMove(ctx, rest);
}

function makeContext(state, playerId, difficulty, rand) {
  const hand = state.players[playerId].hand;
  const ctx = {
    state, playerId, difficulty, rand, hand,
    hard: difficulty === 'hard',
    n: state.players.length,
    next: nextIndex(state, playerId),
    opponents: state.players.filter((p) => p.id !== playerId),
  };
  if (ctx.hard) ctx.intel = readLog(state, hand);
  return ctx;
}

// ---------------------------------------------------------------- easy

function easyMove(ctx, moves) {
  // Pick a card uniformly (not a move: wilds have one move per color).
  const ids = [...new Set(moves.filter((m) => m.type === 'play').map((m) => m.cardId))];
  const options = ids.length + (moves.some((m) => m.type !== 'play') ? 1 : 0);
  const k = Math.floor(ctx.rand() * options);
  if (k >= ids.length) return moves.find((m) => m.type !== 'play');
  const forCard = moves.filter((m) => m.cardId === ids[k]);
  return forCard[Math.floor(ctx.rand() * forCard.length)];
}

// ---------------------------------------------------------------- medium / hard

function smartMove(ctx, moves) {
  const plays = moves.filter((m) => m.type === 'play');
  if (plays.length === 0) return moves[0]; // draw
  const byId = new Map(ctx.hand.map((c) => [c.id, c]));

  let best = null;
  let bestScore = -Infinity;
  for (const m of plays) {
    const card = byId.get(m.cardId);
    const rest = ctx.hand.filter((c) => c.id !== card.id);
    if (isWild(card) && m.chosenColor !== pickColor(ctx, rest)) continue;
    // Never bluff a Wild Draw Four.
    if (card.value === 'wild4' && ctx.hand.some((c) => c.color === ctx.state.currentColor)) continue;
    const sc = scorePlay(ctx, card, m.chosenColor ?? card.color, rest);
    if (sc > bestScore) {
      bestScore = sc;
      best = m;
    }
  }
  if (!best) best = plays[0];

  // Holding back the drawn card is only worth it to keep a lone wild.
  const pass = moves.find((m) => m.type === 'pass');
  if (pass && bestScore < 0 && ctx.hand.length > 2) return pass;
  return best;
}

function scorePlay(ctx, card, color, rest) {
  const { state, hard } = ctx;
  const minOpp = Math.min(...ctx.opponents.map((p) => p.hand.length));
  const threat = minOpp <= 2;
  let sc;

  if (isNumber(card)) sc = 50 + Number(card.value) * 0.5;
  else if (isAction(card)) sc = threat ? 80 : 40;
  else sc = card.value === 'wild' ? -10 : -20; // save wilds for when nothing else works

  return hard ? sc + hardBonus(ctx, card, color, rest, threat) : sc;
}

// Tunable weights for the hard bot (see sim.js).
export const HARD_WEIGHTS = {
  depth: 3,
  attack: 120,
  attackAt: 3,
  lacks: 16,
  recent: 10,
  wildLast: 30,
  scarcity: 1.5,
  shed: 1.5,
  extraTurn: 40,
};

function hardBonus(ctx, card, color, rest, threat) {
  const W = HARD_WEIGHTS;
  const { state } = ctx;
  // Keep options open: prefer ending on a color we still hold plenty of.
  let sc = rest.filter((c) => c.color === color).length * W.depth;
  const nextCount = state.players[ctx.next].hand.length;
  const mover = moverAfter(ctx, card);
  const moverCount = state.players[mover].hand.length;

  // Attack a next player who is close to going out.
  if (nextCount <= W.attackAt) {
    if (card.value === 'draw2') sc += W.attack;
    else if (card.value === 'wild4') sc += W.attack - 10;
    else if (mover !== ctx.next) sc += W.attack - 30; // skip, or reverse
  }
  if (card.value === 'reverse' && ctx.n > 2) sc += (nextCount - moverCount) * 4;

  if (mover === ctx.playerId) {
    // We keep the turn (two players): worth a lot per card we can chain.
    sc += chainLength(ctx, card, color, rest, 4) * W.extraTurn;
  } else {
    // Steer whoever moves next into colors they've shown they lack, away
    // from colors they've just been playing.
    const intel = ctx.intel.players[mover];
    const weight = moverCount <= 3 ? 3 : 1;
    if (intel.lacks.has(color)) sc += W.lacks * weight;
    if (intel.recent.includes(color)) sc -= W.recent * weight;
  }

  // A lone wild is a guaranteed final play: keep it for last.
  if (isWild(card) && rest.length === 1 && !isWild(rest[0])) sc -= W.wildLast;
  if (!isWild(card) && rest.length === 1 && isWild(rest[0])) sc += W.wildLast;

  // Card counting: a color with few unseen cards left is one opponents
  // struggle to follow.
  const unseen = ctx.intel.unseen[color] ?? 0;
  sc += (25 - unseen) * W.scarcity;

  // Shed points when someone is about to win.
  if (threat) sc += cardValueForShedding(card) * W.shed;
  return sc;
}

// How many more cards we can play in a row after `card` while keeping the
// turn. Going out at the end of the chain counts double.
function chainLength(ctx, card, color, rest, budget) {
  if (budget === 0 || moverAfter(ctx, card) !== ctx.playerId) return 0;
  let best = 0;
  for (const c of rest) {
    if (!isWild(c) && c.color !== color && c.value !== card.value) continue;
    const left = rest.filter((o) => o !== c);
    if (left.length === 0) return 2;
    const next = 1 + chainLength(ctx, c, c.color ?? pickColor(ctx, left), left, budget - 1);
    if (next > best) best = next;
  }
  return best;
}

// The player who takes the next turn if `card` is played.
function moverAfter(ctx, card) {
  const { state, playerId, n } = ctx;
  const stack = state.opts.stackDrawTwo && card.value === 'draw2';
  const challenge = state.opts.challengeWild4 && card.value === 'wild4';
  if (card.value === 'skip' || (card.value === 'draw2' && !stack) || (card.value === 'wild4' && !challenge)) {
    return nextIndex(state, playerId, 2);
  }
  if (card.value === 'reverse') {
    return n === 2 ? playerId : nextIndex({ ...state, direction: -state.direction }, playerId);
  }
  return ctx.next;
}

function cardValueForShedding(card) {
  if (isNumber(card)) return Number(card.value);
  return isWild(card) ? 50 : 20;
}

export function pickColor(ctx, cards) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const c of cards) if (c.color) counts[c.color] += 1;
  let best = COLORS[0];
  let bestScore = -Infinity;
  for (const color of COLORS) {
    let sc = counts[color] * 10;
    if (ctx.hard) {
      const intel = ctx.intel.players[ctx.next];
      if (intel.lacks.has(color)) sc += 6;
      if (intel.recent.includes(color)) sc -= 4;
      sc -= (ctx.intel.unseen[color] ?? 0) * 0.2;
    }
    if (ctx.difficulty === 'easy') sc = ctx.rand();
    if (sc > bestScore) {
      bestScore = sc;
      best = color;
    }
  }
  return best;
}

function decideChallenge(ctx, moves) {
  const challenge = moves.find((m) => m.type === 'challenge');
  const accept = moves.find((m) => m.type === 'draw');
  const { from, prevColor } = ctx.state.challenge;
  const k = ctx.state.players[from].hand.length;
  if (ctx.difficulty === 'easy') return ctx.rand() < 0.3 ? challenge : accept;
  if (!ctx.hard) return k >= 5 ? challenge : accept;
  if (ctx.intel.players[from].lacks.has(prevColor)) return accept;
  // Chance the offender held a card of the previous color, from unseen cards.
  const { unseen } = ctx.intel;
  const total = Object.values(unseen).reduce((a, b) => a + b, 0) || 1;
  const f = (unseen[prevColor] ?? 0) / total;
  const pHeld = 1 - (1 - f) ** k;
  return pHeld > 0.6 ? challenge : accept;
}

// ---------------------------------------------------------------- hard: reading the table

// Scans this round's event log for what each player has revealed, and counts
// the unseen cards of each color (not in our hand or the discard pile).
export function readLog(state, hand) {
  const players = state.players.map(() => ({ lacks: new Set(), recent: [] }));
  for (const ev of state.log) {
    const who = players[ev.player];
    if (!who) continue;
    switch (ev.type) {
      case 'draw':
      case 'pass':
        who.lacks.add(ev.color); // couldn't (or wouldn't) follow this color
        break;
      case 'forcedDraw':
      case 'lastPenalty':
        who.lacks.clear();
        break;
      case 'play':
        if (ev.card.color) {
          who.recent = [ev.card.color, ...who.recent].slice(0, 2);
          who.lacks.delete(ev.card.color);
        }
        break;
    }
  }
  const unseen = Object.fromEntries(COLORS.map((c) => [c, 25]));
  for (const c of state.discard) if (c.color) unseen[c.color] -= 1;
  for (const c of hand) if (c.color) unseen[c.color] -= 1;
  return { players, unseen };
}
