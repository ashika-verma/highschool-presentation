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
  // Slides
  slides: [],
  currentSlideIndex: 0,
  selectedSlideIndex: 0,
  // Script
  scriptVisible: false,
  scriptContent: '',
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
        // Strip the key from the URL bar — prevents shoulder-surfing and
        // accidental sharing of the URL with the key visible.
        history.replaceState({}, '', '/host');
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
    pill.textContent = 'live';
    pill.classList.add('is-live');
    pill.style.color = '';  // let CSS class handle it

    // Announce as host
    ws.send({ type: 'host_join', key: state.hostKey });
  });

  ws.addEventListener('disconnected', () => {
    const pill = $('host-status-pill');
    pill.textContent = 'offline';
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
    if (data.reactionCounts) {
      // Restore cumulative reaction counts from server so host reconnect shows accurate totals
      Object.entries(data.reactionCounts).forEach(([emoji, count]) => {
        state.reactionCounts[emoji] = count;
        document.querySelectorAll(`[data-pulse-emoji="${emoji}"]`).forEach(el => {
          el.textContent = count;
          if (count > 0) el.classList.add('has-count');
        });
      });
      // Recalculate max for bar sizing
      reactionMaxSeen = Math.max(1, ...Object.values(state.reactionCounts));
      // Re-render all bars
      Object.entries(pulseBars).forEach(([em, { bar }]) => {
        const count = state.reactionCounts[em] || 0;
        const pct = Math.round((count / reactionMaxSeen) * 100);
        const barEl = $(bar);
        if (barEl) barEl.style.width = `${pct}%`;
      });
    }
    if (data.questions) {
      data.questions.forEach(q => addQuestion(q, false));
    }
    if (data.textResponses) {
      data.textResponses.forEach(r => addTextResponse(r, false));
    }
    if (data.slides !== undefined) {
      state.slides = data.slides;
      state.currentSlideIndex = data.currentSlideIndex ?? 0;
      renderSlidesNav();
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

  // Server echoes slide_goto back to all clients including host — sync host UI
  // in case server clamped the index to a valid range.
  ws.onMessage('slide_goto', (data) => {
    state.currentSlideIndex = data.index;
    renderSlidesNav();
  });

  // Server echoes slides_updated after save — sync host state
  ws.onMessage('slides_updated', (data) => {
    state.slides = data.slides;
    state.currentSlideIndex = data.currentSlideIndex ?? 0;
    renderSlidesNav();
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
  // Update CSS root vars so active mode buttons use correct contrast text.
  // Also set --room-color-b so the room-color-bar gradient second stop updates —
  // without this, the bar gradient always ends at the initial #FFB3D9.
  document.documentElement.style.setProperty('--room-color-a', hex);
  document.documentElement.style.setProperty('--room-color-b', colorB);
  document.documentElement.style.setProperty('--room-btn-text', contrastColor(hex));
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
    // data.hex is already sanitized by the server (sanitizeHex enforces #RRGGBB format)
    // Use it directly for CSS values — escHtml is not appropriate for CSS contexts
    const safeHex = /^#[0-9A-Fa-f]{6}$/.test(data.hex) ? data.hex : '#888888';
    row.innerHTML = `
      <div class="student-dot" style="background:${safeHex}; color:${safeHex}"></div>
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
    el.classList.add('has-count');
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

  // hex is server-sanitized (#RRGGBB); use directly in CSS, not escHtml (wrong context)
  const safeHex = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#FF6EB4';
  item.innerHTML = `
    <div class="question-item__info">
      <div class="question-item__name" style="color:${safeHex}">${escHtml(name)}</div>
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

  // Cap DOM at 100 question items — prevents unbounded growth in long sessions
  while (queue.children.length > 100) {
    queue.removeChild(queue.firstChild);
  }

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

  // Cap DOM at 80 text response items
  while (feed.children.length > 80) {
    feed.removeChild(feed.firstChild);
  }

  feed.scrollTop = feed.scrollHeight;
}

// ─── Contrast helper (mirrors app.js) ────────────────────────────────────────
// Returns '#000000' or '#FFFFFF' for readable text on the given background.

function contrastColor(hex) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return '#000000';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lr = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  return luminance > 0.179 ? '#000000' : '#FFFFFF';
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

// ─── Slides ──────────────────────────────────────────────────────────────────

function renderSlidesNav() {
  const total = state.slides.length;
  const idx = state.currentSlideIndex;
  const label = $('slide-index-label');
  if (label) {
    label.textContent = total === 0 ? 'No slides' : `Slide ${idx + 1} / ${total}`;
  }
  renderSlideList();
}

function renderSlideList() {
  const list = $('slide-list');
  if (!list) return;
  list.innerHTML = '';
  state.slides.forEach((slide, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn-pixel btn-pixel--sm';
    btn.style.textAlign = 'left';
    btn.style.fontSize = '11px';
    btn.style.padding = '6px 10px';
    btn.style.background = i === state.selectedSlideIndex
      ? 'var(--color-surface-2)'
      : 'var(--color-surface)';
    btn.style.borderColor = i === state.selectedSlideIndex
      ? 'var(--room-color-a)'
      : 'var(--color-border)';
    // Preview: first text element content or slide id
    const firstText = (slide.elements || []).find(e => e.type === 'text');
    btn.textContent = firstText
      ? `${i + 1}. ${firstText.content.slice(0, 24)}`
      : `${i + 1}. (slide)`;
    btn.addEventListener('click', () => {
      state.selectedSlideIndex = i;
      renderSlideList();
      renderSlideFieldEditor();
    });
    list.appendChild(btn);
  });
}

function renderSlideFieldEditor() {
  const slide = state.slides[state.selectedSlideIndex];
  const bgPicker = $('slide-bg-picker');
  const bgHex = $('slide-bg-hex');
  if (!slide) {
    const el = $('slide-element-list');
    if (el) el.innerHTML = '<p style="font-size:11px;color:var(--color-text-dim)">No slide selected</p>';
    return;
  }
  if (bgPicker) {
    bgPicker.value = slide.bg || '#0A0A10';
    if (bgHex) bgHex.textContent = slide.bg || '#0A0A10';
    bgPicker.oninput = () => {
      slide.bg = bgPicker.value;
      if (bgHex) bgHex.textContent = bgPicker.value;
    };
  }
  renderElementList(slide);
}

function renderElementList(slide) {
  const list = $('slide-element-list');
  if (!list) return;
  list.innerHTML = '';
  (slide.elements || []).forEach((el, i) => {
    const row = document.createElement('div');
    row.style.cssText = `
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
    header.innerHTML = `<span style="font-family:var(--font-mono);color:var(--color-text-muted);font-size:10px">${el.type.toUpperCase()} ${i + 1}</span>`;
    const delBtn = document.createElement('button');
    delBtn.textContent = 'x';
    delBtn.style.cssText = 'font-size:11px;color:#ff6b6b;background:none;border:none;cursor:pointer;padding:0 4px';
    delBtn.addEventListener('click', () => {
      slide.elements.splice(i, 1);
      renderElementList(slide);
    });
    header.appendChild(delBtn);
    row.appendChild(header);

    if (el.type === 'text') {
      row.appendChild(makeField('Content', el.content, v => { el.content = v; }));
      row.appendChild(makeFieldRow([
        ['Size', el.size, v => { el.size = parseInt(v) || 20; }, 'number', 60],
        ['Weight', el.weight, v => { el.weight = parseInt(v) || 400; }, 'number', 60],
      ]));
      row.appendChild(makeFieldRow([
        ['X%', el.x, v => { el.x = parseFloat(v) || 50; }, 'number', 60],
        ['Y%', el.y, v => { el.y = parseFloat(v) || 50; }, 'number', 60],
      ]));
      row.appendChild(makeColorField('Color', el.color, v => { el.color = v; }));
    } else if (el.type === 'image') {
      row.appendChild(makeField('Src path (/photos/...)', el.src, v => { el.src = v; }));
      row.appendChild(makeFieldRow([
        ['X%', el.x, v => { el.x = parseFloat(v) || 50; }, 'number', 60],
        ['Y%', el.y, v => { el.y = parseFloat(v) || 50; }, 'number', 60],
        ['Width%', el.width, v => { el.width = parseFloat(v) || 80; }, 'number', 60],
      ]));
    }

    list.appendChild(row);
  });
}

function makeField(label, value, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:10px;color:var(--color-text-dim)';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value ?? '';
  inp.style.cssText = 'font-size:12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text);padding:4px 8px;width:100%';
  inp.addEventListener('input', () => onChange(inp.value));
  wrap.appendChild(lbl);
  wrap.appendChild(inp);
  return wrap;
}

function makeFieldRow(fields) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px';
  fields.forEach(([label, value, onChange, type, w]) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex;flex-direction:column;gap:2px;width:${w || 80}px`;
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:10px;color:var(--color-text-dim)';
    const inp = document.createElement('input');
    inp.type = type || 'text';
    inp.value = value ?? '';
    inp.style.cssText = 'font-size:12px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;color:var(--color-text);padding:4px 6px;width:100%';
    inp.addEventListener('input', () => onChange(inp.value));
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    row.appendChild(wrap);
  });
  return row;
}

function makeColorField(label, value, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:10px;color:var(--color-text-dim);white-space:nowrap';
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = value || '#ffffff';
  inp.style.cssText = 'width:36px;height:28px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);cursor:pointer';
  const hexSpan = document.createElement('span');
  hexSpan.textContent = value || '#ffffff';
  hexSpan.style.cssText = 'font-family:var(--font-mono);font-size:10px;color:var(--color-text-dim)';
  inp.addEventListener('input', () => {
    hexSpan.textContent = inp.value;
    onChange(inp.value);
  });
  wrap.appendChild(lbl);
  wrap.appendChild(inp);
  wrap.appendChild(hexSpan);
  return wrap;
}

function wireSlidesUI() {
  $('slide-prev-btn')?.addEventListener('click', () => {
    if (state.slides.length === 0) return;
    const idx = Math.max(0, state.currentSlideIndex - 1);
    state.currentSlideIndex = idx;
    ws.send({ type: 'slide_goto', index: idx, key: state.hostKey });
    renderSlidesNav();
  });

  $('slide-next-btn')?.addEventListener('click', () => {
    if (state.slides.length === 0) return;
    const idx = Math.min(state.slides.length - 1, state.currentSlideIndex + 1);
    state.currentSlideIndex = idx;
    ws.send({ type: 'slide_goto', index: idx, key: state.hostKey });
    renderSlidesNav();
  });

  $('slide-editor-toggle')?.addEventListener('click', () => {
    const editor = $('slide-editor');
    const btn = $('slide-editor-toggle');
    if (!editor) return;
    const open = editor.style.display === 'none';
    editor.style.display = open ? 'block' : 'none';
    btn.textContent = open ? 'Hide Editor' : 'Edit Slides';
    if (open) renderSlideFieldEditor();
  });

  $('slide-add-btn')?.addEventListener('click', () => {
    state.slides.push({ id: `slide-${Date.now()}`, bg: '#0A0A10', elements: [] });
    state.selectedSlideIndex = state.slides.length - 1;
    renderSlideList();
    renderSlideFieldEditor();
  });

  $('slide-delete-btn')?.addEventListener('click', () => {
    if (state.slides.length === 0) return;
    state.slides.splice(state.selectedSlideIndex, 1);
    state.selectedSlideIndex = Math.max(0, state.selectedSlideIndex - 1);
    if (state.currentSlideIndex >= state.slides.length) {
      state.currentSlideIndex = Math.max(0, state.slides.length - 1);
    }
    renderSlidesNav();
    renderSlideFieldEditor();
  });

  $('slide-add-text-btn')?.addEventListener('click', () => {
    const slide = state.slides[state.selectedSlideIndex];
    if (!slide) return;
    if (!slide.elements) slide.elements = [];
    slide.elements.push({ type: 'text', content: 'New text', size: 24, color: '#FFFFFF', x: 50, y: 50, align: 'center', weight: 400 });
    renderElementList(slide);
  });

  $('slide-add-img-btn')?.addEventListener('click', () => {
    const slide = state.slides[state.selectedSlideIndex];
    if (!slide) return;
    if (!slide.elements) slide.elements = [];
    slide.elements.push({ type: 'image', src: '/photos/highschool/', x: 50, y: 50, width: 80 });
    renderElementList(slide);
  });

  $('slide-save-btn')?.addEventListener('click', async () => {
    const btn = $('slide-save-btn');
    const status = $('slide-save-status');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await fetch(`/api/slides?key=${encodeURIComponent(state.hostKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.slides),
      });
      if (res.ok) {
        if (status) status.textContent = 'Saved!';
        // Tell server to reload and broadcast to students
        ws.send({ type: 'slides_reload', key: state.hostKey });
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
      } else {
        if (status) status.textContent = 'Save failed';
      }
    } catch {
      if (status) status.textContent = 'Network error';
    }
    btn.disabled = false;
    btn.textContent = 'Save Slides';
  });
}

// ─── Teleprompter / Script ────────────────────────────────────────────────────

// Maps mode names to section markers in the script.
// The script should contain lines like "[→ COLOR MODE]" for auto-scroll.
const MODE_MARKERS = {
  lobby:   '[→ LOBBY]',
  color:   '[→ COLOR MODE]',
  ambient: '[→ AMBIENT]',
  photos:  '[→ PHOTOS]',
  text:    '[→ TEXT]',
  demo:    '[→ DEMO]',
  qa:      '[→ Q&A]',
  sendoff: '[→ SENDOFF]',
};

function renderScript(text) {
  const panel = $('script-panel');
  if (!panel) return;

  // Simple markdown-lite render: bold, headers, mode markers, linebreaks
  const html = text
    .split('\n')
    .map(line => {
      // Mode markers — highlight them
      const isMarker = Object.values(MODE_MARKERS).some(m => line.includes(m));
      if (isMarker) {
        return `<div class="script-mode-marker" data-line="${escHtml(line)}" style="
          font-family:var(--font-mono);
          font-size:10px;
          letter-spacing:0.08em;
          color:var(--room-color-a);
          background:color-mix(in srgb, var(--room-color-a) 10%, transparent);
          border-radius:4px;
          padding:2px 8px;
          margin:8px 0 4px;
          display:inline-block;
        ">${escHtml(line)}</div>`;
      }
      // Headers
      if (line.startsWith('# ')) {
        return `<div style="font-weight:700;font-size:var(--text-sm);color:var(--color-text);margin-top:12px">${escHtml(line.slice(2))}</div>`;
      }
      if (line.startsWith('## ')) {
        return `<div style="font-weight:600;font-size:13px;color:var(--color-text);margin-top:8px">${escHtml(line.slice(3))}</div>`;
      }
      // Bold
      const boldLine = escHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (line.trim() === '') return '<div style="height:8px"></div>';
      return `<div style="margin:1px 0">${boldLine}</div>`;
    })
    .join('');

  panel.innerHTML = html;
}

function scrollScriptToMode(mode) {
  const panel = $('script-panel');
  if (!panel || !state.scriptVisible) return;
  const marker = MODE_MARKERS[mode];
  if (!marker) return;
  const el = panel.querySelector(`[data-line="${escHtml(marker)}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function loadScript() {
  try {
    const res = await fetch('/api/script');
    if (res.ok) {
      state.scriptContent = await res.text();
      renderScript(state.scriptContent);
    } else {
      const panel = $('script-panel');
      if (panel) panel.innerHTML = '<p style="font-style:italic;color:var(--color-text-dim);font-size:13px">No script file found (create script/talk.md)</p>';
    }
  } catch {
    const panel = $('script-panel');
    if (panel) panel.innerHTML = '<p style="color:#ff6b6b;font-size:13px">Error loading script</p>';
  }
}

function wireScriptUI() {
  const toggleBtn = $('script-toggle-btn');
  const section = $('script-section');

  function toggleScript() {
    state.scriptVisible = !state.scriptVisible;
    if (section) section.style.display = state.scriptVisible ? 'block' : 'none';
    if (toggleBtn) {
      // Reconstruct innerHTML to preserve the "/" hint span — setting textContent
      // would blow away the child spans and permanently lose the "/" indicator.
      const label = state.scriptVisible ? 'Hide Script' : 'Script';
      toggleBtn.innerHTML = `<span>${label}</span><span style="font-family:var(--font-mono);font-size:9px;opacity:0.5;margin-left:5px;letter-spacing:0.04em">/</span>`;
      toggleBtn.setAttribute('aria-expanded', String(state.scriptVisible));
    }
    if (state.scriptVisible) {
      scrollScriptToMode(state.currentMode);
    }
  }

  toggleBtn?.addEventListener('click', toggleScript);

  // Keyboard shortcut: / toggles the teleprompter
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement === document.body) {
      e.preventDefault();
      toggleScript();
    }
  });
}

// Override setActiveMode to also scroll script and update slide label
const _origSetActiveMode = setActiveMode;
function setActiveModeWithExtras(mode) {
  _origSetActiveMode(mode);
  scrollScriptToMode(mode);
  // Update mode label in script section
  const modeLabel = $('script-mode-label');
  if (modeLabel) modeLabel.textContent = `[→ ${mode.toUpperCase()}]`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

boot();
wireModeBtns();
renderHostColorGrid();
wireSlidesUI();
wireScriptUI();
loadScript();

// Override setActiveMode after wireModeBtns so our wrapper runs
// (wireModeBtns captures setActiveMode, so we patch the ws listener directly)
ws.onMessage('mode', (data) => {
  setActiveMode(data.mode);
  scrollScriptToMode(data.mode);
  const modeLabel = $('script-mode-label');
  if (modeLabel) modeLabel.textContent = `[→ ${data.mode.toUpperCase()}]`;
});
