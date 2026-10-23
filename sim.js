// Headless bot-vs-bot simulation: `node sim.js [games]`
// Plays full games (to the target score) and prints game and round win rates.

import { createGame, applyMove, startNextRound } from './src/engine.js';
import { chooseMove } from './src/bots.js';
import { mulberry32 } from './src/rng.js';
import { fileURLToPath } from 'node:url';

export function playGame(difficulties, seed, opts = {}) {
  const rand = mulberry32(seed * 2654435761);
  let s = createGame({ numPlayers: difficulties.length, ...opts }, seed);
  const roundWins = difficulties.map(() => 0);
  let moves = 0;
  while (s.phase !== 'gameOver') {
    if (s.phase === 'roundOver') {
      roundWins[s.roundWinner]++;
      s = startNextRound(s);
      continue;
    }
    s = applyMove(s, chooseMove(s, s.current, difficulties[s.current], rand));
    if (++moves > 100000) throw new Error(`Game ${seed} did not finish`);
  }
  roundWins[s.roundWinner]++;
  return { winner: s.gameWinner, roundWins };
}

// Plays `games` games, rotating seats so no difficulty keeps a seat advantage.
export function runMatch(lineup, games, opts = {}, seedBase = 1) {
  const wins = lineup.map(() => 0);
  const rounds = lineup.map(() => 0);
  for (let g = 0; g < games; g++) {
    const shift = g % lineup.length;
    const seats = lineup.map((_, i) => (i + shift) % lineup.length); // seat -> lineup index
    const r = playGame(seats.map((i) => lineup[i]), seedBase + g, opts);
    wins[seats[r.winner]]++;
    r.roundWins.forEach((w, seat) => (rounds[seats[seat]] += w));
  }
  const totalRounds = rounds.reduce((a, b) => a + b, 0);
  return lineup.map((name, i) => ({ name, games: wins[i] / games, rounds: rounds[i] / totalRounds }));
}

const pct = (x) => `${(x * 100).toFixed(1).padStart(5)}%`;

function main() {
  const games = Number(process.argv[2]) || 500;
  const matchups = [
    ['easy', 'medium'],
    ['medium', 'hard'],
    ['easy', 'hard'],
    ['easy', 'medium', 'hard'],
  ];
  console.log(`Last Card bot simulation: ${games} games per matchup, first to 200 points\n`);
  for (const lineup of matchups) {
    const t = Date.now();
    const res = runMatch(lineup, games);
    console.log(`${lineup.join(' vs ')}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    for (const r of res) console.log(`  ${r.name.padEnd(7)} games ${pct(r.games)}   rounds ${pct(r.rounds)}`);
    console.log('');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
