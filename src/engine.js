// Pure game logic for "Last Card". No DOM access.
//
// State is treated as immutable: applyMove() clones the state, mutates the
// clone and returns it. Cards are plain frozen objects shared between states.

import { nextRandom, shuffleInPlace } from './rng.js';

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const ACTIONS = ['skip', 'reverse', 'draw2'];
export const WILDS = ['wild', 'wild4'];
export const HAND_SIZE = 7;

export const DEFAULT_OPTS = {
  numPlayers: 2,
  names: null,
  targetScore: 200,
  stackDrawTwo: false,
  challengeWild4: false,
};

// ---------------------------------------------------------------- cards

export function buildDeck() {
  const deck = [];
  let n = 0;
  const add = (color, value) => deck.push(Object.freeze({ id: `c${n++}`, color, value }));
  for (const color of COLORS) {
    add(color, '0');
    for (let k = 0; k < 2; k++) {
      for (let v = 1; v <= 9; v++) add(color, String(v));
      for (const a of ACTIONS) add(color, a);
    }
  }
  for (let k = 0; k < 4; k++) add(null, 'wild');
  for (let k = 0; k < 4; k++) add(null, 'wild4');
  return deck;
}

export const isWild = (card) => card.color === null;
export const isAction = (card) => ACTIONS.includes(card.value);
export const isNumber = (card) => /^\d$/.test(card.value);

export function cardPoints(card) {
  if (isNumber(card)) return Number(card.value);
  if (isWild(card)) return 50;
  return 20;
}

const VALUE_NAMES = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };

export function cardLabel(card) {
  const v = VALUE_NAMES[card.value] ?? card.value;
  if (isWild(card)) return v;
  return `${card.color[0].toUpperCase()}${card.color.slice(1)} ${v}`;
}

// ---------------------------------------------------------------- state helpers

function cloneState(s) {
  return {
    ...s,
    opts: s.opts,
    players: s.players.map((p) => ({ ...p, hand: p.hand.slice() })),
    drawPile: s.drawPile.slice(),
    discard: s.discard.slice(),
    log: s.log.slice(),
    challenge: s.challenge ? { ...s.challenge } : null,
  };
}

function rand(s) {
  const r = nextRandom(s.rng);
  s.rng = r.state;
  return r.value;
}

function shuffle(s, arr) {
  return shuffleInPlace(arr, () => rand(s));
}

function log(s, event) {
  s.log.push({ seq: s.seq++, round: s.round, ...event });
}

export const topCard = (s) => s.discard[s.discard.length - 1];
export const playerCount = (s) => s.players.length;

export function nextIndex(s, from = s.current, steps = 1) {
  const n = s.players.length;
  return (((from + s.direction * steps) % n) + n) % n;
}

// Moves cards from the draw pile into a hand, reshuffling the discard pile
// (minus its top card) when the draw pile runs out. Returns the drawn cards.
function drawCards(s, pid, count) {
  const p = s.players[pid];
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (s.drawPile.length === 0) {
      if (s.discard.length <= 1) break;
      const top = s.discard.pop();
      s.drawPile = shuffle(s, s.discard);
      s.discard = [top];
      log(s, { type: 'reshuffle', count: s.drawPile.length });
    }
    drawn.push(s.drawPile.pop());
  }
  p.hand.push(...drawn);
  if (drawn.length > 0) {
    p.saidLast = false;
    if (s.lastWindow === pid) s.lastWindow = null;
  }
  return drawn;
}

export function isPlayable(s, card, hand) {
  if (s.pendingDraw > 0) return card.value === 'draw2';
  if (card.value === 'wild') return true;
  if (card.value === 'wild4') {
    // With challenges enabled a Wild Draw Four may be played as a bluff.
    if (s.opts.challengeWild4) return true;
    return !hand.some((c) => c.color === s.currentColor);
  }
  return card.color === s.currentColor || card.value === topCard(s).value;
}

// ---------------------------------------------------------------- setup

export function createGame(opts = {}, seed = 1) {
  const o = { ...DEFAULT_OPTS, ...opts };
  if (!Number.isInteger(o.numPlayers) || o.numPlayers < 2 || o.numPlayers > 4) {
    throw new Error('numPlayers must be 2-4');
  }
  const names = o.names ?? Array.from({ length: o.numPlayers }, (_, i) => (i === 0 ? 'You' : `Bot ${i}`));
  const s = {
    opts: Object.freeze({ ...o, names: Object.freeze(names.slice()) }),
    seed: seed >>> 0,
    rng: seed >>> 0,
    seq: 0,
    round: 0,
    dealer: o.numPlayers - 1,
    players: names.map((name, id) => ({ id, name, hand: [], score: 0, saidLast: false })),
    drawPile: [],
    discard: [],
    log: [],
    current: 0,
    direction: 1,
    currentColor: null,
    phase: 'play',
    pendingDraw: 0,
    drawnCardId: null,
    lastWindow: null,
    challenge: null,
    roundWinner: null,
    roundPoints: 0,
    gameWinner: null,
  };
  dealRound(s);
  return s;
}

export function startNextRound(state) {
  if (state.phase !== 'roundOver') throw new Error('Round is not over');
  const s = cloneState(state);
  s.dealer = (s.dealer + 1) % s.players.length;
  dealRound(s);
  return s;
}

function dealRound(s) {
  s.round += 1;
  s.log = [];
  s.direction = 1;
  s.pendingDraw = 0;
  s.drawnCardId = null;
  s.lastWindow = null;
  s.challenge = null;
  s.roundWinner = null;
  s.roundPoints = 0;
  s.phase = 'play';
  for (const p of s.players) {
    p.hand = [];
    p.saidLast = false;
  }
  s.drawPile = shuffle(s, buildDeck());
  s.discard = [];
  const n = s.players.length;
  for (let k = 0; k < HAND_SIZE; k++) {
    for (let i = 1; i <= n; i++) s.players[(s.dealer + i) % n].hand.push(s.drawPile.pop());
  }
  // A Wild Draw Four can't start the pile: put it back and reshuffle.
  while (s.drawPile[s.drawPile.length - 1].value === 'wild4') shuffle(s, s.drawPile);
  const start = s.drawPile.pop();
  s.discard.push(start);
  log(s, { type: 'roundStart', dealer: s.dealer, card: start });

  // The start card behaves as if the dealer had just played it.
  const starter = (s.dealer + 1) % n;
  s.current = starter;
  s.currentColor = start.color;
  switch (start.value) {
    case 'wild':
      s.phase = 'chooseColor';
      break;
    case 'skip':
      log(s, { type: 'skipped', player: starter });
      s.current = nextIndex(s, starter);
      break;
    case 'reverse':
      s.direction = -1;
      s.current = n === 2 ? nextIndex(s, starter) : s.dealer;
      if (n === 2) log(s, { type: 'skipped', player: starter });
      break;
    case 'draw2':
      drawCards(s, starter, 2);
      log(s, { type: 'forcedDraw', player: starter, count: 2 });
      s.current = nextIndex(s, starter);
      break;
  }
}

// ---------------------------------------------------------------- moves

export function legalMoves(s, playerId) {
  if (s.phase === 'roundOver' || s.phase === 'gameOver') return [];
  const p = s.players[playerId];
  if (!p) return [];
  const moves = [];
  const call = { type: 'callLast', playerId };
  if (s.lastWindow === playerId) moves.push(call);
  if (playerId !== s.current) return moves;

  if (s.phase === 'chooseColor') {
    return moves.concat(COLORS.map((color) => ({ type: 'chooseColor', playerId, color })));
  }
  if (s.phase === 'challenge') {
    return moves.concat([{ type: 'challenge', playerId }, { type: 'draw', playerId }]);
  }

  // Calling early (holding 2) only makes sense when about to play down to 1.
  const preCall = p.hand.length === 2 && !p.saidLast;
  const pushPlay = (card) => {
    if (isWild(card)) {
      for (const color of COLORS) moves.push({ type: 'play', playerId, cardId: card.id, chosenColor: color });
    } else {
      moves.push({ type: 'play', playerId, cardId: card.id });
    }
  };

  if (s.drawnCardId) {
    if (preCall) moves.push(call);
    pushPlay(p.hand.find((c) => c.id === s.drawnCardId));
    moves.push({ type: 'pass', playerId });
    return moves;
  }
  const playable = p.hand.filter((c) => isPlayable(s, c, p.hand));
  if (preCall && playable.length > 0) moves.push(call);
  playable.forEach(pushPlay);
  if (playable.length === 0 || s.pendingDraw > 0) moves.push({ type: 'draw', playerId });
  return moves;
}

const sameMove = (a, b) =>
  a.type === b.type &&
  a.playerId === b.playerId &&
  (a.cardId ?? null) === (b.cardId ?? null) &&
  (a.chosenColor ?? null) === (b.chosenColor ?? null) &&
  (a.color ?? null) === (b.color ?? null);

export function isLegal(s, move) {
  return legalMoves(s, move.playerId).some((m) => sameMove(m, move));
}

export function applyMove(state, move) {
  if (!move || typeof move !== 'object') throw new Error('Move must be an object');
  if (!isLegal(state, move)) {
    throw new Error(`Illegal move: ${JSON.stringify(move)} (phase ${state.phase}, current ${state.current})`);
  }
  const s = cloneState(state);
  const pid = move.playerId;

  // Anyone else acting closes the "last card" window: the player who forgot
  // to call draws two.
  if (s.lastWindow !== null && s.lastWindow !== pid) {
    const offender = s.lastWindow;
    s.lastWindow = null;
    drawCards(s, offender, 2);
    log(s, { type: 'lastPenalty', player: offender });
  }

  switch (move.type) {
    case 'callLast':
      s.players[pid].saidLast = true;
      if (s.lastWindow === pid) s.lastWindow = null;
      log(s, { type: 'callLast', player: pid });
      break;
    case 'chooseColor':
      s.currentColor = move.color;
      s.phase = 'play';
      log(s, { type: 'chooseColor', player: pid, color: move.color });
      break;
    case 'play':
      playCard(s, pid, move);
      break;
    case 'draw':
      doDraw(s, pid);
      break;
    case 'pass':
      s.drawnCardId = null;
      log(s, { type: 'pass', player: pid, color: s.currentColor, value: topCard(s).value });
      s.current = nextIndex(s);
      break;
    case 'challenge':
      resolveChallenge(s, pid, true);
      break;
  }
  return s;
}

function playCard(s, pid, move) {
  const p = s.players[pid];
  const idx = p.hand.findIndex((c) => c.id === move.cardId);
  const card = p.hand[idx];
  const prevColor = s.currentColor;
  const bluff = card.value === 'wild4' && p.hand.some((c) => c.color === prevColor);
  p.hand.splice(idx, 1);
  s.discard.push(card);
  s.currentColor = isWild(card) ? move.chosenColor : card.color;
  s.drawnCardId = null;
  log(s, { type: 'play', player: pid, card, color: s.currentColor });

  if (p.hand.length === 1 && !p.saidLast) s.lastWindow = pid;
  const n = s.players.length;
  const next = nextIndex(s, pid);

  if (p.hand.length === 0) {
    // Draw cards still land on the next player so they count for scoring.
    if (card.value === 'draw2') forceDraw(s, next, s.pendingDraw + 2);
    else if (card.value === 'wild4') forceDraw(s, next, 4);
    s.pendingDraw = 0;
    endRound(s, pid);
    return;
  }

  switch (card.value) {
    case 'skip':
      log(s, { type: 'skipped', player: next });
      s.current = nextIndex(s, pid, 2);
      break;
    case 'reverse':
      if (n === 2) {
        log(s, { type: 'skipped', player: next });
        s.current = pid;
      } else {
        s.direction = -s.direction;
        s.current = nextIndex(s, pid);
      }
      break;
    case 'draw2':
      if (s.opts.stackDrawTwo) {
        s.pendingDraw += 2;
        s.current = next;
      } else {
        forceDraw(s, next, 2);
        s.current = nextIndex(s, pid, 2);
      }
      break;
    case 'wild4':
      if (s.opts.challengeWild4) {
        s.phase = 'challenge';
        s.challenge = { from: pid, victim: next, bluff, prevColor };
        s.current = next;
      } else {
        forceDraw(s, next, 4);
        s.current = nextIndex(s, pid, 2);
      }
      break;
    default:
      s.current = next;
  }
}

function forceDraw(s, pid, count) {
  const got = drawCards(s, pid, count).length;
  log(s, { type: 'forcedDraw', player: pid, count: got });
}

function doDraw(s, pid) {
  if (s.phase === 'challenge') return resolveChallenge(s, pid, false);
  if (s.pendingDraw > 0) {
    const count = s.pendingDraw;
    s.pendingDraw = 0;
    forceDraw(s, pid, count);
    s.current = nextIndex(s);
    return;
  }
  const color = s.currentColor;
  const value = topCard(s).value;
  const [card] = drawCards(s, pid, 1);
  log(s, { type: 'draw', player: pid, color, value, got: card ? 1 : 0 });
  if (card && isPlayable(s, card, s.players[pid].hand)) {
    s.drawnCardId = card.id;
  } else {
    s.current = nextIndex(s);
  }
}

function resolveChallenge(s, pid, challenged) {
  const { from, bluff } = s.challenge;
  s.challenge = null;
  s.phase = 'play';
  if (!challenged) {
    forceDraw(s, pid, 4);
    s.current = nextIndex(s, pid);
    return;
  }
  log(s, { type: 'challenge', player: pid, target: from, success: bluff });
  if (bluff) {
    forceDraw(s, from, 4);
    s.current = pid; // the victim plays normally
  } else {
    forceDraw(s, pid, 6);
    s.current = nextIndex(s, pid);
  }
}

function endRound(s, winner) {
  const points = s.players.reduce(
    (sum, p) => sum + (p.id === winner ? 0 : p.hand.reduce((a, c) => a + cardPoints(c), 0)),
    0,
  );
  s.players[winner].score += points;
  s.roundWinner = winner;
  s.roundPoints = points;
  s.lastWindow = null;
  s.phase = s.players[winner].score >= s.opts.targetScore ? 'gameOver' : 'roundOver';
  if (s.phase === 'gameOver') s.gameWinner = winner;
  log(s, { type: 'roundEnd', player: winner, points });
}

// ---------------------------------------------------------------- queries

// The player who must act next, or null when the round is over. During a
// "last card" window the offender may still call, but the game waits on the
// current player.
export function actingPlayer(s) {
  if (s.phase === 'roundOver' || s.phase === 'gameOver') return null;
  return s.current;
}

export function describeEvent(ev, names) {
  const who = (i) => names[i];
  switch (ev.type) {
    case 'roundStart':
      return `Round ${ev.round} starts with ${cardLabel(ev.card)}`;
    case 'play':
      return isWild(ev.card)
        ? `${who(ev.player)} played ${cardLabel(ev.card)} (${ev.color})`
        : `${who(ev.player)} played ${cardLabel(ev.card)}`;
    case 'draw':
      return `${who(ev.player)} drew a card`;
    case 'forcedDraw':
      return `${who(ev.player)} drew ${ev.count}`;
    case 'pass':
      return `${who(ev.player)} passed`;
    case 'skipped':
      return `${who(ev.player)} was skipped`;
    case 'callLast':
      return `${who(ev.player)} called "Last card!"`;
    case 'lastPenalty':
      return `${who(ev.player)} forgot to call "Last card" and drew 2`;
    case 'chooseColor':
      return `${who(ev.player)} chose ${ev.color}`;
    case 'challenge':
      return ev.success
        ? `${who(ev.player)} challenged ${who(ev.target)}: bluff caught!`
        : `${who(ev.player)} challenged ${who(ev.target)} and lost`;
    case 'reshuffle':
      return 'Discard pile reshuffled into the draw pile';
    case 'roundEnd':
      return `${who(ev.player)} won the round (+${ev.points})`;
    default:
      return ev.type;
  }
}
