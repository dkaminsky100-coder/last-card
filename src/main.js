// Wires the engine, bots and UI together and runs the turn loop.

import { createGame, applyMove, startNextRound, isWild, isAction } from './engine.js';
import { chooseMove, DIFFICULTIES } from './bots.js';
import { randomSeed } from './rng.js';
import { createUI } from './ui.js';
import { playSound, setSoundEnabled, unlock } from './sound.js';
import { EMPTY_STATS, normalizeStats, recordRound, summarize } from './stats.js';

const HUMAN = 0;
const STORE_KEY = 'lastcard.v1';
const STATS_KEY = 'lastcard.stats.v1';
const SPEEDS = { slow: [1100, 1600], normal: [600, 1000], fast: [250, 450], instant: [0, 0] };
const THEMES = ['auto', 'light', 'dark'];
const LAST_CALL_GRACE = 1600; // ms a human gets to call "Last card" before a bot moves
const DEFAULT_SETTINGS = {
  bots: 2,
  difficulties: ['medium', 'medium', 'medium'],
  speed: 'normal',
  theme: 'auto',
  sound: true,
  stackDrawTwo: false,
  challengeWild4: false,
};

// ---------------------------------------------------------------- storage

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): play on without persistence.
  }
}

const save = () => write(STORE_KEY, { settings, game: state && { state, difficulties } });

function sanitizeSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS, ...s };
  if (![1, 2, 3].includes(out.bots)) out.bots = DEFAULT_SETTINGS.bots;
  // Older saves had one difficulty for every bot.
  const legacy = DIFFICULTIES.includes(s.difficulty) ? s.difficulty : null;
  const list = Array.isArray(s.difficulties) ? s.difficulties : [];
  out.difficulties = [0, 1, 2].map((i) => (DIFFICULTIES.includes(list[i]) ? list[i] : legacy ?? 'medium'));
  delete out.difficulty;
  if (!(out.speed in SPEEDS)) out.speed = DEFAULT_SETTINGS.speed;
  if (!THEMES.includes(out.theme)) out.theme = DEFAULT_SETTINGS.theme;
  out.sound = out.sound !== false;
  out.stackDrawTwo = !!out.stackDrawTwo;
  out.challengeWild4 = !!out.challengeWild4;
  return out;
}

// Returns [state, difficulties-by-player-id] for a usable saved game, or null.
function loadGame(g) {
  const s = g?.state;
  if (!(s && Array.isArray(s.players) && s.players.length >= 2 && Array.isArray(s.discard) && s.discard.length
    && Array.isArray(s.log) && s.opts)) return null;
  const diffs = Array.isArray(g.difficulties)
    ? g.difficulties
    : s.players.map((p) => (p.id === HUMAN ? null : g.difficulty));
  const ok = s.players.every((p) => p.id === HUMAN || DIFFICULTIES.includes(diffs[p.id]));
  return ok ? [s, diffs] : null;
}

// ---------------------------------------------------------------- state

const saved = read(STORE_KEY) ?? {};
let settings = sanitizeSettings(saved.settings);
const savedGame = loadGame(saved.game);
let state = savedGame?.[0] ?? null;
let difficulties = savedGame?.[1] ?? [];
let stats = normalizeStats(read(STATS_KEY));
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
  toggleSound,
  setTheme,
  showStats: () => ui.openStats(summarize(stats)),
  resetStats,
});

function view() {
  const live = state.phase !== 'roundOver' && state.phase !== 'gameOver';
  return {
    humanId: HUMAN,
    difficulties,
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
  const prevCurrent = state.current;
  try {
    state = applyMove(state, move);
  } catch (err) {
    console.warn(err.message);
    return;
  }
  update({ yourTurn: prevCurrent !== HUMAN && state.current === HUMAN });
}

function update({ animate = true, yourTurn = false } = {}) {
  const events = state.log.filter((e) => e.seq > lastSeq);
  if (events.length) lastSeq = events[events.length - 1].seq;
  if (events.some((e) => e.type === 'roundEnd')) {
    stats = recordRound(stats, state, HUMAN);
    write(STATS_KEY, stats);
  }
  showBubbles(events);
  soundsFor(events, yourTurn);
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

// One sound per batch of events, picking the most notable thing that happened.
function soundsFor(events, yourTurn) {
  const has = (type, pred = () => true) => events.some((e) => e.type === type && pred(e));
  const end = events.find((e) => e.type === 'roundEnd');
  if (end) playSound(end.player === HUMAN ? 'win' : 'lose');
  else if (has('lastPenalty') || has('challenge', (e) => !e.success)) playSound('penalty');
  else if (has('callLast')) playSound('last');
  else if (has('play', (e) => isWild(e.card))) playSound('wild');
  else if (has('play', (e) => isAction(e.card))) playSound('action');
  else if (has('play')) playSound('play');
  else if (has('draw') || has('forcedDraw')) playSound('draw');
  else if (yourTurn) playSound('turn');
}

// ---------------------------------------------------------------- turn loop

function schedule(events = []) {
  clearTimeout(timer);
  if (paused) return;
  if (state.phase === 'roundOver' || state.phase === 'gameOver') {
    timer = setTimeout(() => ui.showRoundEnd(state, HUMAN, summarize(stats)), 900);
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
  act(chooseMove(state, state.current, difficulties[state.current]));
}

// ---------------------------------------------------------------- game flow

function newGame(next) {
  settings = sanitizeSettings({ ...settings, ...next });
  applyTheme();
  difficulties = [null, ...settings.difficulties.slice(0, settings.bots)];
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
  if (state.phase === 'roundOver' || state.phase === 'gameOver') ui.showRoundEnd(state, HUMAN, summarize(stats));
}

function menu() {
  paused = true;
  clearTimeout(timer);
  if (state) ui.render(state, view(), { animate: false });
  ui.openStart(settings, !!state && state.phase !== 'gameOver');
}

function resetStats() {
  stats = { ...EMPTY_STATS };
  write(STATS_KEY, stats);
  ui.openStats(summarize(stats));
}

// ---------------------------------------------------------------- sound and theme

function toggleSound() {
  settings = { ...settings, sound: !settings.sound };
  setSoundEnabled(settings.sound);
  ui.setSound(settings.sound);
  if (settings.sound) {
    unlock();
    playSound('turn');
  }
  save();
}

const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

function applyTheme() {
  const theme = settings.theme === 'auto' ? (prefersLight.matches ? 'light' : 'dark') : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4ead8' : '#140f22');
}

function setTheme(theme) {
  settings = sanitizeSettings({ ...settings, theme });
  applyTheme();
  save();
}

prefersLight.addEventListener('change', () => settings.theme === 'auto' && applyTheme());

// ---------------------------------------------------------------- boot

setSoundEnabled(settings.sound);
ui.setSound(settings.sound);
applyTheme();
// Audio may only start after a user gesture.
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, unlock, { once: true, capture: true });

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.info('Offline mode unavailable:', err.message));
}

if (state) ui.addLog(state.log, state, HUMAN);
menu();
