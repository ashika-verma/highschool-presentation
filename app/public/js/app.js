/**
 * app.js — Student App Main Controller
 *
 * Architecture:
 * - State machine: current mode + user session data
 * - WebSocket transport via ws-client.js (singleton)
 * - DOM manipulation is direct (no framework) — targeted, fast
 * - Mode switches: flash → hide current screen → show next
 * - All color state flows through setRoomColor() → CSS vars
 *
 * Mode enum:
 *   lobby | color | ambient | photos | text | demo | qa | sendoff
 */

import { ws } from './ws-client.js';
import { PALETTE, deriveDitherPair, findByHex } from './palette.js';
import { Icons } from './icons.js';

// ─── Session state ─────────────────────────────────────────────────────────

const state = {
  mode: 'lobby',
  joined: false,
  name: '',
  colorHex: '#FF6EB4',
  colorName: 'Hot Pink',
  colorB: '#FFB3D9',
  colorsSent: 0,
  reactionCounts: { '👀': 0, '💡': 0, '🔥': 0, '😮': 0 },
  roomColorHex: '#FF6EB4',
  roomCount: 0,
  totalColorChanges: 0,
  messageLog: [],       // for demo terminal
  photos: [],           // populated by server on welcome
  currentPhoto: 0,
  textResponses: [],
  questions: [],
};

// ─── DOM refs ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  lobby:   $('screen-lobby'),
  color:   $('screen-color'),
  ambient: $('screen-ambient'),
  photos:  $('screen-photos'),
  text:    $('screen-text'),
  demo:    $('screen-demo'),
  qa:      $('screen-qa'),
  sendoff: $('screen-sendoff'),
};

// ─── Boot ──────────────────────────────────────────────────────────────────

function boot() {
  renderLobbyPalette();
  renderColorGridMain();
  ws.connect();
  wireWebSocket();
  wireUI();
  // Show lobby screen
  showScreen('lobby', false);
  // Start ambient sparkles pre-emptively (hidden until mode shown)
  initSparkles($('sparkle-container'), 18);
  initSparkles($('sendoff-sparkles'), 30);
}

// ─── WebSocket event wiring ────────────────────────────────────────────────

function wireWebSocket() {
  ws.addEventListener('connected', () => {
    setConnectionStatus('connected', false);
  });

  ws.addEventListener('disconnected', () => {
    setConnectionStatus('disconnected', true);
  });

  ws.addEventListener('reconnecting', (e) => {
    setConnectionStatus(`reconnecting...`, true);
  });

  // Server pushed a mode change
  ws.onMessage('mode', ({ mode }) => {
    switchMode(mode);
  });

  // Another student sent a color → update room color
  ws.onMessage('color', (data) => {
    setRoomColor(data.hex);
    appendTerminalLine(data.name, data.hex, data.hex);
    state.totalColorChanges++;
    $('demo-count-number').textContent = state.totalColorChanges;
  });

  // Reaction from any student (including self — server echoes)
  ws.onMessage('reaction', ({ name, emoji }) => {
    bumpReaction(emoji);
  });

  // Free-text response from any student
  ws.onMessage('text_response', (data) => {
    addTextFeedItem(data);
  });

  // Question submitted by any student
  ws.onMessage('question', (data) => {
    addQAFeedItem(data);
  });

  // Server welcome — contains initial state
  ws.onMessage('welcome', (data) => {
    if (data.count !== undefined) updateLobbyCount(data.count);
    if (data.mode)  switchMode(data.mode, false); // no flash on initial load
    if (data.totalColorChanges !== undefined) {
      state.totalColorChanges = data.totalColorChanges;
      $('demo-count-number').textContent = state.totalColorChanges;
    }
    if (data.photos) {
      state.photos = data.photos;
      initPhotoSlideshow();
    }
    if (data.roomColor) setRoomColor(data.roomColor);
    if (data.textResponses) {
      data.textResponses.forEach(r => addTextFeedItem(r, false));
    }
    if (data.questions) {
      data.questions.forEach(q => addQAFeedItem(q, false));
    }
  });

  // Someone joined → update lobby counter
  ws.onMessage('join', ({ count }) => {
    updateLobbyCount(count);
  });

  // Server confirms join
  ws.onMessage('joined', ({ count }) => {
    updateLobbyCount(count);
    state.joined = true;
    showJoinedState();
  });

  // Demo: trigger confetti
  ws.onMessage('demo_start', () => {
    triggerConfetti();
  });
}

// ─── UI Event Wiring ───────────────────────────────────────────────────────

function wireUI() {
  // Lobby form submit
  $('lobby-form').addEventListener('submit', e => {
    e.preventDefault();
    handleJoin();
  });

  // Reaction buttons — both ambient and Q&A screens
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReaction(btn.dataset.emoji, btn));
  });

  // Park question button
  $('park-question-btn').addEventListener('click', () => openQuestionModal());
  $('park-cancel-btn').addEventListener('click', () => closeQuestionModal());
  $('park-form').addEventListener('submit', e => {
    e.preventDefault();
    submitParkedQuestion();
  });
  $('question-modal').addEventListener('click', e => {
    if (e.target === $('question-modal')) closeQuestionModal();
  });

  // Free-text form
  $('text-form').addEventListener('submit', e => {
    e.preventDefault();
    handleTextSubmit();
  });

  // Q&A form
  $('qa-submit-btn').addEventListener('click', () => handleQASubmit());
  $('qa-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleQASubmit();
  });

  // Photo swipe
  wirePhotoSwipe();
}

// ─── Lobby ─────────────────────────────────────────────────────────────────

function renderLobbyPalette() {
  const grid = $('lobby-palette');
  grid.innerHTML = '';

  PALETTE.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch';
    btn.style.setProperty('--swatch-color', color.hex);
    btn.setAttribute('aria-label', color.name);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.dataset.hex = color.hex;
    btn.dataset.name = color.name;
    btn.dataset.colorB = color.colorB;

    btn.addEventListener('click', () => selectLobbyColor(color, btn));
    grid.appendChild(btn);
  });

  // Default: select first color
  const first = PALETTE[0];
  selectLobbyColor(first, grid.firstElementChild);
}

function selectLobbyColor(color, btn) {
  state.colorHex = color.hex;
  state.colorName = color.name;
  state.colorB = color.colorB;

  // Update radio state
  $('lobby-palette').querySelectorAll('.color-swatch').forEach(s => {
    s.classList.remove('selected');
    s.setAttribute('aria-checked', 'false');
  });
  btn.classList.add('selected');
  btn.setAttribute('aria-checked', 'true');

  // Update dither preview
  const strip = $('lobby-preview-strip');
  strip.style.setProperty('--room-color-a', color.hex);
  strip.style.setProperty('--room-color-b', color.colorB);
}

function handleJoin() {
  const nameEl = $('name-input');
  const name = nameEl.value.trim();

  if (!name) {
    nameEl.focus();
    nameEl.style.setProperty('--border-color', 'var(--color-pink)');
    return;
  }

  state.name = name;
  ws.sendJoin(name, state.colorHex);

  // Optimistically show joined state
  showJoinedState();
}

function showJoinedState() {
  $('lobby-form-view').classList.add('hidden');
  const joined = $('lobby-joined');
  joined.classList.remove('hidden');

  $('lobby-joined-msg').textContent = `You're in, ${state.name}! 🎮 Watch the lights.`;

  const preview = $('joined-color-preview');
  preview.style.setProperty('--room-color-a', state.colorHex);
  preview.style.setProperty('--room-color-b', state.colorB);
  preview.style.height = '48px';
}

function updateLobbyCount(count) {
  state.roomCount = count;
  $('lobby-count').textContent = count;
  renderPeopleRow(count);
}

function renderPeopleRow(count) {
  const row = $('lobby-people-row');
  row.innerHTML = '';

  // Show up to 12 person icons (after that it gets cluttered)
  const shown = Math.min(count, 12);
  const colors = [
    '#FF6EB4','#FFD93D','#6BCB77','#4DBBFF','#C77DFF',
    '#FF8C42','#00C9A7','#FF6B6B','#FFEE58','#9999FF',
    '#FF00FF','#39FF14',
  ];

  for (let i = 0; i < shown; i++) {
    const el = document.createElement('span');
    el.innerHTML = Icons.person({ color: colors[i % colors.length], size: 24 });
    el.setAttribute('aria-hidden', 'true');
    row.appendChild(el);
  }

  if (count > 12) {
    const more = document.createElement('span');
    more.style.fontFamily = 'var(--font-pixel)';
    more.style.fontSize = 'var(--text-xs)';
    more.style.color = 'var(--color-text-muted)';
    more.textContent = `+${count - 12}`;
    row.appendChild(more);
  }
}

// ─── Color control ─────────────────────────────────────────────────────────

function renderColorGridMain() {
  const grid = $('color-palette-main');
  grid.innerHTML = '';

  PALETTE.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch';
    btn.style.setProperty('--swatch-color', color.hex);
    btn.setAttribute('aria-label', `Send ${color.name}`);
    btn.dataset.hex = color.hex;
    btn.dataset.name = color.name;
    btn.dataset.colorB = color.colorB;

    btn.addEventListener('click', () => handleColorTap(color, btn));
    grid.appendChild(btn);
  });
}

function handleColorTap(color, btn) {
  // Visual: mark selected
  $('color-palette-main').querySelectorAll('.color-swatch').forEach(s =>
    s.classList.remove('selected')
  );
  btn.classList.add('selected');

  // Send to server
  ws.sendColor(state.name || 'Anonymous', color.hex);
  state.colorsSent++;
  state.totalColorChanges++;

  // Update bottom strip
  $('sent-color-swatch').style.background = color.hex;
  $('sent-color-name').textContent = color.name;
  $('sent-color-status').textContent = '→ NYC ⚡ sent!';

  // ZAP animation
  showZapFeedback(color.hex);

  // Update ambient bg if we're in ambient mode
  setRoomColor(color.hex);

  // Update ambient user tag
  updateAmbientTag();

  // Reset status text after 2 seconds
  setTimeout(() => {
    $('sent-color-status').textContent = `${state.colorsSent} sent total`;
  }, 2000);
}

function showZapFeedback(hex) {
  const layer = $('zap-layer');
  const zap = document.createElement('div');
  zap.className = 'zap-feedback';
  zap.innerHTML = `
    <span style="font-size:28px">⚡</span>
    <span>→ NYC</span>
  `;
  zap.style.color = '#FFFFFF';
  zap.style.background = hex;
  zap.style.padding = '8px 16px';
  zap.style.boxShadow = '4px 4px 0 0 #2D1B00, -4px 4px 0 0 #2D1B00, 4px -4px 0 0 #2D1B00, -4px -4px 0 0 #2D1B00';

  layer.appendChild(zap);

  // Clean up after animation finishes
  zap.addEventListener('animationend', () => {
    zap.remove();
  }, { once: true });
}

// ─── Room color (ambient background) ──────────────────────────────────────

function setRoomColor(hex) {
  state.roomColorHex = hex;
  const colorB = findByHex(hex)?.colorB ?? deriveDitherPair(hex);

  // Apply to all dither backgrounds
  document.querySelectorAll('.dither-bg, .ambient-bg, .qa-bg').forEach(el => {
    el.style.setProperty('--room-color-a', hex);
    el.style.setProperty('--room-color-b', colorB);
  });

  // Also update the CSS root so new dither-bg elements inherit
  document.documentElement.style.setProperty('--room-color-a', hex);
  document.documentElement.style.setProperty('--room-color-b', colorB);

  // Update demo counter color too
  $('demo-count-number').style.color = hex;
}

// ─── Ambient mode ──────────────────────────────────────────────────────────

function updateAmbientTag() {
  const tag = $('ambient-user-tag');
  if (state.name) {
    tag.textContent = `${state.name} • ${state.colorsSent} change${state.colorsSent !== 1 ? 's' : ''} sent`;
  }
}

// ─── Sparkle system ────────────────────────────────────────────────────────

function initSparkles(container, count) {
  if (!container) return;
  container.innerHTML = '';

  const colors = ['#FFD93D', '#FF6EB4', '#6BCB77', '#4DBBFF', '#C77DFF', '#FF8C42', '#FFFFFF'];

  for (let i = 0; i < count; i++) {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';

    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const delay = Math.random() * 3;
    const duration = 1.2 + Math.random() * 1.8;
    const color = colors[Math.floor(Math.random() * colors.length)];

    sparkle.style.left = `${x}%`;
    sparkle.style.top  = `${y}%`;
    sparkle.style.setProperty('--sparkle-delay', `${delay}s`);
    sparkle.style.setProperty('--sparkle-duration', `${duration}s`);
    sparkle.style.setProperty('--sparkle-color', color);

    container.appendChild(sparkle);
  }
}

// ─── Reactions ─────────────────────────────────────────────────────────────

function handleReaction(emoji, btn) {
  ws.sendReaction(state.name || 'Anonymous', emoji);
  bumpReaction(emoji);
  btn.classList.add('just-tapped');
  btn.addEventListener('animationend', () => btn.classList.remove('just-tapped'), { once: true });
}

function bumpReaction(emoji) {
  state.reactionCounts[emoji] = (state.reactionCounts[emoji] || 0) + 1;

  // Update ALL matching count badges (same emoji in ambient + Q&A)
  document.querySelectorAll(`[data-emoji-count="${emoji}"]`).forEach(el => {
    el.textContent = state.reactionCounts[emoji];
  });
}

// ─── Question modal ─────────────────────────────────────────────────────────

function openQuestionModal() {
  $('question-modal').classList.remove('hidden');
  $('park-input').focus();
}

function closeQuestionModal() {
  $('question-modal').classList.add('hidden');
  $('park-input').value = '';
}

function submitParkedQuestion() {
  const text = $('park-input').value.trim();
  if (!text) return;

  ws.sendQuestion(state.name || 'Anonymous', text);
  closeQuestionModal();

  // Brief confirmation
  showZapFeedback(state.colorHex);
}

// ─── Free text ─────────────────────────────────────────────────────────────

function handleTextSubmit() {
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;

  ws.sendTextResponse(state.name || 'Anonymous', text);

  // Optimistically add to feed
  addTextFeedItem({ name: state.name, text, hex: state.colorHex }, true);

  input.value = '';
  $('text-submit-btn').textContent = 'Sent! ✓';
  $('text-submit-btn').disabled = true;
  setTimeout(() => {
    $('text-submit-btn').textContent = 'Send it →';
    $('text-submit-btn').disabled = false;
  }, 3000);
}

function addTextFeedItem({ name, text, hex }, animate = true) {
  const feed = $('text-feed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.style.setProperty('--item-color', hex || state.colorHex);
  if (!animate) item.style.animation = 'none';

  item.innerHTML = `
    <span class="feed-item__name">
      <span class="feed-item__dot"></span>${escHtml(name)}
    </span>
    ${escHtml(text)}
  `;

  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

// ─── Q&A ───────────────────────────────────────────────────────────────────

function handleQASubmit() {
  const input = $('qa-input');
  const text = input.value.trim();
  if (!text) return;

  ws.sendQuestion(state.name || 'Anonymous', text);
  addQAFeedItem({ name: state.name, text: text, hex: state.colorHex }, true);

  input.value = '';
}

function addQAFeedItem({ name, text, hex }, animate = true) {
  const feed = $('qa-feed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.style.setProperty('--item-color', hex || '#FF6EB4');
  if (!animate) item.style.animation = 'none';

  item.innerHTML = `
    <span class="feed-item__name">
      <span class="feed-item__dot"></span>${escHtml(name)}
    </span>
    ${escHtml(text)}
  `;

  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

// ─── Photo slideshow ────────────────────────────────────────────────────────

let photoTimer = null;
const PHOTO_INTERVAL = 8000;

const photoDecorations = [
  ['⭐', '💖'],
  ['✨', '🌸'],
  ['💫', '🌟'],
  ['🎵', '💕'],
  ['🎮', '⭐'],
  ['🌈', '✨'],
];

function initPhotoSlideshow() {
  const nav = $('photo-nav');
  nav.innerHTML = '';

  state.photos.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = `photo-dot ${i === 0 ? 'active' : ''}`;
    dot.setAttribute('aria-label', `Photo ${i + 1}`);
    dot.addEventListener('click', () => goToPhoto(i));
    nav.appendChild(dot);
  });

  showPhoto(0);
  startPhotoTimer();
}

function showPhoto(index) {
  if (state.photos.length === 0) return;

  state.currentPhoto = index;
  const photo = state.photos[index];
  const frame = $('photo-display');
  const caption = $('photo-caption');
  const counter = $('photo-counter-text');

  // Update image
  if (photo.src) {
    frame.innerHTML = `<img src="${escAttr(photo.src)}" alt="${escAttr(photo.alt || '')}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block">`;
  }

  if (photo.caption) {
    caption.textContent = photo.caption;
  }

  counter.textContent = `${index + 1} / ${state.photos.length}`;

  // Update decorations
  const decos = photoDecorations[index % photoDecorations.length];
  $('photo-deco-1').textContent = decos[0];
  $('photo-deco-2').textContent = decos[1];

  // Update nav dots
  $('photo-nav').querySelectorAll('.photo-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
}

function goToPhoto(index) {
  const safeIndex = ((index % state.photos.length) + state.photos.length) % state.photos.length;
  showPhoto(safeIndex);
  resetPhotoTimer();
}

function startPhotoTimer() {
  clearInterval(photoTimer);
  photoTimer = setInterval(() => {
    goToPhoto(state.currentPhoto + 1);
  }, PHOTO_INTERVAL);
}

function resetPhotoTimer() {
  clearInterval(photoTimer);
  startPhotoTimer();
}

function wirePhotoSwipe() {
  const container = $('photo-container');
  let startX = 0;

  container.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  }, { passive: true });

  container.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) {
      goToPhoto(state.currentPhoto + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });
}

// ─── Demo reveal ────────────────────────────────────────────────────────────

function appendTerminalLine(name, hex, originalHex) {
  const terminal = $('demo-terminal');
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const line = document.createElement('div');
  line.innerHTML = `
    <span class="terminal-line terminal-line--timestamp">[${ts}] </span><span class="terminal-line terminal-line--name" style="--item-color:${escAttr(originalHex)}">${escHtml(name)}</span><span class="terminal-line"> → ${escHtml(originalHex)}</span>
  `;

  terminal.appendChild(line);

  // Keep last 50 lines
  while (terminal.children.length > 51) {
    terminal.removeChild(terminal.firstChild);
  }

  terminal.scrollTop = terminal.scrollHeight;

  // Update counter
  $('demo-count-number').textContent = state.totalColorChanges;
}

// ─── Confetti ──────────────────────────────────────────────────────────────

function triggerConfetti() {
  const layer = $('confetti-layer');
  const colors = PALETTE.slice(0, 20).map(p => p.hex);

  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';

    const x = Math.random() * 100;
    const delay = Math.random() * 0.8;
    const duration = 1.5 + Math.random() * 1;
    const spin = (Math.random() * 720 - 360) + 'deg';
    const color = colors[Math.floor(Math.random() * colors.length)];

    piece.style.setProperty('--confetti-x', `${x}%`);
    piece.style.setProperty('--confetti-delay', `${delay}s`);
    piece.style.setProperty('--confetti-duration', `${duration}s`);
    piece.style.setProperty('--confetti-spin', spin);
    piece.style.setProperty('--confetti-color', color);

    layer.appendChild(piece);

    piece.addEventListener('animationend', () => piece.remove(), { once: true });
  }
}

// ─── Mode switching ─────────────────────────────────────────────────────────

function switchMode(mode, flash = true) {
  if (mode === state.mode && mode !== 'demo') return;
  state.mode = mode;

  if (flash) {
    doModeFlash(() => showScreen(mode));
  } else {
    showScreen(mode, false);
  }

  // Mode-specific side effects
  if (mode === 'demo') {
    triggerConfetti();
    animateCounter();
  }

  if (mode === 'ambient') {
    updateAmbientTag();
    setRoomColor(state.roomColorHex);
  }

  if (mode === 'sendoff') {
    initSparkles($('sendoff-sparkles'), 40);
  }
}

function showScreen(name, animate = true) {
  Object.entries(screens).forEach(([key, el]) => {
    if (key === name) {
      el.classList.add('active');
      el.removeAttribute('aria-hidden');
    } else {
      el.classList.remove('active');
      el.setAttribute('aria-hidden', 'true');
    }
  });
}

function doModeFlash(callback) {
  const flash = $('mode-flash');
  flash.className = 'mode-flash';
  flash.style.display = 'block';
  flash.addEventListener('animationend', () => {
    flash.style.display = 'none';
    callback?.();
  }, { once: true });
}

// ─── Demo counter animation ─────────────────────────────────────────────────

function animateCounter() {
  const el = $('demo-count-number');
  const target = state.totalColorChanges;
  const duration = 2000;
  const startTime = performance.now();
  const startVal = 0;

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out quad
    const eased = 1 - (1 - progress) ** 2;
    const current = Math.round(startVal + (target - startVal) * eased);
    el.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

// ─── Connection status ──────────────────────────────────────────────────────

let statusTimer = null;

function setConnectionStatus(text, visible) {
  const el = $('connection-status');
  $('connection-text').textContent = text;

  if (visible) {
    el.classList.add('visible');
    clearTimeout(statusTimer);
  } else {
    // Connected: show briefly then hide
    el.classList.add('visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('visible'), 2000);
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Go ─────────────────────────────────────────────────────────────────────

boot();
