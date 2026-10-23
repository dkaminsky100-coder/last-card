# Last Card

A single-player shedding card game in the browser: you against 1–3 computer
opponents. Plain HTML, CSS and ES modules. No build step, no dependencies.

**▶ Play it now: https://dkaminsky100-coder.github.io/last-card/**

## Play and install

**Online (easiest):** open the hosted game at
https://dkaminsky100-coder.github.io/last-card/ and play right away. To install
it as an app, use the install icon in Chrome or Edge's address bar, or
Share → Add to Home Screen on iOS. Once installed, it has its own window and
Start-menu/home-screen icon and works offline.

**From a clone:** double-click **`play.bat`** (Windows), or run **`./play.sh`**
(macOS/Linux). Either one starts a local server on port 8000 and opens your
browser. You can install the app from there too. They need Python 3 or
Node.js. Set `PORT` to use another port.

**Manually:** ES modules need a real HTTP server (opening `index.html` from
disk won't work):

```sh
npx serve .                  # then open the URL it prints
# or
python -m http.server 8000   # then open http://localhost:8000
```

### Publishing your copy

`.github/workflows/pages.yml` runs the tests and deploys the game to GitHub
Pages on every push to `main` or `master`. For a fork, enable it once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Development

Tests and the bot simulation need Node 18 or newer:

```sh
node --test        # engine + bot tests (includes 1,000 seeded random games)
node sim.js        # bots play each other: 500 games per matchup, prints win rates
node sim.js 2000   # more games for tighter numbers
```

## How to play

On your turn, play a card that matches the discard pile's **color** or
**number/symbol**, or play a Wild. If you can't play, draw one card. If the
drawn card fits, you may play it right away or keep it and pass. Be the first
to empty your hand.

| Control | Mouse / touch | Keyboard |
| --- | --- | --- |
| Play a card | Tap a lifted card | <kbd>←</kbd> <kbd>→</kbd> to choose, <kbd>Enter</kbd> to play |
| Draw | Tap the draw pile | <kbd>D</kbd> |
| Call "Last card!" | Tap the button | <kbd>L</kbd> |
| Keep a drawn card and pass | Tap the button | <kbd>P</kbd> |
| Sound on/off | Speaker button | <kbd>M</kbd> |

Each color also has a shape (red ▲, yellow ●, green ■, blue ◆), shown in the
card corners, the color picker and the current-color indicator.

## Features

- **1–3 bots, each with its own difficulty.** Set them on the start screen, e.g.
  one easy and one hard.
- **Light and dark themes.** Choose Auto (follows your OS), Light or Dark on
  the start screen.
- **Sound effects,** synthesized with Web Audio, so there are no audio files.
  Toggle with the speaker button or <kbd>M</kbd>.
- **Stats across games:** win rate, rounds won, best round, total points and
  win streaks. Open **Your stats** from the menu. Your record also shows on
  the game-over screen.
- **Installable and offline.** A service worker caches the game, so once
  loaded it works without a connection. In Chrome or Edge, use the install
  icon in the address bar. On iOS Safari, use Share → Add to Home Screen.
  Installing needs `https://` or `localhost`.
- **Resume:** the game in progress is saved, so a reload picks up where you
  left off.

## Rules

**Deck (108 cards).** Each of red, yellow, green and blue has one 0, two each
of 1–9, and two each of Skip, Reverse and Draw Two. Plus 4 Wild and 4 Wild
Draw Four.

**Deal.** 7 cards each, then the top card of the deck starts the discard pile.
- A Wild Draw Four can't start the pile. It goes back in and the deck is reshuffled.
- A Wild lets the first player pick the color.
- A Skip, Reverse or Draw Two acts as if the dealer had just played it.

**Playing.** A card is playable if its color matches the current color or its
value matches the top card. Wilds are always playable. A Wild Draw Four is
legal only if you hold no card of the current color.

**Action cards.**
- **Skip:** the next player loses their turn.
- **Reverse:** flips the direction of play. With 2 players it acts as a Skip.
- **Draw Two:** the next player draws 2 and loses their turn.
- **Wild:** choose the new color.
- **Wild Draw Four:** choose the color. The next player draws 4 and loses their turn.

**Drawing.** If you have no playable card you draw one. If it's playable you
may play it; otherwise your turn passes. When the draw pile runs out, the
discard pile (except its top card) is shuffled into a new draw pile.

**"Last card!"** When you're down to one card you must call it before the next
player acts: press the button while holding 2 cards (before you play) or
right after you play down to 1. Miss it and you draw 2 as a penalty. Bots call
too, though easy bots sometimes forget.

**Scoring.** The round ends when someone plays their last card. If that card
is a Draw Two or Wild Draw Four, the next player still draws. The winner
scores the cards left in everyone else's hands: number cards at face value,
Skip/Reverse/Draw Two 20, Wild and Wild Draw Four 50. First to **200** wins
the game.

**House rules** (off by default, set on the start screen):
- **Stack Draw Two:** answer a Draw Two with another Draw Two to pass the
  penalty along. The total grows until someone can't stack and draws the lot.
- **Challenge Wild Draw Four:** a Wild Draw Four may be played as a bluff even
  while holding the current color. The victim can challenge. If the player was
  bluffing, they draw 4 instead and the victim plays normally. If not, the
  challenger draws 6 and loses their turn.

## Bots

- **Easy:** plays a random legal card and forgets to call "Last card" 25% of
  the time.
- **Medium:** prefers number cards, saves Wilds for when nothing else works,
  dumps action cards when an opponent is close to going out, and picks the
  Wild color it holds most of.
- **Hard:** everything medium does, plus:
  - counts the cards played so far;
  - hits a next player holding 3 or fewer cards with Draw Two, Wild Draw Four or Skip;
  - reads the log to steer play into colors the next player has just drawn or
    passed on (so they're likely missing them), and away from colors they just played;
  - chains Skips and Draw Twos in two-player games to take extra turns;
  - keeps a lone Wild as its final card;
  - always calls "Last card".

Each bot's difficulty is chosen separately. Bot speed (slow / normal / fast / instant) controls the thinking delay
(normal is 600–1000 ms). Whatever the speed, you always get at least 1.6 s
to call "Last card" before a bot moves.

Typical `node sim.js` output (500 games per matchup, first to 200):

```
easy vs medium      easy 17%  medium 83%
medium vs hard      medium 40%  hard 60%
easy vs hard        easy 9%  hard 91%
3-way               easy 6%  medium 44%  hard 50%
```

Luck plays a big part in this game, so the gap between medium and hard is real
but modest, larger with fewer players.

## Project layout

```
index.html          page shell and dialogs
styles.css          table, cards, layout, responsive and reduced-motion styles
src/engine.js       pure game logic: createGame, legalMoves, applyMove, startNextRound
src/bots.js         chooseMove(state, playerId, difficulty, rand?)
src/ui.js           rendering, input, keyboard, FLIP card animations
src/main.js         turn loop, settings, localStorage persistence
src/rng.js          seeded mulberry32 RNG
src/sound.js        synthesized sound effects (Web Audio)
src/stats.js        lifetime stats (pure functions)
sw.js               service worker (network-first, cache fallback)
manifest.webmanifest, icons/   install metadata and app icons
sim.js              headless bot-vs-bot simulation
test/               node:test suites
```

The engine is pure. `applyMove(state, move)` validates the move against
`legalMoves`, throws on illegal moves, and returns a new state. Moves are
`play {cardId, chosenColor?}`, `draw`, `pass` and `callLast`, plus
`chooseColor` (Wild start card) and `challenge` (house rule), each tagged
with `playerId`. The RNG state lives inside the game state, so a seed
reproduces a game exactly. Settings and the game in progress, including the
running score, are saved to `localStorage`, so a reload offers **Resume**.
Stats live under a separate key, so starting a new game never clears them.

The service worker is network-first: while online you always get the latest
files, and the cache is only used offline. If you add new source files, add
them to `SHELL` in `sw.js` and bump `CACHE` so they're available offline.
