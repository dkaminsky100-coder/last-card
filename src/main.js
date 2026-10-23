// Wires the engine, bots and UI together and runs the turn loop.

import { createGame, applyMove, startNextRound } from './engine.js';
import { chooseMove, DIFFICULTIES } from './bots.js';
import { randomSeed } from './rng.js';
import { createUI } from './ui.js';

const HUMAN = 0;
const STORE_KEY = 'lastcard.v1';
const SPEEDS = { slow: [1100, 1600], normal: [600, 1000], fast: [250, 450], instant: [0, 0] };
const LAST_CALL_GRACE = 1600; // ms a human gets to call "Last card" before a bot moves
const DEFAULT_SETTINGS = { bots: 2, difficulty: 'medium', speed: 'normal', stackDrawTwo: false, challengeWild4: false };

// ---------------------------------------------------------------- storage

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings, game: state && { state, difficulty } }));
  } catch {
    // Storage unavailable (private mode, quota): play on without persistence.
  }
}

function sanitizeSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS, ...s };
  if (![1, 2, 3].includes(out.bots)) out.bots = DEFAULT_SETTINGS.bots;
  if (!DIFFICULTIES.includes(out.difficulty)) out.difficulty = DEFAULT_SETTINGS.difficulty;
  if (!(out.speed in SPEEDS)) out.speed = DEFAULT_SETTINGS.speed;
  out.stackDrawTwo = !!out.stackDrawTwo;
  out.challengeWild4 = !!out.challengeWild4;
  return out;
}

function validGame(g) {
  const s = g?.state;
  return !!(s && Array.isArray(s.players) && s.players.length >= 2 && Array.isArray(s.discard) && s.discard.length
    && Array.isArray(s.log) && s.opts && DIFFICULTIES.includes(g.difficulty));
}

// ---------------------------------------------------------------- state

const saved = load();
let settings = sanitizeSettings(saved.settings);
let state = validGame(saved.game) ? saved.game.state : null;
let difficulty = state ? saved.game.difficulty : settings.difficulty;
let lastSeq = state ? state.seq - 1 : -1;
let timer = null;
let paused = true;
const bubbles = new Map();

const ui = createUI({
  play: (cardId, chosenColor) => human({ type: 'play', cardId, ...(chosenColor ? { chosenColor } : {}) }),
  chooseColor: (color) => human({ type: 'chooseColor', color }),
  draw: () => human({ type: 'draw' }),
  pass: () => human({ type: 'pass' }),
  callLast: () => human({ type: 'callLast' }),
  challenge: (yes) => human({ type: yes ? 'challenge' : 'draw' }),
  nextRound,
  newGame,
  resume,
  menu,
});

function view() {
  const live = state.phase !== 'roundOver' && state.phase !== 'gameOver';
  return {
    humanId: HUMAN,
    difficulty,
    thinking: live && state.current !== HUMAN,
    inputEnabled: live && !paused && state.current === HUMAN,
    paused,
    bubbles,
  };
}

function human(partial) {
  if (paused) return;
  act({ ...partial, playerId: HUMAN });
}

function act(move) {
  try {
    state = applyMove(state, move);
  } catch (err) {
    console.warn(err.message);
    return;
  }
  update();
}

function update({ animate = true } = {}) {
  const events = state.log.filter((e) => e.seq > lastSeq);
  if (events.length) lastSeq = events[events.length - 1].seq;
  showBubbles(events);
  ui.addLog(events, state, HUMAN);
  ui.render(state, view(), { events, animate });
  save();
  schedule(events);
}

function showBubbles(events) {
  for (const ev of events) {
    let bubble = null;
    if (ev.type === 'callLast') bubble = { text: 'Last card!' };
    else if (ev.type === 'lastPenalty') bubble = { text: 'Forgot! +2', bad: true };
    else if (ev.type === 'challenge') bubble = { text: ev.success ? 'Caught you!' : 'Oops, +6', bad: !ev.success };
    if (!bubble) continue;
    bubbles.set(ev.player, bubble);
    setTimeout(() => {
      if (bubbles.get(ev.player) !== bubble) return;
      bubbles.delete(ev.player);
      if (state) ui.render(state, view(), { animate: false });
    }, 1800);
  }
}

// ---------------------------------------------------------------- turn loop

function schedule(events = []) {
  clearTimeout(timer);
  if (paused) return;
  if (state.phase === 'roundOver' || state.phase === 'gameOver') {
    timer = setTimeout(() => ui.showRoundEnd(state, HUMAN), 900);
    return;
  }
  if (state.current === HUMAN) return;

  const [lo, hi] = SPEEDS[settings.speed];
  let delay = lo + Math.random() * (hi - lo);
  // A bot that just called "Last card" plays right after.
  if (events.at(-1)?.type === 'callLast' && events.at(-1).player === state.current) delay = Math.min(delay, 450);
  if (state.lastWindow === HUMAN) delay = Math.max(delay, LAST_CALL_GRACE);
  timer = setTimeout(botTurn, delay);
}

function botTurn() {
  if (paused || state.current === HUMAN) return;
  act(chooseMove(state, state.current, difficulty));
}

// ---------------------------------------------------------------- game flow

function newGame(next) {
  settings = sanitizeSettings(next);
  difficulty = settings.difficulty;
  const names = ['You', ...Array.from({ length: settings.bots }, (_, i) => `Bot ${i + 1}`)];
  state = createGame({
    numPlayers: settings.bots + 1,
    names,
    stackDrawTwo: settings.stackDrawTwo,
    challengeWild4: settings.challengeWild4,
  }, randomSeed());
  lastSeq = -1;
  bubbles.clear();
  ui.clearLog();
  paused = false;
  update();
}

function nextRound() {
  if (state.phase === 'gameOver') {
    newGame(settings);
    return;
  }
  state = startNextRound(state);
  update();
}

function resume() {
  if (!state) return menu();
  paused = false;
  ui.render(state, view(), { animate: false });
  schedule();
  if (state.phase === 'roundOver' || state.phase === 'gameOver') ui.showRoundEnd(state, HUMAN);
}

function menu() {
  paused = true;
  clearTimeout(timer);
  if (state) ui.render(state, view(), { animate: false });
  ui.openStart(settings, !!state && state.phase !== 'gameOver');
}

// ---------------------------------------------------------------- boot

if (state) {
  ui.addLog(state.log, state, HUMAN);
}
menu();
