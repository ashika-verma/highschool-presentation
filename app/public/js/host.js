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
  scriptVisible: true,
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
    // Clamp selectedSlideIndex to valid range in case slides were deleted
    state.selectedSlideIndex = Math.min(
      state.selectedSlideIndex,
      Math.max(0, state.slides.length - 1)
    );
    renderSlidesNav();
    // If the editor panel is currently open, refresh its contents so the saved
    // slides are immediately visible and editable (fixes "save shows nothing" bug).
    const editorPanel = $('slide-editor');
    if (editorPanel && editorPanel.style.display !== 'none') {
      renderSlideFieldEditor();
    }
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
    // Preview label: template type + first content field
    const tpl = slide._template || 'custom';
    const firstText = (slide.elements || []).find(e => e.type === 'text');
    const label = firstText
      ? `${i + 1}. ${firstText.content.slice(0, 22)}`
      : `${i + 1}. [${tpl}]`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.selectedSlideIndex = i;
      renderSlideList();
      renderSlideFieldEditor();
    });
    list.appendChild(btn);
  });
}

// ─── Template system ──────────────────────────────────────────────────────────
//
// Each template defines:
//   id      — internal key stored as slide._template
//   label   — display name shown in the picker
//   icon    — single character or short string for the pill button
//   fields  — ordered array of { key, label, type, placeholder? }
//             type: 'text' | 'textarea' | 'image'
//   compile(fields, bg) → slide data: { bg, elements: [...] }
//   extract(slide) → { fieldKey: value, ... } — reads values back for re-editing

const SLIDE_TEMPLATES = [
  {
    id: 'title',
    label: 'Title',
    icon: 'T',
    fields: [
      { key: 'headline', label: 'Headline', type: 'text',     placeholder: 'Big bold statement' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea', placeholder: 'Supporting line (optional)' },
    ],
    compile(vals, bg) {
      const elements = [];
      if (vals.headline) {
        elements.push({
          type: 'text', content: vals.headline,
          size: 48, weight: 700, color: '#FFFFFF',
          x: 50, y: vals.subtitle ? 44 : 50,
          align: 'center',
        });
      }
      if (vals.subtitle) {
        elements.push({
          type: 'text', content: vals.subtitle,
          size: 20, weight: 400, color: 'rgba(255,255,255,0.65)',
          x: 50, y: 62,
          align: 'center',
        });
      }
      return { bg, elements };
    },
    extract(slide) {
      const els = slide.elements || [];
      const h = els.find(e => e.type === 'text' && e.size >= 40);
      const s = els.find(e => e.type === 'text' && e.size < 40);
      return {
        headline: h?.content || '',
        subtitle: s?.content || '',
      };
    },
  },
  {
    id: 'quote',
    label: 'Quote',
    icon: '"',
    fields: [
      { key: 'quote', label: 'Quote text', type: 'textarea', placeholder: 'The quote, exactly as you want it displayed' },
    ],
    compile(vals, bg) {
      const elements = [];
      if (vals.quote) {
        elements.push({
          type: 'text', content: vals.quote,
          size: 36, weight: 300, color: '#FFFFFF',
          x: 50, y: 50,
          align: 'center',
        });
      }
      return { bg, elements };
    },
    extract(slide) {
      const el = (slide.elements || []).find(e => e.type === 'text');
      return { quote: el?.content || '' };
    },
  },
  {
    id: 'photo-caption',
    label: 'Photo + Caption',
    icon: 'Ph',
    fields: [
      { key: 'src',     label: 'Image path',  type: 'image',    placeholder: '/photos/highschool/filename.jpg' },
      { key: 'caption', label: 'Caption text', type: 'text',     placeholder: 'Short caption below the photo' },
    ],
    compile(vals, bg) {
      const elements = [];
      if (vals.src) {
        elements.push({
          type: 'image', src: vals.src,
          x: 50, y: 44, width: 80,
        });
      }
      if (vals.caption) {
        elements.push({
          type: 'text', content: vals.caption,
          size: 18, weight: 400, color: 'rgba(255,255,255,0.8)',
          x: 50, y: 80,
          align: 'center',
        });
      }
      return { bg, elements };
    },
    extract(slide) {
      const els = slide.elements || [];
      const img = els.find(e => e.type === 'image');
      const txt = els.find(e => e.type === 'text');
      return {
        src:     img?.src     || '',
        caption: txt?.content || '',
      };
    },
  },
  {
    id: 'full-photo',
    label: 'Full Photo',
    icon: 'FP',
    fields: [
      { key: 'src',   label: 'Image path', type: 'image', placeholder: '/photos/highschool/filename.jpg' },
      { key: 'label', label: 'Small label (optional)', type: 'text', placeholder: 'e.g. "MIT Media Lab, 2023"' },
    ],
    compile(vals, bg) {
      const elements = [];
      if (vals.src) {
        elements.push({
          type: 'image', src: vals.src,
          x: 50, y: 50, width: 90,
        });
      }
      if (vals.label) {
        elements.push({
          type: 'text', content: vals.label,
          size: 13, weight: 400, color: 'rgba(255,255,255,0.55)',
          x: 50, y: 90,
          align: 'center',
        });
      }
      return { bg, elements };
    },
    extract(slide) {
      const els = slide.elements || [];
      const img = els.find(e => e.type === 'image');
      const txt = els.find(e => e.type === 'text');
      return {
        src:   img?.src     || '',
        label: txt?.content || '',
      };
    },
  },
  {
    id: 'section-header',
    label: 'Section Header',
    icon: 'S',
    fields: [
      { key: 'eyebrow',  label: 'Eyebrow label', type: 'text', placeholder: 'e.g. PART 2' },
      { key: 'headline', label: 'Headline',       type: 'text', placeholder: 'Big transition text' },
    ],
    compile(vals, bg) {
      const elements = [];
      if (vals.eyebrow) {
        elements.push({
          type: 'text', content: vals.eyebrow.toUpperCase(),
          size: 14, weight: 500, color: 'rgba(255,255,255,0.45)',
          x: 50, y: 35,
          align: 'center',
        });
      }
      if (vals.headline) {
        elements.push({
          type: 'text', content: vals.headline,
          size: 40, weight: 700, color: '#FFFFFF',
          x: 50, y: 50,
          align: 'center',
        });
      }
      return { bg, elements };
    },
    extract(slide) {
      const els = slide.elements || [];
      const small = els.find(e => e.type === 'text' && e.size < 20);
      const big   = els.find(e => e.type === 'text' && e.size >= 20);
      return {
        eyebrow:  small?.content || '',
        headline: big?.content   || '',
      };
    },
  },
];

// State for the template editor: which template is active for the current slide
// (keyed by slide index, so switching slides remembers each slide's template).
const _templateEditorState = new Map(); // slideIndex → { templateId, fieldValues }

function getTemplateById(id) {
  return SLIDE_TEMPLATES.find(t => t.id === id) || null;
}

// ─── renderSlideFieldEditor — main entry point ──────────────────────────────

function renderSlideFieldEditor() {
  const container = $('slide-template-editor');
  if (!container) return;
  container.innerHTML = '';

  const slide = state.slides[state.selectedSlideIndex];
  if (!slide) {
    container.innerHTML = `<p style="font-size:13px;color:var(--color-text-dim);text-align:center;padding:var(--space-4) 0">No slide selected. Add one above.</p>`;
    return;
  }

  // Resolve which template is active:
  // 1. Editor state (user switched template in this session)
  // 2. slide._template (stored on the slide from a previous save)
  // 3. Default: 'title'
  const editorEntry = _templateEditorState.get(state.selectedSlideIndex);
  const activeTemplateId = editorEntry?.templateId || slide._template || 'title';
  const activeTemplate   = getTemplateById(activeTemplateId) || SLIDE_TEMPLATES[0];

  // Current field values: editor state > extract from slide > empty
  const savedValues = editorEntry?.fieldValues || activeTemplate.extract(slide);

  // ── Template picker pills ──────────────────────────────────────────────────
  const pickerRow = document.createElement('div');
  pickerRow.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: var(--space-4);
  `;
  pickerRow.setAttribute('role', 'radiogroup');
  pickerRow.setAttribute('aria-label', 'Slide template');

  SLIDE_TEMPLATES.forEach(tpl => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.role = 'radio';
    pill.setAttribute('aria-checked', tpl.id === activeTemplateId ? 'true' : 'false');
    pill.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 13px;
      border-radius: var(--radius-full);
      border: 1.5px solid ${tpl.id === activeTemplateId ? 'var(--room-color-a)' : 'var(--color-border-hi)'};
      background: ${tpl.id === activeTemplateId ? 'color-mix(in srgb, var(--room-color-a) 18%, var(--color-surface))' : 'var(--color-surface)'};
      color: ${tpl.id === activeTemplateId ? 'var(--color-text)' : 'var(--color-text-muted)'};
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: ${tpl.id === activeTemplateId ? '600' : '400'};
      cursor: pointer;
      transition: border-color 0.12s, background 0.12s, color 0.12s;
      min-height: 36px;
    `;
    // Icon badge
    const iconBadge = document.createElement('span');
    iconBadge.textContent = tpl.icon;
    iconBadge.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: var(--radius-sm);
      background: ${tpl.id === activeTemplateId ? 'var(--room-color-a)' : 'var(--color-surface-2)'};
      color: ${tpl.id === activeTemplateId ? 'var(--room-btn-text, #000)' : 'var(--color-text-muted)'};
      font-size: 9px;
      font-weight: 700;
      font-family: var(--font-mono);
      letter-spacing: 0;
      flex-shrink: 0;
    `;
    pill.appendChild(iconBadge);
    pill.appendChild(document.createTextNode(tpl.label));

    pill.addEventListener('click', () => {
      // Switch template — extract fresh default values from slide for the new template
      const newTemplate = getTemplateById(tpl.id);
      const freshValues = newTemplate ? newTemplate.extract(slide) : {};
      _templateEditorState.set(state.selectedSlideIndex, {
        templateId:  tpl.id,
        fieldValues: freshValues,
      });
      renderSlideFieldEditor();
    });

    pickerRow.appendChild(pill);
  });

  container.appendChild(pickerRow);

  // ── Content fields (template-specific) ────────────────────────────────────
  const fieldsSection = document.createElement('div');
  fieldsSection.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4)';

  // Track current field values as the user types
  const currentValues = { ...savedValues };

  activeTemplate.fields.forEach(field => {
    const fieldWrap = document.createElement('div');
    fieldWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const lbl = document.createElement('label');
    lbl.textContent = field.label;
    lbl.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--color-text-muted);
    `;

    let input;

    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
      input.style.cssText = `
        font-size: 15px;
        background: var(--color-surface-2);
        border: 1.5px solid var(--color-border-hi);
        border-radius: var(--radius-md);
        color: var(--color-text);
        padding: 10px 14px;
        width: 100%;
        resize: vertical;
        font-family: var(--font-sans);
        line-height: 1.5;
        min-height: 72px;
        outline: none;
        transition: border-color 0.12s;
      `;
    } else if (field.type === 'image') {
      // Image field: text input for the path
      input = document.createElement('input');
      input.type = 'text';
      input.style.cssText = `
        font-size: 14px;
        font-family: var(--font-mono);
        background: var(--color-surface-2);
        border: 1.5px solid var(--color-border-hi);
        border-radius: var(--radius-md);
        color: var(--color-text);
        padding: 10px 14px;
        width: 100%;
        outline: none;
        transition: border-color 0.12s;
      `;
    } else {
      // Default: single-line text
      input = document.createElement('input');
      input.type = 'text';
      input.style.cssText = `
        font-size: 15px;
        background: var(--color-surface-2);
        border: 1.5px solid var(--color-border-hi);
        border-radius: var(--radius-md);
        color: var(--color-text);
        padding: 10px 14px;
        width: 100%;
        outline: none;
        transition: border-color 0.12s;
      `;
    }

    input.placeholder = field.placeholder || '';
    input.value = currentValues[field.key] ?? '';
    input.setAttribute('aria-label', field.label);

    // Focus ring
    input.addEventListener('focus', () => { input.style.borderColor = 'var(--room-color-a)'; });
    input.addEventListener('blur',  () => { input.style.borderColor = 'var(--color-border-hi)'; });

    // Live-update currentValues and write compiled elements back to slide.
    // This is intentionally real-time so the data is always up to date before save.
    input.addEventListener('input', () => {
      currentValues[field.key] = input.value;
      // Persist to editor state so switching back to this slide remembers values
      _templateEditorState.set(state.selectedSlideIndex, {
        templateId:  activeTemplateId,
        fieldValues: { ...currentValues },
      });
      // Compile elements into the slide (BG is handled separately below)
      const compiled = activeTemplate.compile(currentValues, slide.bg || '#0A0A10');
      slide.elements  = compiled.elements;
      slide._template = activeTemplateId;
    });

    fieldWrap.appendChild(lbl);
    fieldWrap.appendChild(input);

    // Helper text under image fields
    if (field.type === 'image') {
      const hint = document.createElement('p');
      hint.textContent = 'Must start with /photos/ — e.g. /photos/highschool/nerds.jpg';
      hint.style.cssText = 'font-size:11px;color:var(--color-text-dim);font-family:var(--font-mono);letter-spacing:0.03em;margin-top:2px';
      fieldWrap.appendChild(hint);
    }

    fieldsSection.appendChild(fieldWrap);
  });

  container.appendChild(fieldsSection);

  // ── Background color picker ────────────────────────────────────────────────
  const bgSection = document.createElement('div');
  bgSection.style.cssText = `
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  `;

  const bgLabel = document.createElement('label');
  bgLabel.textContent = 'Background';
  bgLabel.style.cssText = 'font-size:12px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:var(--color-text-muted);white-space:nowrap';

  const bgPicker = document.createElement('input');
  bgPicker.type = 'color';
  bgPicker.id = 'slide-bg-picker';
  bgPicker.value = slide.bg || '#0A0A10';
  bgPicker.style.cssText = `
    width: 44px;
    height: 36px;
    border: 1.5px solid var(--color-border-hi);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    padding: 2px;
  `;

  const bgHexSpan = document.createElement('span');
  bgHexSpan.id = 'slide-bg-hex';
  bgHexSpan.textContent = slide.bg || '#0A0A10';
  bgHexSpan.style.cssText = 'font-family:var(--font-mono);font-size:12px;color:var(--color-text-dim);flex:1';

  bgPicker.addEventListener('input', () => {
    slide.bg = bgPicker.value;
    bgHexSpan.textContent = bgPicker.value;
    // Re-compile with new BG so elements stay in sync
    const compiled = activeTemplate.compile(currentValues, bgPicker.value);
    slide.elements  = compiled.elements;
    slide._template = activeTemplateId;
  });

  // Preset bg swatches — common useful values
  const bgPresets = ['#0A0A10', '#FFFFFF', '#111827', '#1e1b4b', '#14532d', '#7c2d12', '#1e3a5f'];
  const swatchRow = document.createElement('div');
  swatchRow.style.cssText = 'display:flex;gap:5px;align-items:center';
  bgPresets.forEach(hex => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.title = hex;
    swatch.style.cssText = `
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: ${hex};
      border: 1.5px solid ${hex === slide.bg ? 'var(--room-color-a)' : 'rgba(255,255,255,0.15)'};
      cursor: pointer;
      flex-shrink: 0;
      transition: border-color 0.1s;
    `;
    swatch.addEventListener('click', () => {
      bgPicker.value = hex;
      slide.bg = hex;
      bgHexSpan.textContent = hex;
      const compiled = activeTemplate.compile(currentValues, hex);
      slide.elements  = compiled.elements;
      slide._template = activeTemplateId;
      // Update swatch active states
      swatchRow.querySelectorAll('button').forEach(s => {
        s.style.borderColor = s.title === hex ? 'var(--room-color-a)' : 'rgba(255,255,255,0.15)';
      });
    });
    swatchRow.appendChild(swatch);
  });

  bgSection.appendChild(bgLabel);
  bgSection.appendChild(bgPicker);
  bgSection.appendChild(bgHexSpan);
  bgSection.appendChild(swatchRow);
  container.appendChild(bgSection);

  // ── Initial compile — ensure slide data is in sync with template on first render ──
  // This handles the case where a slide was loaded from JSON without _template metadata.
  slide._template = activeTemplateId;
  const initialCompile = activeTemplate.compile(currentValues, slide.bg || '#0A0A10');
  slide.elements = initialCompile.elements;
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
    const newSlide = { id: `slide-${Date.now()}`, bg: '#0A0A10', elements: [], _template: 'title' };
    state.slides.push(newSlide);
    state.selectedSlideIndex = state.slides.length - 1;
    // Clear any stale editor state for this index
    _templateEditorState.delete(state.selectedSlideIndex);
    renderSlideList();
    renderSlideFieldEditor();
  });

  $('slide-delete-btn')?.addEventListener('click', () => {
    if (state.slides.length === 0) return;
    _templateEditorState.delete(state.selectedSlideIndex);
    state.slides.splice(state.selectedSlideIndex, 1);
    state.selectedSlideIndex = Math.max(0, state.selectedSlideIndex - 1);
    if (state.currentSlideIndex >= state.slides.length) {
      state.currentSlideIndex = Math.max(0, state.slides.length - 1);
    }
    renderSlidesNav();
    renderSlideFieldEditor();
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

// Maps modes to substrings of the actual ## headings in talk.md for auto-scroll.
const MODE_MARKERS = {
  lobby:   'Before You Start',
  color:   '0:00',
  ambient: '2:00',
  photos:  '6:30',
  text:    '12:30',
  demo:    '14:00',
  sendoff: '16:00',
  qa:      '~18:00',
};

function renderScript(text) {
  const panel = $('script-panel');
  if (!panel) return;

  const html = text.split('\n').map(line => {
    // Table separator rows  (|---|---|) — skip entirely
    if (/^\|[-| :]+\|$/.test(line.trim())) return '';

    // Table data rows — render in mono so columns read naturally
    if (/^\|.+\|$/.test(line.trim())) {
      return `<div style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-dim);white-space:pre;margin:1px 0">${escHtml(line)}</div>`;
    }

    // Horizontal rule ---
    if (line.trim() === '---') {
      return '<hr style="border:none;border-top:1px solid var(--color-border);margin:10px 0">';
    }

    // # Title
    if (line.startsWith('# ')) {
      return `<div style="font-weight:700;font-size:15px;color:var(--room-color-a);margin:4px 0 8px">${escHtml(line.slice(2))}</div>`;
    }

    // ## Section heading — keyed with data-line for mode auto-scroll
    if (line.startsWith('## ')) {
      const heading = line.slice(3);
      return `<div data-line="${escHtml(heading)}" style="font-weight:700;font-size:var(--text-sm);color:var(--color-text);margin-top:16px;margin-bottom:4px">${escHtml(heading)}</div>`;
    }

    // > Blockquote — spoken words
    if (line.startsWith('> ')) {
      const inner = escHtml(line.slice(2))
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/_(.+?)_/g, '<em>$1</em>');
      return `<div style="border-left:2px solid var(--room-color-a);padding:3px 10px;margin:3px 0;color:var(--color-text);font-size:14px;line-height:1.65">${inner}</div>`;
    }

    // > alone — blank line inside blockquote
    if (line.trim() === '>') return '<div style="height:4px"></div>';

    // Blank line
    if (line.trim() === '') return '<div style="height:6px"></div>';

    // Stage direction: _[text]_ or _text_ on its own line
    const stageMatch = line.match(/^_(.+)_$/);
    if (stageMatch) {
      return `<div style="font-style:italic;color:var(--color-text-dim);font-size:11px;margin:2px 0">${escHtml(stageMatch[1])}</div>`;
    }

    // Normal line — bold + italic inline
    const rendered = escHtml(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>');
    return `<div style="margin:1px 0;color:var(--color-text-muted)">${rendered}</div>`;
  }).join('');

  panel.innerHTML = html;
}

function scrollScriptToMode(mode) {
  const panel = $('script-panel');
  if (!panel || !state.scriptVisible) return;
  const marker = MODE_MARKERS[mode];
  if (!marker) return;
  // Find the first heading whose text contains the marker substring
  for (const el of panel.querySelectorAll('[data-line]')) {
    if (el.dataset.line.includes(marker)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
}

async function loadScript() {
  try {
    const res = await fetch('/api/script');
    if (res.ok) {
      state.scriptContent = await res.text();
      renderScript(state.scriptContent);
      scrollScriptToMode(state.currentMode);
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

  function setScriptVisible(visible) {
    state.scriptVisible = visible;
    if (section) section.style.display = visible ? 'block' : 'none';
    if (toggleBtn) {
      const label = visible ? 'Hide Script' : 'Script';
      toggleBtn.innerHTML = `<span>${label}</span><span style="font-family:var(--font-mono);font-size:9px;opacity:0.5;margin-left:5px;letter-spacing:0.04em">/</span>`;
      toggleBtn.setAttribute('aria-expanded', String(visible));
    }
    if (visible) scrollScriptToMode(state.currentMode);
  }

  // Apply initial state
  setScriptVisible(state.scriptVisible);

  function toggleScript() { setScriptVisible(!state.scriptVisible); }

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
