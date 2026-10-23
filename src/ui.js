// Rendering, input and animation. Reads game state; never mutates it.
// User intent goes back to main.js through the `handlers` callbacks.

import { COLORS, legalMoves, isWild, cardLabel, describeEvent, topCard } from './engine.js';

const $ = (sel, root = document) => root.querySelector(sel);

const COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
const SHAPE_NAMES = { red: 'triangle', yellow: 'circle', green: 'square', blue: 'diamond' };
const SYMBOLS = {
  red: '<path d="M12 2.5 22.8 21H1.2Z"/>',
  yellow: '<circle cx="12" cy="12" r="10.2"/>',
  green: '<rect x="2.2" y="2.2" width="19.6" height="19.6" rx="2.6"/>',
  blue: '<path d="M12 .8 23.2 12 12 23.2.8 12Z"/>',
};
const SEAT_LAYOUT = { 2: ['top'], 3: ['left', 'right'], 4: ['left', 'top', 'right'] };

const sym = (color) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SYMBOLS[color]}</svg>`;

const ICONS = {
  skip: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34" fill="none" stroke="white" stroke-width="13"/><path d="M27 73 73 27" stroke="white" stroke-width="13" stroke-linecap="round"/></svg>',
  reverse: '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="white" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M22 36h52M60 20l16 16-16 16"/><path d="M78 64H26M40 48 24 64l16 16"/></g></svg>',
  wheel: `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(18 50 50)" stroke="white" stroke-width="4" stroke-linejoin="round">
    <path d="M50 50V9a41 41 0 0 1 41 41Z" fill="var(--yellow)"/>
    <path d="M50 50h41a41 41 0 0 1-41 41Z" fill="var(--green)"/>
    <path d="M50 50v41A41 41 0 0 1 9 50Z" fill="var(--blue)"/>
    <path d="M50 50H9a41 41 0 0 1 41-41Z" fill="var(--red)"/></g>
    <circle cx="50" cy="50" r="11" fill="var(--ink)" stroke="white" stroke-width="4"/></svg>`,
  direction: '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"><path d="M50 6a44 44 0 0 1 41 28"/><path d="M50 94A44 44 0 0 1 9 66"/></g><path d="M93 40 89 30l-8 6Z M7 60l4 10 8-6Z" fill="white"/></svg>',
};

function faceHTML(card) {
  switch (card.value) {
    case 'skip': return ICONS.skip;
    case 'reverse': return ICONS.reverse;
    case 'draw2': return '<span class="plus">+2</span>';
    case 'wild': return ICONS.wheel;
    case 'wild4': return `${ICONS.wheel}<span class="plus">+4</span>`;
    default: return card.value;
  }
}

function cornerHTML(card) {
  const label = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' }[card.value] ?? card.value;
  return `<span>${label}</span>${card.color ? sym(card.color) : ''}`;
}

export function cardHTML(card, { tag = 'div', cls = '', attrs = '' } = {}) {
  const colorCls = card.color ? `c-${card.color}` : 'wild';
  const under = card.value === '6' || card.value === '9' ? ' under-mark' : '';
  return `<${tag} class="card ${colorCls} ${cls}" ${attrs}>
    ${card.color ? `<svg class="watermark" viewBox="0 0 24 24" aria-hidden="true">${SYMBOLS[card.color]}</svg>` : ''}
    <span class="corner tl" aria-hidden="true">${cornerHTML(card)}</span>
    <span class="face${under}" aria-hidden="true">${faceHTML(card)}</span>
    <span class="corner br" aria-hidden="true">${cornerHTML(card)}</span>
  </${tag}>`;
}

const describeCard = (card) => (card.color ? `${cardLabel(card)} (${SHAPE_NAMES[card.color]})` : cardLabel(card));

// Small deterministic tilt per card so the discard pile looks tossed.
const tilt = (id) => ((parseInt(id.slice(1), 10) * 37) % 17) - 8;

export function createUI(handlers) {
  const els = {
    app: $('#app'),
    seats: $('#seats'),
    scoreboard: $('#scoreboard'),
    direction: $('#direction'),
    drawPile: $('#draw-pile'),
    drawCount: $('#draw-count'),
    discard: $('#discard'),
    colorIndicator: $('#color-indicator'),
    meInfo: $('#me-info'),
    hand: $('#hand'),
    prompt: $('#prompt'),
    passBtn: $('#pass-btn'),
    lastBtn: $('#last-btn'),
    log: $('#log'),
    logToggle: $('#log-toggle'),
    live: $('#live'),
    colorDialog: $('#color-dialog'),
    colorOptions: $('#color-options'),
    challengeDialog: $('#challenge-dialog'),
    roundDialog: $('#round-dialog'),
    startDialog: $('#start-dialog'),
    startForm: $('#start-form'),
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = null; // { state, view }
  let colorCallback = null;
  let focusIndex = 0;
  let logCount = 0;

  els.drawPile.querySelector('.pile-stack').classList.add('back');
  els.drawPile.querySelector('.pile-stack').innerHTML = '<span class="back-word">LAST<br>CARD</span>';
  els.direction.innerHTML = ICONS.direction;

  // ------------------------------------------------------------ input

  const humanMoves = () => (current ? legalMoves(current.state, current.view.humanId) : []);
  // "Last card" can be called out of turn, during the window after playing.
  const canDo = (type) => (type === 'callLast' || current?.view.inputEnabled) && !current?.view.paused
    && humanMoves().some((m) => m.type === type);

  function tryPlay(cardId) {
    if (!current?.view.inputEnabled) return;
    const moves = humanMoves().filter((m) => m.type === 'play' && m.cardId === cardId);
    if (moves.length === 0) {
      flashPrompt("That card doesn't match. Play a highlighted card or draw.");
      return;
    }
    if (moves[0].chosenColor) {
      openColorPicker((color) => handlers.play(cardId, color), true);
    } else {
      handlers.play(cardId);
    }
  }

  els.hand.addEventListener('click', (e) => {
    const el = e.target.closest('[data-card]');
    if (el) tryPlay(el.dataset.card);
  });
  els.hand.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-card]');
    if (el) focusIndex = [...els.hand.children].indexOf(el);
  });
  els.drawPile.addEventListener('click', () => canDo('draw') && handlers.draw());
  els.passBtn.addEventListener('click', () => canDo('pass') && handlers.pass());
  els.lastBtn.addEventListener('click', () => canDo('callLast') && handlers.callLast());
  els.logToggle.addEventListener('click', () => {
    const open = els.app.classList.toggle('log-open');
    els.logToggle.setAttribute('aria-expanded', String(open));
  });
  $('#menu-btn').addEventListener('click', () => handlers.menu());

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowright') {
      const cards = [...els.hand.querySelectorAll('[data-card]')];
      if (cards.length === 0) return;
      e.preventDefault();
      const inHand = els.hand.contains(document.activeElement);
      const step = key === 'arrowleft' ? -1 : 1;
      focusIndex = inHand ? (focusIndex + step + cards.length) % cards.length : Math.max(0, cards.findIndex((c) => c.classList.contains('playable')));
      setRovingFocus(cards, true);
    } else if (key === 'd') {
      if (canDo('draw')) handlers.draw();
    } else if (key === 'l') {
      if (canDo('callLast')) handlers.callLast();
    } else if (key === 'p') {
      if (canDo('pass')) handlers.pass();
    } else if (key === 'escape') {
      els.app.classList.remove('log-open');
    }
  });

  function setRovingFocus(cards, focus) {
    focusIndex = Math.min(focusIndex, cards.length - 1);
    cards.forEach((c, i) => (c.tabIndex = i === focusIndex ? 0 : -1));
    if (focus && cards[focusIndex]) {
      cards[focusIndex].focus({ preventScroll: true });
      cards[focusIndex].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  // ------------------------------------------------------------ color picker

  els.colorOptions.innerHTML = COLORS.map((c) => `
    <button class="color-choice c-${c}" type="button" data-color="${c}">
      ${sym(c)}<span>${COLOR_NAMES[c]}</span><small>${SHAPE_NAMES[c]}</small>
    </button>`).join('');
  els.colorOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn || !colorCallback) return;
    const cb = colorCallback;
    colorCallback = null;
    els.colorDialog.close();
    cb(btn.dataset.color);
  });
  els.colorOptions.addEventListener('keydown', (e) => {
    const btns = [...els.colorOptions.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
    if (i < 0 || delta === undefined) return;
    e.preventDefault();
    btns[(i + delta + 4) % 4].focus();
  });
  els.colorDialog.querySelector('[data-close]').addEventListener('click', () => els.colorDialog.close());
  els.colorDialog.addEventListener('cancel', (e) => {
    if (!els.colorDialog.dataset.cancellable) e.preventDefault();
  });
  els.colorDialog.addEventListener('close', () => { colorCallback = null; });

  function openColorPicker(callback, cancellable) {
    colorCallback = callback;
    if (cancellable) els.colorDialog.dataset.cancellable = '1';
    else delete els.colorDialog.dataset.cancellable;
    els.colorDialog.querySelector('[data-close]').hidden = !cancellable;
    if (!els.colorDialog.open) els.colorDialog.showModal();
    els.colorOptions.querySelector('button').focus();
  }

  // ------------------------------------------------------------ challenge

  $('#challenge-yes').addEventListener('click', () => { els.challengeDialog.close(); handlers.challenge(true); });
  $('#challenge-no').addEventListener('click', () => { els.challengeDialog.close(); handlers.challenge(false); });
  els.challengeDialog.addEventListener('cancel', (e) => e.preventDefault());

  // ------------------------------------------------------------ round / game end

  $('#round-next').addEventListener('click', () => {
    els.roundDialog.close();
    handlers.nextRound();
  });
  els.roundDialog.addEventListener('cancel', (e) => e.preventDefault());

  function showRoundEnd(state, humanId) {
    const w = state.players[state.roundWinner];
    const over = state.phase === 'gameOver';
    const you = w.id === humanId;
    $('#round-title').textContent = over
      ? (you ? 'You win the game!' : `${w.name} wins the game`)
      : (you ? 'You won the round!' : `${w.name} takes the round`);
    $('#round-text').textContent = `+${state.roundPoints} points from the cards left in hand.${over ? '' : ` First to ${state.opts.targetScore} wins.`}`;
    const rows = state.players
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((p) => `<tr class="${p.id === w.id ? 'winner' : ''}">
        <td>${p.name}<div class="score-bar"><i style="width:${Math.min(100, (p.score / state.opts.targetScore) * 100)}%"></i></div></td>
        <td class="num">${p.hand.length} left</td>
        <td class="num">${p.score}</td></tr>`).join('');
    $('#round-scores').innerHTML = `<thead><tr><th>Player</th><th class="num">Hand</th><th class="num">Score</th></tr></thead><tbody>${rows}</tbody>`;
    $('#round-next').textContent = over ? 'Play again' : 'Next round';
    if (!els.roundDialog.open) els.roundDialog.showModal();
    $('#round-next').focus();
  }

  // ------------------------------------------------------------ start screen

  let resumeAvailable = false;
  els.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(els.startForm);
    els.startDialog.close();
    handlers.newGame({
      bots: Number(f.get('bots')),
      difficulty: f.get('difficulty'),
      speed: f.get('speed'),
      stackDrawTwo: f.get('stackDrawTwo') === 'on',
      challengeWild4: f.get('challengeWild4') === 'on',
    });
  });
  $('#resume-btn').addEventListener('click', () => {
    els.startDialog.close();
    handlers.resume();
  });
  els.startDialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (resumeAvailable) {
      els.startDialog.close();
      handlers.resume();
    }
  });

  function openStart(settings, canResume) {
    resumeAvailable = canResume;
    const form = els.startForm;
    for (const name of ['bots', 'difficulty', 'speed']) {
      const input = form.querySelector(`input[name="${name}"][value="${settings[name]}"]`);
      if (input) input.checked = true;
    }
    form.elements.stackDrawTwo.checked = !!settings.stackDrawTwo;
    form.elements.challengeWild4.checked = !!settings.challengeWild4;
    $('#resume-btn').hidden = !canResume;
    for (const d of [els.colorDialog, els.challengeDialog, els.roundDialog]) if (d.open) d.close();
    if (!els.startDialog.open) els.startDialog.showModal();
    $('#deal-btn').focus();
  }

  // ------------------------------------------------------------ prompt / log

  let promptTimer = null;
  function flashPrompt(text) {
    els.prompt.innerHTML = `<strong>${text}</strong>`;
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => current && renderPrompt(current.state, current.view), 1800);
  }

  function renderPrompt(s, view) {
    const me = view.humanId;
    let text = '';
    if (s.phase === 'roundOver' || s.phase === 'gameOver') text = '';
    else if (s.current !== me) text = `${s.players[s.current].name} is thinking…`;
    else if (s.phase === 'chooseColor') text = 'You start: pick the opening color.';
    else if (s.phase === 'challenge') text = 'Challenge the Wild Draw Four, or draw 4.';
    else if (s.pendingDraw > 0) text = `Stack a Draw Two, or <strong>draw ${s.pendingDraw}</strong>.`;
    else if (s.drawnCardId) text = 'You drew a playable card: play it, or keep it and pass.';
    else if (!humanMoves().some((m) => m.type === 'play')) text = 'Nothing playable: <strong>draw a card</strong> (D).';
    else text = 'Your turn: play a lifted card.';
    if (s.lastWindow === me) text = '<strong>One card left! Call "Last card" before the next player moves.</strong>';
    els.prompt.innerHTML = text;
  }

  function addLog(events, state, humanId) {
    const names = state.players.map((p) => p.name);
    const fresh = [];
    for (const ev of events) {
      const li = document.createElement('li');
      const text = describeEvent(ev, names);
      if (ev.type === 'roundStart') li.className = 'sep';
      if (ev.player === humanId) li.classList.add('me-ev');
      const color = ev.type === 'play' ? ev.color : ev.type === 'chooseColor' ? ev.color : null;
      li.innerHTML = ev.type === 'roundStart'
        ? text
        : `<span class="dot" style="${color ? `--sw:var(--${color})` : ''}">${color ? sym(color) : ''}</span><span>${text}</span>`;
      els.log.prepend(li);
      fresh.push(text);
      logCount++;
    }
    while (logCount > 120) {
      els.log.lastElementChild.remove();
      logCount--;
    }
    if (fresh.length) els.live.textContent = fresh.slice(-3).join('. ');
  }

  function clearLog() {
    els.log.innerHTML = '';
    logCount = 0;
  }

  // ------------------------------------------------------------ animation

  function captureRects() {
    const rects = new Map();
    document.querySelectorAll('[data-flip]').forEach((el) => rects.set(el.dataset.flip, el.getBoundingClientRect()));
    rects.set('draw', els.drawPile.getBoundingClientRect());
    els.seats.querySelectorAll('[data-seat]').forEach((el) => rects.set(`seat-${el.dataset.seat}`, el.getBoundingClientRect()));
    return rects;
  }

  // FLIP: each keyed card animates from where it was (or from its source
  // anchor: the draw pile or a bot's seat) to where it is now.
  function flip(before) {
    if (reducedMotion.matches || !before) return;
    let dealt = 0;
    document.querySelectorAll('[data-flip]').forEach((el) => {
      const r1 = el.getBoundingClientRect();
      const own = before.get(el.dataset.flip);
      if (own) {
        animateFrom(el, own.left, own.top, own.width / r1.width || 1, r1);
        return;
      }
      const src = before.get(el.dataset.from);
      if (!src) return;
      if (el.dataset.from === 'draw') {
        // The hand scrolls (and so clips), so fly an unclipped stand-in.
        el.style.opacity = '0';
        launchGhost(src, r1, 45 * dealt++, true, () => { el.style.opacity = ''; });
      } else {
        // Out of a bot's seat: start half size at the seat's center.
        const scale = 0.5;
        animateFrom(el, src.left + src.width / 2 - (r1.width * scale) / 2, src.top + src.height / 2 - (r1.height * scale) / 2, scale, r1);
      }
    });
  }

  function animateFrom(el, left, top, scale, r1) {
    const dx = left - r1.left;
    const dy = top - r1.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transition = 'none';
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    el.style.zIndex = '20';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform var(--dur) var(--ease), translate var(--dur) var(--ease), filter var(--dur) var(--ease)';
      el.style.transform = '';
      el.addEventListener('transitionend', () => {
        el.style.transition = '';
        el.style.zIndex = '';
        el.style.transformOrigin = '';
      }, { once: true });
    }));
  }

  // Face-down cards flying from the draw pile to a bot seat.
  function ghostDraws(events, humanId, before) {
    if (reducedMotion.matches || !before) return;
    const from = before.get('draw');
    let k = 0;
    for (const ev of events) {
      if (ev.player === humanId) continue;
      const n = ev.type === 'draw' ? ev.got : ev.type === 'forcedDraw' ? ev.count : ev.type === 'lastPenalty' ? 2 : 0;
      const to = before.get(`seat-${ev.player}`);
      if (!to) continue;
      for (let i = 0; i < Math.min(n, 4); i++) launchGhost(from, to, 70 * k++);
    }
  }

  // A card back that flies from `from` to `to`. `land` keeps it full size and
  // opaque so a real card can take its place on arrival.
  function launchGhost(from, to, delay, land = false, onDone) {
    const g = document.createElement('div');
    g.className = 'ghost-card back';
    Object.assign(g.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    document.body.append(g);
    setTimeout(() => {
      requestAnimationFrame(() => {
        if (land) {
          g.style.transformOrigin = '0 0';
          g.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`;
        } else {
          const dx = to.left + to.width / 2 - (from.left + from.width / 2);
          const dy = to.top + to.height / 2 - (from.top + from.height / 2);
          g.style.transform = `translate(${dx}px, ${dy}px) scale(0.35) rotate(12deg)`;
          g.style.opacity = '0.2';
        }
      });
    }, delay);
    setTimeout(() => {
      g.remove();
      onDone?.();
    }, delay + 300);
  }

  // ------------------------------------------------------------ render

  function render(state, view, { events = [], animate = true } = {}) {
    const before = animate ? captureRects() : null;
    current = { state, view };
    const me = view.humanId;
    const n = state.players.length;
    const legal = humanMoves();
    const playableIds = new Set(view.inputEnabled ? legal.filter((m) => m.type === 'play').map((m) => m.cardId) : []);
    const lastPlay = [...events].reverse().find((e) => e.type === 'play');

    // Scoreboard
    els.scoreboard.innerHTML = state.players.map((p) => `<span class="score-pill">${p.name} <b>${p.score}</b></span>`).join('')
      + `<span class="score-pill target">to ${state.opts.targetScore}</span>`;

    // Seats
    const layout = SEAT_LAYOUT[n];
    els.seats.innerHTML = state.players.filter((p) => p.id !== me).map((p, i) => {
      const count = p.hand.length;
      const shown = Math.min(count, 10);
      const spread = Math.min(40, shown * 5);
      const backs = Array.from({ length: shown }, (_, k) => {
        const t = shown > 1 ? k / (shown - 1) - 0.5 : 0;
        return `<span class="back" style="--rot:${(t * spread).toFixed(1)}deg;--dy:${(Math.abs(t) * 6).toFixed(1)}px"></span>`;
      }).join('');
      const bubble = view.bubbles?.get(p.id);
      const active = state.current === p.id && state.phase !== 'roundOver' && state.phase !== 'gameOver';
      return `<section class="seat seat--${layout[i]} ${active ? 'active' : ''}" data-seat="${p.id}" aria-label="${p.name}, ${count} card${count === 1 ? '' : 's'}">
        ${bubble ? `<span class="bubble ${bubble.bad ? 'bad' : ''}">${bubble.text}</span>` : ''}
        <div class="seat-name">${p.name}<span class="seat-tag">${view.difficulty}</span>${active && view.thinking ? '<span class="thinking" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}</div>
        <div class="fan" aria-hidden="true">${backs}${count > shown ? `<span class="fan-more">+${count - shown}</span>` : ''}</div>
        <div class="seat-meta"><b>${count}</b> card${count === 1 ? '' : 's'} · ${p.score} pts</div>
      </section>`;
    }).join('');

    // Center
    els.direction.classList.toggle('ccw', state.direction === -1);
    els.drawCount.textContent = `${state.drawPile.length} left`;
    const canDraw = view.inputEnabled && legal.some((m) => m.type === 'draw') && state.phase === 'play';
    els.drawPile.classList.toggle('can-draw', canDraw);
    els.drawPile.setAttribute('aria-disabled', String(!canDraw));

    const pile = state.discard.slice(-3);
    els.discard.innerHTML = pile.map((c, i) => {
      const top = i === pile.length - 1;
      const from = top && lastPlay && lastPlay.card.id === c.id && lastPlay.player !== me ? `data-from="seat-${lastPlay.player}"` : '';
      return cardHTML(c, {
        cls: top ? 'top' : 'under',
        attrs: `${top ? `data-flip="${c.id}" ${from}` : ''} style="rotate:${top ? tilt(c.id) / 2 : tilt(c.id)}deg"`,
      });
    }).join('');
    const topC = topCard(state);
    els.discard.setAttribute('aria-label', `Discard pile: ${describeCard(topC)}`);

    const col = state.currentColor;
    els.colorIndicator.innerHTML = col
      ? `<span class="swatch" style="--sw:var(--${col})">${sym(col)}</span>${COLOR_NAMES[col]} ${SHAPE_NAMES[col]}${state.pendingDraw ? ` <span class="pending-draw">· +${state.pendingDraw} pending</span>` : ''}`
      : 'Color: to be chosen';

    // Me
    const mine = state.players[me];
    const myTurn = state.current === me && state.phase !== 'roundOver' && state.phase !== 'gameOver';
    els.meInfo.className = `me-info ${myTurn ? 'active' : ''}`;
    const myBubble = view.bubbles?.get(me);
    els.meInfo.innerHTML = `<span class="you-dot"></span>${mine.name} · ${mine.hand.length} card${mine.hand.length === 1 ? '' : 's'} · ${mine.score} pts`
      + (myBubble ? `<span class="bubble ${myBubble.bad ? 'bad' : ''}">${myBubble.text}</span>` : '');

    const hadFocus = els.hand.contains(document.activeElement);
    els.hand.innerHTML = mine.hand.map((c) => {
      const playable = playableIds.has(c.id);
      const cls = [playable ? 'playable' : (myTurn && view.inputEnabled ? 'dim' : ''), c.id === state.drawnCardId ? 'drawn' : ''].join(' ');
      return cardHTML(c, {
        tag: 'button',
        cls,
        attrs: `type="button" data-card="${c.id}" data-flip="${c.id}" data-from="draw" aria-label="${describeCard(c)}${playable ? '' : ', not playable'}"${playable ? '' : ' aria-disabled="true"'}`,
      });
    }).join('');
    fitHand();
    setRovingFocus([...els.hand.children], hadFocus);

    els.passBtn.hidden = !(view.inputEnabled && legal.some((m) => m.type === 'pass'));
    const canCall = !view.paused && legal.some((m) => m.type === 'callLast');
    els.lastBtn.hidden = !canCall;
    els.lastBtn.classList.toggle('urgent', state.lastWindow === me);

    renderPrompt(state, view);

    if (state.phase === 'challenge' && state.current === me && view.inputEnabled) {
      const from = state.players[state.challenge.from];
      $('#challenge-text').textContent = `${from.name} played a Wild Draw Four. Challenge if you think they held a ${state.challenge.prevColor} card. Right: they draw 4 and you play on. Wrong: you draw 6.`;
      if (!els.challengeDialog.open) els.challengeDialog.showModal();
    }
    if (state.phase === 'chooseColor' && state.current === me && view.inputEnabled && !els.colorDialog.open) {
      openColorPicker((color) => handlers.chooseColor(color), false);
    }

    flip(before);
    ghostDraws(events, me, before);
  }

  // Overlap the hand just enough to fit, falling back to horizontal scroll.
  function fitHand() {
    const cards = els.hand.children.length;
    if (cards < 2) return;
    const cw = els.hand.firstElementChild.getBoundingClientRect().width;
    const avail = els.hand.clientWidth - 24;
    const natural = cards * cw + (cards - 1) * 6;
    const overlap = natural <= avail ? 6 : Math.max((avail - cw) / (cards - 1) - cw, -cw * 0.55);
    els.hand.style.setProperty('--overlap', `${overlap}px`);
  }
  window.addEventListener('resize', fitHand);

  return { render, addLog, clearLog, openStart, showRoundEnd, flashPrompt };
}
