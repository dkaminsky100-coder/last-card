import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_STATS, normalizeStats, recordRound, summarize } from '../src/stats.js';

const round = (over) => ({ phase: 'roundOver', roundWinner: 1, roundPoints: 30, gameWinner: null, ...over });

test('records round wins, points and best round', () => {
  let s = recordRound(EMPTY_STATS, round({ roundWinner: 0, roundPoints: 45 }), 0);
  s = recordRound(s, round({ roundWinner: 0, roundPoints: 12 }), 0);
  s = recordRound(s, round({ roundWinner: 2 }), 0);
  assert.deepEqual({ rounds: s.rounds, roundsWon: s.roundsWon, points: s.points, bestRound: s.bestRound, games: s.games },
    { rounds: 3, roundsWon: 2, points: 57, bestRound: 45, games: 0 });
});

test('records game results and win streaks', () => {
  const win = round({ phase: 'gameOver', roundWinner: 0, gameWinner: 0, roundPoints: 80 });
  const loss = round({ phase: 'gameOver', roundWinner: 1, gameWinner: 1 });
  let s = EMPTY_STATS;
  for (const r of [win, win, loss, win]) s = recordRound(s, r, 0);
  assert.equal(s.games, 4);
  assert.equal(s.wins, 3);
  assert.equal(s.streak, 1);
  assert.equal(s.bestStreak, 2);
  assert.equal(summarize(s).winRate, 0.75);
});

test('does not mutate its input', () => {
  const before = { ...EMPTY_STATS };
  recordRound(before, round({ roundWinner: 0 }), 0);
  assert.deepEqual(before, EMPTY_STATS);
});

test('normalizes junk from storage', () => {
  assert.deepEqual(normalizeStats(null), EMPTY_STATS);
  const s = normalizeStats({ games: 3, wins: -1, rounds: 'x', bestRound: 12.7, extra: 5 });
  assert.equal(s.games, 3);
  assert.equal(s.wins, 0);
  assert.equal(s.rounds, 0);
  assert.equal(s.bestRound, 12);
  assert.equal('extra' in s, false);
  assert.equal(summarize(EMPTY_STATS).winRate, null);
});
