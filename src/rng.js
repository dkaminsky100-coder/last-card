// Seeded RNG (mulberry32). The engine stores the 32-bit state inside the game
// state so applyMove stays a pure function and games are reproducible.

export function nextRandom(state) {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

// Stateful convenience wrapper for callers outside the engine (bots, sims).
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    const r = nextRandom(s);
    s = r.state;
    return r.value;
  };
}

// Fisher-Yates, in place, using a () => [0,1) function.
export function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomSeed() {
  return (Math.random() * 2 ** 32) >>> 0;
}
