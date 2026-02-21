/**
 * host.js — Host Dashboard Controller
 *
 * Auth: simple query param ?key=XXX, compared against env var HOST_KEY.
 * The server validates the key on the WebSocket handshake headers for
 * privileged message types (mode_change, host_color). Plain JS auth
 * gate here is UX sugar — real security is server-side.
 *
 * All host actions send to the server, which broadcasts to students.
 */

import { ws } from './ws-client.js';
import { PALETTE, deriveDitherPair, findByHex } from './palette.js';

// ─── Auth ──────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const KEY = params.get('key') || '';

// Host state
const state = {
  authed: false,
  currentMode: 'lobby',
  studentCount: 0,
  totalColors: 0,
  reactionCounts: { '👀': 0, '💡': 0, '🔥': 0, '😮': 0 },
  students: new Map(), // name → { hex, colorsSent }
  questions: [],
  textResponses: [],
  roomColorHex: '#FF6EB4',
  hostKey: KEY,
};

const $ = id => document.getElementById(id);

// ─── Boot ──────────────────────────────────────────────────────────────────

function boot() {
  // Check for key in URL first
  if (KEY) {
    attemptAuth(KEY);
  } else {
    showAuthGate();
  }

  $('auth-form').addEventListener('submit', e => {
    e.preventDefault();
    const key = $('auth-input').value.trim();
    attemptAuth(key);
  });
}

function attemptAuth(key) {
  // Send auth attempt to server via HTTP before upgrading to WS
  fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
    .then(r => {
      if (r.ok) {
        state.authed = true;
        state.hostKey = key;
        showDashboard();
        connectHost();
      } else {
        showAuthError();
      }
    })
    .catch(() => {
      // Network error (server unreachable) — show error rather than bypassing auth
      const err = $('auth-error');
      err.textContent = 'Cannot reach server. Is it running?';
      err.style.display = 'block';
    });
}

function showAuthGate() {
  $('auth-gate').style.display = 'flex';
  $('host-dashboard').style.display = 'none';
}

function showDashboard() {
  $('auth-gate').style.display = 'none';
  $('host-dashboard').style.display = 'block';
}

function showAuthError() {
  const err = $('auth-error');
  err.style.display = 'block';
  $('auth-input').value = '';
  $('auth-input').focus();
}

// ─── WebSocket ─────────────────────────────────────────────────────────────

function connectHost() {
  ws.connect();

  ws.addEventListener('connected', () => {
    const pill = $('host-status-pill');
    pill.textContent = '● live';
    pill.classList.add('is-live');
    pill.style.color = '';  // let CSS class handle it

    // Announce as host
    ws.send({ type: 'host_join', key: state.hostKey });
  });

  ws.addEventListener('disconnected', () => {
    const pill = $('host-status-pill');
    pill.textContent = '● offline';
    pill.classList.remove('is-live');
    pill.style.color = '#ff6b6b';
  });

  ws.onMessage('welcome', (data) => {
    if (data.count !== undefined) updateStudentCount(data.count);
    if (data.mode) setActiveMode(data.mode);
    if (data.totalColorChanges !== undefined) {
      state.totalColors = data.totalColorChanges;
      $('host-color-count').textContent = state.totalColors;
    }
    if (data.students) {
      data.students.forEach(s => {
        state.students.set(s.name, { hex: s.hex, colorsSent: s.colorsSent || 0 });
      });
      renderStudentList();
    }
    if (data.roomColor) setRoomColor(data.roomColor);
    if (data.questions) {
      data.questions.forEach(q => addQuestion(q, false));
    }
    if (data.textResponses) {
      data.textResponses.forEach(r => addTextResponse(r, false));
    }
  });

  ws.onMessage('join', (data) => {
    updateStudentCount(data.count);
    if (data.name) {
      state.students.set(data.name, { hex: data.hex, colorsSent: 0 });
      renderStudentList();
    }
  });

  ws.onMessage('leave', (data) => {
    updateStudentCount(data.count);
    if (data.name && data.name !== '__host__') {
      state.students.delete(data.name);
      renderStudentList();
    }
  });

  ws.onMessage('color', (data) => {
    state.totalColors++;
    $('host-color-count').textContent = state.totalColors;
    setRoomColor(data.hex);

    if (state.students.has(data.name)) {
      state.students.get(data.name).colorsSent++;
      // Update just the count cell for this student — don't rebuild the whole list
      const list = $('student-list');
      const rows = list.querySelectorAll('.student-row');
      rows.forEach(row => {
        const nameEl = row.querySelector('.student-name');
        if (nameEl && nameEl.textContent === data.name) {
          const countEl = row.querySelector('.student-count');
          if (countEl) countEl.textContent = `${state.students.get(data.name).colorsSent} sent`;
        }
      });
    }
  });

  ws.onMessage('reaction', (data) => {
    bumpReaction(data.emoji);
  });

  ws.onMessage('question', (data) => {
    addQuestion(data);
  });

  ws.onMessage('text_response', (data) => {
    addTextResponse(data);
  });

  ws.onMessage('mode', (data) => {
    setActiveMode(data.mode);
  });
}

// ─── Mode switching ─────────────────────────────────────────────────────────

function wireModeBtns() {
  document.querySelectorAll('.host-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      ws.send({ type: 'mode', mode, key: state.hostKey });
      setActiveMode(mode);
    });
  });
}

function setActiveMode(mode) {
  state.currentMode = mode;
  document.querySelectorAll('.host-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

// ─── Color picker ───────────────────────────────────────────────────────────

function renderHostColorGrid() {
  const grid = $('host-color-grid');
  grid.innerHTML = '';

  PALETTE.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch';
    btn.style.setProperty('--swatch-color', color.hex);
    btn.setAttribute('aria-label', color.name);
    btn.dataset.hex = color.hex;
    btn.dataset.name = color.name;
    btn.dataset.colorB = color.colorB;

    btn.addEventListener('click', () => hostPickColor(color, btn));
    grid.appendChild(btn);
  });
}

function hostPickColor(color, btn) {
  $('host-color-grid').querySelectorAll('.color-swatch').forEach(s =>
    s.classList.remove('selected')
  );
  btn.classList.add('selected');

  $('host-picked-swatch').style.background = color.hex;
  $('host-picked-label').textContent = color.name;

  // Send host color directly — bypasses student voting
  ws.send({ type: 'host_color', hex: color.hex, key: state.hostKey });
  setRoomColor(color.hex);
}

// ─── Room color display ──────────────────────────────────────────────────────

function setRoomColor(hex) {
  state.roomColorHex = hex;
  const colorB = findByHex(hex)?.colorB ?? deriveDitherPair(hex);
  const bar = $('host-room-color-bar');
  bar.style.setProperty('--room-color-a', hex);
  bar.style.setProperty('--room-color-b', colorB);
  $('host-room-color-label').textContent = hex;
}

// ─── Student list ────────────────────────────────────────────────────────────

function updateStudentCount(count) {
  state.studentCount = count;
  $('host-student-count').textContent = count;
}

function renderStudentList() {
  const list = $('student-list');

  if (state.students.size === 0) {
    list.innerHTML = `<p style="font-family:var(--font-pixel);font-size:var(--text-xs);color:rgba(255,255,255,0.3)">Waiting for students...</p>`;
    return;
  }

  list.innerHTML = '';

  state.students.forEach((data, name) => {
    const row = document.createElement('div');
    row.className = 'student-row';
    row.innerHTML = `
      <div class="student-dot" style="background:${escHtml(data.hex)}; color:${escHtml(data.hex)}"></div>
      <span class="student-name">${escHtml(name)}</span>
      <span class="student-count">${data.colorsSent} sent</span>
    `;
    list.appendChild(row);
  });
}

// ─── Reactions ───────────────────────────────────────────────────────────────

const pulseBars = {
  '👀': { bar: 'pulse-bar-eyes',  attr: '👀' },
  '💡': { bar: 'pulse-bar-bulb',  attr: '💡' },
  '🔥': { bar: 'pulse-bar-fire',  attr: '🔥' },
  '😮': { bar: 'pulse-bar-wow',   attr: '😮' },
};

let reactionMaxSeen = 1;

function bumpReaction(emoji) {
  state.reactionCounts[emoji] = (state.reactionCounts[emoji] || 0) + 1;
  const total = state.reactionCounts[emoji];

  // Update count badge
  document.querySelectorAll(`[data-pulse-emoji="${emoji}"]`).forEach(el => {
    el.textContent = total;
  });

  // Update max for relative bar sizing
  reactionMaxSeen = Math.max(reactionMaxSeen, total);

  // Update all bars proportionally
  Object.entries(pulseBars).forEach(([em, { bar }]) => {
    const count = state.reactionCounts[em] || 0;
    const pct = Math.round((count / reactionMaxSeen) * 100);
    const barEl = $(bar);
    if (barEl) barEl.style.width = `${pct}%`;
  });
}

// ─── Questions ───────────────────────────────────────────────────────────────

function addQuestion({ name, text, hex }, animate = true) {
  state.questions.push({ name, text, hex });
  $('host-q-count').textContent = state.questions.length;
  $('q-count-display').textContent = state.questions.length;

  const queue = $('question-queue');

  // Clear placeholder
  if (state.questions.length === 1) queue.innerHTML = '';

  const item = document.createElement('div');
  item.className = 'question-item';

  item.innerHTML = `
    <div class="question-item__info">
      <div class="question-item__name" style="color:${escHtml(hex || '#FF6EB4')}">${escHtml(name)}</div>
      <div class="question-item__text">${escHtml(text)}</div>
    </div>
    <button class="question-call-btn" aria-label="Call on ${escHtml(name)}">Call on →</button>
  `;

  const callBtn = item.querySelector('.question-call-btn');
  callBtn.addEventListener('click', () => {
    item.classList.add('called');
    callBtn.textContent = '✓ called';
    callBtn.disabled = true;
  });

  queue.appendChild(item);
  queue.scrollTop = queue.scrollHeight;
}

// ─── Text responses ──────────────────────────────────────────────────────────

function addTextResponse({ name, text, hex }, animate = true) {
  state.textResponses.push({ name, text, hex });

  const feed = $('host-text-feed');

  if (state.textResponses.length === 1) feed.innerHTML = '';

  const item = document.createElement('div');
  item.className = 'text-preview-item';
  item.style.setProperty('--item-color', hex || '#FF6EB4');
  item.innerHTML = `<strong>${escHtml(name)}:</strong> ${escHtml(text)}`;

  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Boot ────────────────────────────────────────────────────────────────────

boot();
wireModeBtns();
renderHostColorGrid();
