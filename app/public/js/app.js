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

// ─── Dedup sets — prevent double-adding optimistic vs. server-echo items ───
// Key format: "<name>::<text>"
// Cleared on mode switch so they don't accumulate if server echo never arrives.
const _selfSentTexts = new Set();
const _selfSentQAs   = new Set();

// ─── Session state ─────────────────────────────────────────────────────────

const state = {
  mode: 'lobby',
  joined: false,
  name: '',
  colorHex: '#FF6EB4',
  colorName: 'Hot Pink',
  colorB: '#FFB3D9',
  colorsSent: 0,
  // Track the most recently tapped color so color screen re-entry shows it
  lastSentHex: null,
  lastSentName: null,
  reactionCounts: { '👀': 0, '💡': 0, '🔥': 0, '😮': 0 },
  roomColorHex: '#FF6EB4',
  roomCount: 0,
  totalColorChanges: 0,
  messageLog: [],       // for demo terminal
  photos: [],           // populated by server on welcome (legacy, kept for compat)
  currentPhoto: 0,
  textResponses: [],
  questions: [],
  // Slides system
  slides: [],           // populated by server on welcome
  currentSlide: 0,
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

// ─── Palette hex cache — avoids re-mapping on every renderPeopleRow call ────
const PALETTE_HEXES = PALETTE.map(p => p.hex);

// ─── Debounce helper ────────────────────────────────────────────────────────

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── Floating color bubble ─────────────────────────────────────────────────
// A 52px glowing circle in the bottom-right corner that shows the student's
// current color. Tapping opens a full 30-color bottom drawer so they can change
// their color from ambient, slides, text, demo, or Q&A without leaving the screen.

function initColorBubble() {
  const bubble = $('color-bubble');
  const drawer = $('color-drawer');
  if (!bubble || !drawer) return;

  renderDrawerPalette();

  bubble.addEventListener('click', openColorDrawer);

  const backdrop = $('color-drawer-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeColorDrawer);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.style.display !== 'none') closeColorDrawer();
  });
}

function renderDrawerPalette() {
  const grid = $('color-drawer-palette');
  if (!grid) return;
  grid.innerHTML = '';
  PALETTE.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch';
    btn.style.setProperty('--swatch-color', color.hex);
    btn.setAttribute('aria-label', color.name);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.dataset.hex   = color.hex;
    btn.dataset.name  = color.name;
    btn.dataset.colorB = color.colorB;
    btn.addEventListener('click', () => handleDrawerColorTap(color, btn));
    grid.appendChild(btn);
  });
}

function handleDrawerColorTap(color, btn) {
  if (!state.joined) {
    showToast('Join first to control the lights!', '#888899');
    closeColorDrawer();
    return;
  }

  const now = Date.now();
  if (now - lastColorTapAt < COLOR_TAP_RATE_MS) return;
  lastColorTapAt = now;

  // Mark selected in drawer
  $('color-drawer-palette').querySelectorAll('.color-swatch').forEach(s => {
    s.classList.remove('selected');
    s.setAttribute('aria-checked', 'false');
  });
  btn.classList.add('selected');
  btn.setAttribute('aria-checked', 'true');

  if (navigator.vibrate) navigator.vibrate(20);

  ws.sendColor(state.name || 'Anonymous', color.hex);
  state.colorsSent++;
  state.lastSentHex  = color.hex;
  state.lastSentName = color.name;
  state.totalColorChanges++;
  const countEl = $('demo-count-number');
  if (countEl) countEl.textContent = state.totalColorChanges > 0 ? state.totalColorChanges : '—';
  appendTerminalLine(state.name || 'Anonymous', color.hex, color.hex);

  setRoomColor(color.hex);
  updateAmbientTag();
  showZapFeedback(color.hex);
  syncColorBubble(color.hex);

  closeColorDrawer();
}

function openColorDrawer() {
  const drawer = $('color-drawer');
  if (!drawer) return;
  drawer.style.display = 'block';

  // Pre-select current color
  const hex = state.lastSentHex || state.colorHex;
  const grid = $('color-drawer-palette');
  if (grid) {
    grid.querySelectorAll('.color-swatch').forEach(btn => {
      const sel = btn.dataset.hex === hex;
      btn.classList.toggle('selected', sel);
      btn.setAttribute('aria-checked', sel ? 'true' : 'false');
    });
  }
}

function closeColorDrawer() {
  const drawer = $('color-drawer');
  if (!drawer || drawer.style.display === 'none') return;

  // Animate out: slide sheet down + fade backdrop, then hide
  drawer.classList.add('closing');

  // Wait for the longer of the two animations (0.22s) + a small buffer
  const CLOSE_MS = 240;
  setTimeout(() => {
    drawer.style.display = 'none';
    drawer.classList.remove('closing');
  }, CLOSE_MS);
}

function syncColorBubble(hex) {
  const bubble = $('color-bubble');
  if (!bubble) return;
  const h = hex || state.roomColorHex || '#FF6EB4';
  bubble.style.background  = h;
  bubble.style.boxShadow   = `0 0 22px -4px ${h}, 0 4px 14px rgba(0,0,0,0.45)`;
}

function setColorBubbleVisible(visible) {
  const bubble = $('color-bubble');
  if (!bubble) return;
  bubble.style.display = visible ? 'block' : 'none';
  if (visible) syncColorBubble(state.lastSentHex || state.colorHex);
}

// ─── Boot ──────────────────────────────────────────────────────────────────

function boot() {
  renderLobbyPalette();
  renderColorGridMain();
  initColorBubble();
  ws.connect();
  wireWebSocket();
  wireUI();
  // Show lobby screen
  showScreen('lobby');
  // Pre-initialize ambient sparkles (hidden until mode shown, cheap to start early)
  initSparkles($('sparkle-container'), 18);
  // Sendoff sparkles initialized on demand in switchMode — don't double-init here
}

// ─── WebSocket event wiring ────────────────────────────────────────────────

function wireWebSocket() {
  ws.addEventListener('connected', () => {
    setConnectionStatus('connected', false);
    showOfflineBanner(false);
  });

  ws.addEventListener('disconnected', () => {
    setConnectionStatus('disconnected', true);
    showOfflineBanner(true);
  });

  ws.addEventListener('reconnecting', (e) => {
    setConnectionStatus(`reconnecting...`, true);
    showOfflineBanner(true);
  });

  // Server pushed a mode change
  ws.onMessage('mode', ({ mode }) => {
    if (!state.joined && mode !== 'lobby') {
      // Student hasn't completed join yet — store as pending so they catch up
      // after the server confirms their join. This prevents an unjoined student
      // from being swept to a non-lobby screen mid-registration.
      state._pendingMode = mode;
      return;
    }
    switchMode(mode);
  });

  // Another student sent a color → update room color
  ws.onMessage('color', (data) => {
    setRoomColor(data.hex);
    appendTerminalLine(data.name, data.hex, data.hex);
    state.totalColorChanges++;
    $('demo-count-number').textContent = state.totalColorChanges > 0 ? state.totalColorChanges : '—';
  });

  // Reaction from any student (including self — server echoes)
  ws.onMessage('reaction', ({ name, emoji }) => {
    bumpReaction(emoji);
  });

  // Free-text response from any student (server echo — skip if we sent it ourselves)
  ws.onMessage('text_response', (data) => {
    const key = `${data.name}::${data.text}`;
    if (_selfSentTexts.has(key)) { _selfSentTexts.delete(key); return; }
    addTextFeedItem(data);
  });

  // Question submitted by any student (server echo — skip if we sent it ourselves)
  ws.onMessage('question', (data) => {
    const key = `${data.name}::${data.text}`;
    if (_selfSentQAs.has(key)) { _selfSentQAs.delete(key); return; }
    addQAFeedItem(data);
  });

  // Server welcome — contains initial state (fires on connect AND reconnect)
  ws.onMessage('welcome', (data) => {
    if (data.count !== undefined) updateLobbyCount(data.count);
    if (data.mode) {
      if (!state.joined && data.mode !== 'lobby') {
        // Late joiner: talk has started but they haven't registered yet.
        // Keep them on the lobby form so they can enter their name/color.
        // Store the target mode — switch to it once they join.
        state._pendingMode = data.mode;
        // Show a subtle mid-talk hint above the header
        if (!document.querySelector('.late-join-hint')) {
          const hint = document.createElement('p');
          hint.className = 'late-join-hint';
          hint.textContent = '⚡ talk in progress — join to participate';
          hint.style.cssText = [
            'font-size:11px',
            'color:rgba(255,200,80,0.9)',
            'font-family:var(--font-mono)',
            'letter-spacing:0.05em',
            'margin-bottom:var(--space-3)',
          ].join(';');
          const header = document.querySelector('.lobby-header');
          if (header) header.prepend(hint);
        }
      } else {
        // Already joined (reconnect) or still on lobby — apply mode normally
        state.mode = null; // force switchMode to not short-circuit on same-mode check
        switchMode(data.mode, false); // no flash on reconnect
      }
    }
    if (data.totalColorChanges !== undefined) {
      state.totalColorChanges = data.totalColorChanges;
      $('demo-count-number').textContent = state.totalColorChanges > 0 ? state.totalColorChanges : '—';
    }
    if (data.photos !== undefined) {
      // Legacy: keep photos array in state for potential future use
      state.photos = data.photos;
    }
    // Slides — load from server and render current slide
    if (data.slides !== undefined) {
      state.slides = data.slides;
      if (data.currentSlideIndex !== undefined) {
        state.currentSlide = data.currentSlideIndex;
      }
      renderSlide(state.slides[state.currentSlide]);
    }
    if (data.roomColor) setRoomColor(data.roomColor);
    if (data.reactionCounts) {
      // Sync cumulative reaction counts from server — fixes late joiners seeing "0" for all
      Object.entries(data.reactionCounts).forEach(([emoji, count]) => {
        state.reactionCounts[emoji] = count;
        // Update all matching count badges
        document.querySelectorAll(`[data-emoji-count="${emoji}"]`).forEach(el => {
          el.textContent = count;
          if (count > 0) el.classList.add('has-count');
        });
      });
    }
    if (data.textResponses) {
      // Clear existing feed before replaying server state to prevent duplicates on reconnect
      $('text-feed').innerHTML = '';
      data.textResponses.forEach(r => addTextFeedItem(r, false));
    }
    if (data.questions) {
      // Same for Q&A feed
      $('qa-feed').innerHTML = '';
      data.questions.forEach(q => addQAFeedItem(q, false));
    }

    // CRITICAL: Re-register with the server after reconnect.
    // The server's client record is reset on each WS connection — if the student
    // had previously joined, they must re-send their join message so the server
    // knows their name. Without this, post-reconnect color/reaction/text sends
    // are silently dropped (server guards: if (!client.name) return).
    if (state.joined && state.name) {
      ws.sendJoin(state.name, state.lastSentHex || state.colorHex);
    }
  });

  // Someone joined → update lobby counter
  ws.onMessage('join', ({ count }) => {
    updateLobbyCount(count);
  });

  // Someone left → update lobby counter
  ws.onMessage('leave', ({ count }) => {
    updateLobbyCount(count);
  });

  // Server confirms join
  ws.onMessage('joined', ({ count }) => {
    updateLobbyCount(count);
    state.joined = true;
    showJoinedState();

    // Late joiner: switch to current mode after showing join confirmation briefly
    if (state._pendingMode && state._pendingMode !== 'lobby') {
      const targetMode = state._pendingMode;
      state._pendingMode = null;
      setTimeout(() => switchMode(targetMode, true), 900);
    }
  });

  // Demo: trigger confetti
  ws.onMessage('demo_start', () => {
    triggerConfetti();
  });

  // Slide navigation from host
  ws.onMessage('slide_goto', ({ index }) => {
    const clampedIdx = Math.max(0, Math.min(index, state.slides.length - 1));
    state.currentSlide = clampedIdx;
    renderSlide(state.slides[clampedIdx]);
    updateSlidePill();
  });

  // Full slide list updated after host saves
  ws.onMessage('slides_updated', ({ slides, currentSlideIndex }) => {
    state.slides = slides;
    state.currentSlide = currentSlideIndex ?? 0;
    renderSlide(state.slides[state.currentSlide]);
    updateSlidePill();
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

  // Escape key closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('question-modal').classList.contains('hidden')) {
      closeQuestionModal();
    }
  });

  // Free-text form
  $('text-form').addEventListener('submit', e => {
    e.preventDefault();
    handleTextSubmit();
  });

  // Q&A form
  $('qa-submit-btn').addEventListener('click', () => handleQASubmit());
  $('qa-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault(); // prevent newline/form submission on Android soft keyboard
      handleQASubmit();
    }
  });

  // Text textarea: Enter key submits (it's a short-answer field, not a multi-line editor)
  $('text-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = $('text-form');
      // requestSubmit() fires form validation; fallback to submit() for iOS < 15.4
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }
  });

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

  // Update preview strip
  const strip = $('lobby-preview-strip');
  strip.style.setProperty('--room-color-a', color.hex);
  strip.style.setProperty('--room-color-b', color.colorB);

  // Show selected color name
  const nameLabel = $('lobby-color-name-label');
  if (nameLabel) nameLabel.textContent = color.name;

  // Also update the root so the join button (which inherits --room-color-a) updates too
  document.documentElement.style.setProperty('--room-color-a', color.hex);
  document.documentElement.style.setProperty('--room-color-b', color.colorB);
  // Update contrast text color so join button text is readable on all palette colors
  document.documentElement.style.setProperty('--room-btn-text', contrastColor(color.hex));
}

// Simple title-case: capitalize first letter of each word.
// Prevents ALL-CAPS names from looking like the app is shouting.
function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Trim all Unicode whitespace — .trim() only strips ASCII whitespace.
// This catches NBSP (\u00A0), zero-width spaces, and similar invisible chars.
function fullTrim(str) {
  return str.replace(/^[\s\u00A0\u2000-\u200B\uFEFF]+|[\s\u00A0\u2000-\u200B\uFEFF]+$/g, '');
}

function handleJoin() {
  const nameEl = $('name-input');
  const rawName = fullTrim(nameEl.value);

  if (!rawName) {
    nameEl.focus();
    nameEl.style.borderColor = '#ff6b6b';
    // Shake the input to draw attention
    nameEl.classList.remove('input-shake');
    // Force reflow so the animation restarts if triggered again
    void nameEl.offsetWidth;
    nameEl.classList.add('input-shake');
    nameEl.addEventListener('animationend', () => nameEl.classList.remove('input-shake'), { once: true });
    nameEl.addEventListener('input', () => {
      nameEl.style.borderColor = '';
    }, { once: true });
    return;
  }

  // Normalize to title case so "JESSICA" → "Jessica", "jessica" → "Jessica"
  const name = toTitleCase(rawName);
  state.name = name;
  ws.sendJoin(name, state.colorHex);

  // Show a pending state — set joined=true only when server confirms via 'joined'.
  // If the server rejects the name (invisible chars, etc.) state.joined stays false
  // and the form remains usable. We show the joined view optimistically for UX speed
  // but keep a recovery timer: if no 'joined' message in 5s, restore the form.
  showJoinedState();

  const joinTimeout = setTimeout(() => {
    if (!state.joined) {
      // Server never confirmed — show form again with an error hint
      $('lobby-joined').classList.add('hidden');
      $('lobby-form-view').classList.remove('hidden');
      nameEl.style.borderColor = '#ff6b6b';
      nameEl.focus();
    }
  }, 5000);

  // Cancel the timeout once the server confirms
  ws.addEventListener('msg:joined', () => clearTimeout(joinTimeout), { once: true });
}

function showJoinedState() {
  $('lobby-form-view').classList.add('hidden');
  const joined = $('lobby-joined');
  joined.classList.remove('hidden');

  $('lobby-joined-msg').textContent = `You're in, ${state.name}.`;

  // Tailor the wait-hint based on whether the talk is already in progress
  const waitHint = joined.querySelector('.lobby-wait-hint');
  if (waitHint) {
    if (state._pendingMode && state._pendingMode !== 'lobby') {
      // Talk already started — they'll be taken to the right screen shortly
      waitHint.textContent = 'joining the talk now...';
    } else {
      waitHint.textContent = 'sit back — your screen changes automatically when the talk starts';
    }
  }

  const preview = $('joined-color-preview');
  preview.style.setProperty('--room-color-a', state.colorHex);
  preview.style.setProperty('--room-color-b', state.colorB);
  preview.style.height = '48px';
}

function updateLobbyCount(count) {
  state.roomCount = count;
  const countEl = $('lobby-count');
  const counterBox = $('lobby-counter-box');

  if (count === 0) {
    // Hide the entire counter box — showing an empty box with "be the first" takes up
    // space and looks broken to students who join before others.
    if (counterBox) counterBox.style.display = 'none';
    countEl.style.display = 'none';
  } else {
    if (counterBox) counterBox.style.display = '';
    countEl.style.display = '';
    countEl.textContent = count;
  }

  // Update label: "in the room right now" vs "be the first"
  const label = document.querySelector('.lobby-counter__label');
  if (label) {
    label.textContent = count === 0 ? 'be the first to join' : `in the room right now`;
  }

  // Update joined-state count label (only visible after join)
  const joinedCount = $('lobby-joined-count');
  if (joinedCount) {
    if (count > 1) {
      joinedCount.textContent = `${count} people in the room`;
    } else if (count === 1) {
      joinedCount.textContent = `just you so far`;
    } else {
      joinedCount.textContent = '';
    }
  }

  renderPeopleRow(count);
}

// Debounced version — batches rapid join/leave events into a single DOM update.
// With 30 students joining simultaneously, this prevents 30 complete DOM rebuilds.
const renderPeopleRow = debounce(_renderPeopleRowImmediate, 80);

function _renderPeopleRowImmediate(count) {
  const row = $('lobby-people-row');
  row.innerHTML = '';

  // Show up to 20 color dots (after that show overflow count)
  const MAX_DOTS = 20;
  const shown = Math.min(count, MAX_DOTS);
  // Use all palette colors for variety — 30 colors means minimal repetition
  const colors = PALETTE_HEXES;

  for (let i = 0; i < shown; i++) {
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = `
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${colors[i % colors.length]};
      box-shadow: 0 0 6px 1px ${colors[i % colors.length]}88;
      flex-shrink: 0;
    `;
    row.appendChild(dot);
  }

  if (count > MAX_DOTS) {
    const more = document.createElement('span');
    more.style.cssText = `
      font-family: var(--font-sans);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      margin-left: 2px;
    `;
    more.textContent = `+${count - MAX_DOTS}`;
    row.appendChild(more);
  }
}

// ─── Color control ─────────────────────────────────────────────────────────

// Client-side rate limit: matches server-side 300ms guard.
// Prevents UI churn from accidental rapid taps.
let lastColorTapAt = 0;
const COLOR_TAP_RATE_MS = 300;

// Text response rate limit — matches server 8s guard
let lastTextSentAt = 0;
const CLIENT_TEXT_RATE_MS = 8000;

// Timer for resetting the color sent status text — debounced so multiple
// rapid taps don't leave stale timers stepping on each other.
let colorStatusResetTimer = null;

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
  // If the student hasn't joined yet, their taps are silently dropped by the server
  // (server guard: if (!client.name) return). Show a gentle prompt instead of fake feedback.
  if (!state.joined) {
    showToast('Join first to control the lights!', '#888899');
    return;
  }

  // Client-side rate limit — drop taps that arrive too fast
  const now = Date.now();
  if (now - lastColorTapAt < COLOR_TAP_RATE_MS) return;
  lastColorTapAt = now;

  // Visual: mark selected
  $('color-palette-main').querySelectorAll('.color-swatch').forEach(s =>
    s.classList.remove('selected')
  );
  btn.classList.add('selected');

  // Haptic feedback — 20ms minimum for reliable Android vibration
  if (navigator.vibrate) navigator.vibrate(20);

  // Send to server
  ws.sendColor(state.name || 'Anonymous', color.hex);
  state.colorsSent++;
  // Track last sent color so color screen re-entry can show it
  state.lastSentHex  = color.hex;
  state.lastSentName = color.name;
  // The server excludes the sender from the 'color' broadcast, so we must
  // increment totalColorChanges here for our own taps to show in the demo counter.
  state.totalColorChanges++;
  $('demo-count-number').textContent = state.totalColorChanges > 0 ? state.totalColorChanges : '—';
  appendTerminalLine(state.name || 'Anonymous', color.hex, color.hex);

  // Update bottom strip — set both the CSS var and direct background for max compat
  $('sent-color-swatch').style.setProperty('--current-color', color.hex);
  $('sent-color-swatch').style.background = color.hex;
  $('sent-color-name').textContent = color.name;
  $('sent-color-status').textContent = 'sent to NYC';

  // ZAP animation
  showZapFeedback(color.hex);

  // Update ambient bg if we're in ambient mode
  setRoomColor(color.hex);

  // Update ambient user tag
  updateAmbientTag();

  // Reset status text after 2 seconds — debounced to avoid stale timers
  clearTimeout(colorStatusResetTimer);
  colorStatusResetTimer = setTimeout(() => {
    const n = state.colorsSent;
    $('sent-color-status').textContent = n === 1 ? `you've sent 1` : `you've sent ${n}`;
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
  zap.style.color = contrastColor(hex);
  zap.style.background = hex;
  zap.style.padding = '10px 20px';
  zap.style.boxShadow = `0 0 32px -4px ${hex}, 0 4px 16px rgba(0,0,0,0.4)`;

  layer.appendChild(zap);

  // Clean up after the zap-out animation finishes.
  // animationend fires for each animation (zap-in then zap-out) so we must
  // only remove on the last one (zap-out). Check animationName to be precise.
  zap.addEventListener('animationend', (e) => {
    if (e.animationName === 'zap-out') {
      zap.remove();
    }
  });
}

// ─── Toast notification (non-NYC zap) ──────────────────────────────────────
// Lightweight confirmation toast — used for actions that aren't "send to NYC"

function showToast(message, hex) {
  const layer = $('zap-layer');
  const toast = document.createElement('div');
  toast.className = 'zap-feedback';
  toast.textContent = message;
  const toastBg = hex || '#4ADE80';
  toast.style.color = contrastColor(toastBg);
  toast.style.background = toastBg;
  toast.style.padding = '10px 20px';
  toast.style.boxShadow = `0 0 32px -4px ${toastBg}, 0 4px 16px rgba(0,0,0,0.4)`;

  layer.appendChild(toast);
  toast.addEventListener('animationend', (e) => {
    if (e.animationName === 'zap-out') toast.remove();
  });
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

  // Fix text contrast on colored buttons — some palette colors (Forest, Violet, Cobalt)
  // are dark enough that black text fails WCAG contrast. Dynamically switch to white.
  const textColor = contrastColor(hex);
  document.documentElement.style.setProperty('--room-btn-text', textColor);

  // Keep bubble color in sync with the current room color
  if ($('color-bubble')?.style.display !== 'none') syncColorBubble(hex);
}

// ─── Slide renderer ────────────────────────────────────────────────────────
//
// Renders a slide onto #slide-canvas.
// Each element is positioned absolutely using x/y as % from center.
// The slide spec: { id, bg, elements: [ { type: 'text'|'image', ... } ] }

// ─── Slide progress pill ───────────────────────────────────────────────────
// Shows "1 / 3" style indicator. Hidden when 0 or 1 slides (no navigation context needed).

function updateSlidePill() {
  const pill = $('slide-progress-pill');
  if (!pill) return;
  const total = state.slides.length;
  if (total <= 1) {
    pill.style.display = 'none';
    return;
  }
  const current = state.currentSlide + 1; // 1-indexed for display
  pill.style.display = 'block';
  pill.textContent = `${current} / ${total}`;
}

function renderSlide(slide) {
  const canvas = $('slide-canvas');
  if (!canvas) return;

  // Clear previous content (keep ::after pseudo-element — it's CSS)
  canvas.innerHTML = '';

  if (!slide || typeof slide !== 'object') {
    // Show empty state placeholder — large enough to be readable on any phone
    const empty = document.createElement('div');
    empty.className = 'slide-empty-state';
    empty.innerHTML = '<span>waiting for slides</span>';
    canvas.appendChild(empty);
    canvas.style.background = '#0A0A10';
    return;
  }

  // Set background
  canvas.style.background = (typeof slide.bg === 'string' && slide.bg) ? slide.bg : '#0A0A10';

  // Responsive font scaling:
  // The host editor designs slides at roughly 600px canvas width.
  // On a 360px student phone, a 48px font would dominate.
  // Scale by the ratio of the actual canvas width to the design reference width.
  // Clamped between 0.5x and 1.0x so tiny phones still get readable text.
  //
  // IMPORTANT: canvas.clientWidth returns 0 when the screen is display:none
  // (e.g. during the welcome WS event when mode is still 'lobby').
  // Fall back to window.innerWidth only when clientWidth is > 0; otherwise
  // use a fixed 390px reference (median modern phone width) so text renders at
  // a reasonable size on first reveal rather than always locking to 0.5x.
  const DESIGN_REF_WIDTH = 600;
  const rawWidth = canvas.clientWidth;
  const canvasWidth = rawWidth > 0 ? rawWidth : Math.min(window.innerWidth || 390, 480);
  const fontScale = Math.max(0.5, Math.min(1.0, canvasWidth / DESIGN_REF_WIDTH));

  // Render elements
  (Array.isArray(slide.elements) ? slide.elements : []).forEach(el => {
    if (!el || typeof el !== 'object') return;
    if (el.type === 'text') {
      const div = document.createElement('div');
      div.className = 'slide-element-text';
      // CSS class sets transform: translate(-50%, -50%) which centers the element
      // on its x/y anchor point. left/top alone would offset from the top-left corner.
      div.style.left = `${el.x ?? 50}%`;
      div.style.top  = `${el.y ?? 50}%`;
      // Apply responsive scale — multiply configured size by viewport ratio
      div.style.fontSize   = `${Math.round((el.size ?? 20) * fontScale)}px`;
      div.style.color      = el.color || '#FFFFFF';
      div.style.fontWeight = el.weight ?? 400;
      div.style.textAlign  = el.align || 'center';
      div.style.maxWidth   = '90%';
      div.style.lineHeight = '1.3';
      // Use textContent — never innerHTML for user data (XSS guard)
      div.textContent = el.content || '';
      canvas.appendChild(div);
    } else if (el.type === 'image') {
      // Sanitize src: must start with /photos/ — no external URLs (XSS / data-exfil guard)
      const safeSrc = (typeof el.src === 'string' && /^\/photos\//.test(el.src)) ? el.src : null;
      // Don't append an img with no src — browser fires a request to the current page URL
      if (!safeSrc) return;
      const img = document.createElement('img');
      img.className = 'slide-element-img';
      // CSS class sets transform: translate(-50%, -50%) — same center-anchor as text
      img.style.left = `${el.x ?? 50}%`;
      img.style.top  = `${el.y ?? 50}%`;
      img.style.width = `${el.width ?? 80}%`;
      img.alt = '';
      img.decoding = 'async';
      // Broken image guard: show nothing (canvas bg) rather than browser's broken icon
      img.onerror = () => { img.style.display = 'none'; };
      img.src = safeSrc;
      canvas.appendChild(img);
    }
  });
}

// ─── Ambient mode ──────────────────────────────────────────────────────────

function updateAmbientTag() {
  const tag = $('ambient-user-tag');
  const sent = state.colorsSent;
  if (state.name) {
    tag.textContent = sent > 0
      ? `${state.name} • ${sent} color${sent !== 1 ? 's' : ''} sent to NYC`
      : `${state.name} • react below`;
  } else {
    // Reconnected without session — show generic connected state
    tag.textContent = 'connected • tap to react';
  }
}

// ─── Sparkle system ────────────────────────────────────────────────────────

function initSparkles(container, count) {
  if (!container) return;
  container.innerHTML = '';

  // Include the current room color prominently — sparkles feel connected to the live light.
  // Blend with palette colors for variety (room color appears 3x for bias toward current color).
  const roomColor = state.roomColorHex || '#FF6EB4';
  const colors = [roomColor, roomColor, roomColor, ...PALETTE_HEXES.slice(0, 8), '#FFFFFF'];

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
  // Haptic feedback — 20ms minimum for reliable Android vibration
  if (navigator.vibrate) navigator.vibrate(20);
}

function bumpReaction(emoji) {
  state.reactionCounts[emoji] = (state.reactionCounts[emoji] || 0) + 1;

  // Update ALL matching count badges (same emoji in ambient + Q&A)
  document.querySelectorAll(`[data-emoji-count="${emoji}"]`).forEach(el => {
    el.textContent = state.reactionCounts[emoji];
    // Show count only once it's non-zero so initial state doesn't look dead
    el.classList.add('has-count');
  });
}

// ─── Question modal ─────────────────────────────────────────────────────────

function openQuestionModal() {
  $('question-modal').classList.remove('hidden');
  // Focus the textarea after a tick so the modal animation doesn't fight it
  setTimeout(() => $('park-input').focus(), 50);
}

function closeQuestionModal() {
  $('question-modal').classList.add('hidden');
  $('park-input').value = '';
  // Return focus to the button that opened the modal
  $('park-question-btn').focus();
}

// Server-side rate limit for questions is 5s. Track last question send time client-side
// so we can warn the user if they hit the limit (instead of silently dropping).
let lastQuestionSentAt = 0;
const CLIENT_QUESTION_RATE_MS = 5000;

function submitParkedQuestion() {
  const text = fullTrim($('park-input').value);
  if (!text) return;

  // Prevent double-submit on rapid taps
  const btn = $('park-submit-btn');
  if (btn.disabled) return;

  // Client-side rate limit mirrors server: warn instead of silently dropping
  const now = Date.now();
  if (now - lastQuestionSentAt < CLIENT_QUESTION_RATE_MS) {
    const remaining = Math.ceil((CLIENT_QUESTION_RATE_MS - (now - lastQuestionSentAt)) / 1000);
    showToast(`Wait ${remaining}s`, '#888899');
    return;
  }
  lastQuestionSentAt = now;

  btn.disabled = true;

  ws.sendQuestion(state.name || 'Anonymous', text);
  closeQuestionModal();

  // Re-enable after modal closes (modal hides immediately, btn reset is safety)
  setTimeout(() => { btn.disabled = false; }, 500);

  // Brief confirmation — show a question-specific toast, not the NYC zap
  showToast('Question sent', state.colorHex);
}

// ─── Free text ─────────────────────────────────────────────────────────────

function handleTextSubmit() {
  const input = $('text-input');
  const text = fullTrim(input.value);
  if (!text) return;

  // Client-side rate limit mirrors server 8s guard — show feedback instead of silent drop
  const now = Date.now();
  if (now - lastTextSentAt < CLIENT_TEXT_RATE_MS) {
    const remaining = Math.ceil((CLIENT_TEXT_RATE_MS - (now - lastTextSentAt)) / 1000);
    const btn = $('text-submit-btn');
    const origText = btn.textContent;
    btn.textContent = `Wait ${remaining}s`;
    setTimeout(() => { btn.textContent = origText; }, 1200);
    return;
  }
  lastTextSentAt = now;

  // Add optimistically — mark so server echo doesn't double-add
  const key = `${state.name}::${text}`;
  _selfSentTexts.add(key);
  addTextFeedItem({ name: state.name, text, hex: state.colorHex }, true);

  ws.sendTextResponse(state.name || 'Anonymous', text);
  input.value = '';
  $('text-submit-btn').textContent = 'Sent!';
  $('text-submit-btn').disabled = true;
  setTimeout(() => {
    $('text-submit-btn').textContent = 'Send it';
    $('text-submit-btn').disabled = false;
  }, 1500);
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

  // Cap feed DOM at 40 items so it never grows unbounded
  while (feed.children.length > 40) {
    feed.removeChild(feed.firstChild);
  }

  feed.scrollTop = feed.scrollHeight;
}

// ─── Q&A ───────────────────────────────────────────────────────────────────

function shakeInput(el) {
  el.classList.remove('input-shake');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('input-shake');
  el.addEventListener('animationend', () => el.classList.remove('input-shake'), { once: true });
}

function handleQASubmit() {
  const input = $('qa-input');
  const text = fullTrim(input.value);
  if (!text) {
    shakeInput(input);
    input.focus();
    return;
  }

  // Client-side rate limit mirrors server 5s guard — gives user feedback instead of silent drop
  const now = Date.now();
  if (now - lastQuestionSentAt < CLIENT_QUESTION_RATE_MS) {
    const remaining = Math.ceil((CLIENT_QUESTION_RATE_MS - (now - lastQuestionSentAt)) / 1000);
    showToast(`Wait ${remaining}s`, '#888899');
    return;
  }
  lastQuestionSentAt = now;

  // Add optimistically — mark so server echo doesn't double-add
  const key = `${state.name}::${text}`;
  _selfSentQAs.add(key);
  addQAFeedItem({ name: state.name, text: text, hex: state.colorHex }, true);

  ws.sendQuestion(state.name || 'Anonymous', text);
  input.value = '';

  // Brief confirmation on submit button
  const submitBtn = $('qa-submit-btn');
  const origText = submitBtn.textContent;
  submitBtn.textContent = 'Sent!';
  submitBtn.disabled = true;
  setTimeout(() => {
    submitBtn.textContent = origText;
    submitBtn.disabled = false;
  }, 1200);
}

function addQAFeedItem({ name, text, hex }, animate = true) {
  const feed = $('qa-feed');
  // Remove placeholder on first real question
  const placeholder = $('qa-feed-placeholder');
  if (placeholder) placeholder.remove();

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

  // Cap DOM at 60 items — Q&A can fill up fast with a full class
  while (feed.children.length > 60) {
    feed.removeChild(feed.firstChild);
  }

  feed.scrollTop = feed.scrollHeight;
}

// ─── Photo/slide compat stub (photos array kept for legacy welcome data) ────
// The actual slide rendering is handled by renderSlide() above.

// ─── Demo reveal ────────────────────────────────────────────────────────────

function appendTerminalLine(name, hex, originalHex) {
  const terminal = $('demo-terminal');

  const line = document.createElement('div');
  line.innerHTML = `
    <span class="terminal-line terminal-line--name" style="--item-color:${escAttr(originalHex)}">${escHtml(name)}</span><span class="terminal-line"> → ${escHtml(originalHex)}</span>
  `;

  terminal.appendChild(line);

  // Keep last 50 log lines. Skip the cursor span (class terminal-cursor)
  // so it doesn't get removed by the trim — it's a visual decoration, not a log line.
  const logLines = [...terminal.children].filter(c => !c.classList.contains('terminal-cursor'));
  while (logLines.length > 50) {
    const oldest = logLines.shift();
    oldest.remove();
  }

  terminal.scrollTop = terminal.scrollHeight;

  // Update counter — show '—' rather than '0' to avoid looking broken at zero
  $('demo-count-number').textContent = state.totalColorChanges > 0 ? state.totalColorChanges : '—';
}

// ─── Confetti ──────────────────────────────────────────────────────────────

let _confettiActive = false;

function triggerConfetti() {
  // Guard against rapid re-trigger (e.g. host switches to demo repeatedly)
  if (_confettiActive) return;
  _confettiActive = true;
  setTimeout(() => { _confettiActive = false; }, 2500);

  const layer = $('confetti-layer');
  const colors = PALETTE_HEXES.slice(0, 20);

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

  // Blur any active input so the keyboard closes on mode switch
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  // Clear dedup sets shortly after mode switch.
  // Immediate clear risks a race: if the server echo arrives in the same tick as the
  // mode switch, the key is gone and the echo would double-add the item to the new feed.
  // A 2s delay ensures any in-flight echo arrives and is correctly deduped before the set clears.
  setTimeout(() => {
    _selfSentTexts.clear();
    _selfSentQAs.clear();
  }, 2000);

  // Mode-specific setup that must run BEFORE the screen appears
  // (used for things that don't depend on the DOM being visible)

  if (mode === 'demo') {
    // Only clear the terminal if it contains only the static placeholder text.
    // On reconnect, real color log lines may already be present — don't wipe those.
    // We detect "placeholder-only" by checking if there are no `.terminal-line--name`
    // elements (those only appear once real color events have been appended).
    const terminal = $('demo-terminal');
    if (terminal) {
      const hasRealLines = terminal.querySelector('.terminal-line--name');
      if (!hasRealLines) {
        terminal.innerHTML = '<span class="terminal-cursor" aria-hidden="true"></span>';
      }
    }
  }

  if (mode === 'color') {
    // Initialize the bottom strip to the last sent color (if any), or the lobby pick.
    // This ensures re-entering color mode always shows the correct current color.
    const displayHex  = state.lastSentHex  || state.colorHex;
    const displayName = state.lastSentName || state.colorName || displayHex;
    $('sent-color-swatch').style.setProperty('--current-color', displayHex);
    $('sent-color-swatch').style.background = displayHex;
    $('sent-color-name').textContent = displayName;
    $('sent-color-status').textContent = state.lastSentHex
      ? `last sent — tap to change`
      : `your pick — tap a swatch`;
  }

  if (mode === 'ambient') {
    updateAmbientTag();
    setRoomColor(state.roomColorHex);
    // Re-initialize sparkles with the current room color so they glow in the live color,
    // not always in the default Hot Pink they were initialized with at boot time.
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      initSparkles($('sparkle-container'), 18);
    }
  }

  // Sendoff sparkles: respect prefers-reduced-motion
  if (mode === 'sendoff') {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      initSparkles($('sendoff-sparkles'), 40);
    }
  }

  // Color bubble: visible after join in all modes except lobby, color (redundant), sendoff
  const bubbleModes = new Set(['ambient', 'photos', 'text', 'demo', 'qa']);
  setColorBubbleVisible(state.joined && bubbleModes.has(mode));

  const afterSwitch = () => {
    // Counter animation runs AFTER the flash completes so it isn't wasted under the overlay
    if (mode === 'demo') {
      animateCounter();
    }

    // Slides: renderSlide() AFTER the screen is visible so canvas.clientWidth is accurate.
    // If rendered while display:none, clientWidth=0 and fontScale locks to 0.5 (undersized).
    // This is the only place where correct sizing is guaranteed.
    if (mode === 'photos') {
      const safeIdx = Math.max(0, Math.min(state.currentSlide, state.slides.length - 1));
      state.currentSlide = safeIdx;
      renderSlide(state.slides[safeIdx]);
      updateSlidePill();
    }
  };

  if (flash) {
    doModeFlash(() => { showScreen(mode); afterSwitch(); });
  } else {
    showScreen(mode);
    afterSwitch();
  }
}

function showScreen(name) {
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
  // Skip flash for users who prefer reduced motion — call callback immediately
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    callback?.();
    return;
  }

  const flash = $('mode-flash');
  // Remove and re-add class to restart animation even if already running
  flash.className = '';
  flash.style.display = 'block';
  // Force reflow so class removal is applied before we re-add it
  void flash.offsetWidth;
  flash.className = 'mode-flash';

  // Safety timeout: if animationend never fires (CSS disabled, unusual browser),
  // still trigger the callback so the app doesn't get stuck.
  const safetyTimer = setTimeout(() => {
    flash.style.display = 'none';
    callback?.();
  }, 700);

  flash.addEventListener('animationend', () => {
    clearTimeout(safetyTimer);
    flash.style.display = 'none';
    callback?.();
  }, { once: true });
}

// ─── Demo counter animation ─────────────────────────────────────────────────

function animateCounter() {
  const el = $('demo-count-number');
  const target = state.totalColorChanges;
  // Start from current displayed value so re-entering demo doesn't flash to 0.
  // The initial HTML value is '—' so parseInt returns NaN → we fall back to 0.
  const startVal = parseInt(el.textContent, 10) || 0;
  if (startVal >= target) {
    // If genuinely 0 changes, keep showing '—' (not '0') so the screen doesn't
    // look broken in the rare case the demo is entered before anyone has tapped.
    el.textContent = target > 0 ? target : '—';
    return;
  }
  const duration = 2000;
  const startTime = performance.now();

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
    // Connected: show briefly then hide (3s gives students time to notice)
    el.classList.add('visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('visible'), 3000);
  }
}

// ─── Contrast color helper ──────────────────────────────────────────────────
// Returns '#000000' or '#FFFFFF' depending on which provides better contrast
// against the given background hex color (using WCAG relative luminance).

function contrastColor(hex) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return '#000000';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // sRGB linearize
  const lr = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  // WCAG: use white text on dark backgrounds, black text on light backgrounds
  return luminance > 0.179 ? '#000000' : '#FFFFFF';
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
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Offline banner ──────────────────────────────────────────────────────────

function showOfflineBanner(show) {
  const banner = $('offline-banner');
  if (!banner) return;
  banner.style.display = show ? 'block' : 'none';
}

// ─── Mobile keyboard viewport fix ──────────────────────────────────────────
//
// On mobile, when the software keyboard opens, `window.innerHeight` does NOT
// update reliably across browsers. `visualViewport.height` reflects the actual
// visible area. We use it to shrink the app-root so inputs/submit buttons
// don't disappear behind the keyboard.
//
// Applies to text input and Q&A screens where users type.

function initKeyboardFix() {
  if (!window.visualViewport) return; // not supported (rare)

  const appRoot = document.getElementById('app');

  function onViewportResize() {
    const vvHeight = window.visualViewport.height;
    const vvOffset = window.visualViewport.offsetTop;
    // Set app root height to the visible viewport height
    appRoot.style.height = `${vvHeight}px`;
    // Shift app root down if viewport has scrolled (e.g. iOS Safari address bar)
    appRoot.style.transform = `translateY(${vvOffset}px)`;
  }

  function onViewportScroll() {
    onViewportResize();
  }

  window.visualViewport.addEventListener('resize', onViewportResize);
  window.visualViewport.addEventListener('scroll', onViewportScroll);

  // Also scroll active textarea/input into view when focused
  document.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('focus', () => {
      // Give keyboard time to open before scrolling
      setTimeout(() => {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    });
  });
}

// ─── Connection timeout safeguard ───────────────────────────────────────────
// If the WS never connects after 30s, show an actionable message so students
// don't sit forever staring at a "connecting" pill with no explanation.

function initConnectionTimeout() {
  const TIMEOUT_MS = 30_000;
  const timer = setTimeout(() => {
    if (!ws.connected) {
      // Update the offline banner to show a hard error
      const banner = $('offline-banner');
      if (banner && banner.style.display !== 'none') {
        banner.textContent = 'Cannot connect — check your WiFi and reload the page';
        banner.style.display = 'block';
      }
    }
  }, TIMEOUT_MS);

  // Cancel timeout once connected
  ws.addEventListener('connected', () => clearTimeout(timer), { once: true });
}

// ─── Visibility change reconnect ─────────────────────────────────────────────
// iOS Safari can suspend backgrounded tabs. When the student returns to the app,
// the WebSocket may have been silently closed. Force a reconnect attempt on
// visibility restore so the app comes back to life immediately.

function initVisibilityReconnect() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ws.connected) {
      ws.connect();
    }
  });
}

// ─── Go ─────────────────────────────────────────────────────────────────────

boot();
initKeyboardFix();
initConnectionTimeout();
initVisibilityReconnect();
