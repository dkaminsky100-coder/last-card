// Lifetime stats for the human player. Pure functions; main.js persists them.

export const EMPTY_STATS = Object.freeze({
  games: 0,       // completed games
  wins: 0,
  rounds: 0,
  roundsWon: 0,
  points: 0,      // total points scored
  bestRound: 0,   // most points won in a single round
  streak: 0,      // current run of game wins
  bestStreak: 0,
});

export function normalizeStats(raw) {
  const out = { ...EMPTY_STATS };
  for (const key of Object.keys(EMPTY_STATS)) {
    const v = raw?.[key];
    if (Number.isFinite(v) && v >= 0) out[key] = Math.floor(v);
  }
  return out;
}

// Call once per finished round (state.phase is 'roundOver' or 'gameOver').
export function recordRound(stats, state, humanId) {
  const s = { ...stats };
  s.rounds += 1;
  if (state.roundWinner === humanId) {
    s.roundsWon += 1;
    s.points += state.roundPoints;
    s.bestRound = Math.max(s.bestRound, state.roundPoints);
  }
  if (state.phase === 'gameOver') {
    s.games += 1;
    if (state.gameWinner === humanId) {
      s.wins += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.streak = 0;
    }
  }
  return s;
}

const rate = (n, d) => (d > 0 ? n / d : null);

export function summarize(stats) {
  return {
    ...stats,
    winRate: rate(stats.wins, stats.games),
    roundRate: rate(stats.roundsWon, stats.rounds),
  };
}
