# AGENTS.md — High School Presentation App

## Overview

A 20-minute interactive presentation app for high school women interested in coding. Students join via QR code and can control WiZ LED lights, see slides, react with emojis, submit text responses and questions.

## Tech Stack

- **Backend**: Node.js (v18+), vanilla HTTP + WebSocket server
- **Frontend**: Vanilla JS with ES modules, HTML, CSS
- **No frameworks** — direct DOM manipulation
- **No build step** — served directly by Node.js

## Project Structure

```
app/
├── server/
│   └── server.js          # HTTP + WebSocket server (CommonJS)
├── public/
│   ├── index.html         # Student app
│   ├── host.html          # Host dashboard
│   ├── js/
│   │   ├── app.js         # Student app controller
│   │   ├── host.js        # Host dashboard controller
│   │   ├── ws-client.js   # WebSocket singleton
│   │   ├── palette.js     # 30-color palette
│   │   └── icons.js       # SVG icons
│   └── css/
├── data/
│   └── slides.json        # Slide content (edited via host dashboard)
├── package.json
└── SETUP.md

script/
└── talk.md                # Presentation script

photos/
├── highschool/            # CSHS photos
└── college/              # MIT photos
```

## Commands

### Running the App

```bash
cd app

# Production
npm start

# Development (no WiZ bulbs)
npm run dev
# Or manually:
HOST_KEY=ashika WIZ_IPS='' node server/server.js
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `HOST_KEY` | Host authentication key | `ashika` |
| `WIZ_IPS` | Comma-separated WiZ bulb IPs | (auto-discover) |
| `WIZ_BROADCAST` | UDP broadcast address | `192.168.1.255` |

### No Linting/Testing Configured

This project has no configured linters or test frameworks. If adding tests:

- **Server tests**: Use `node:test` (built-in) or Jest
- **Frontend tests**: Use Vitest with jsdom
- Run a single test file: `node --test test/file.test.js` or `npx jest path/to/test.js`

## Code Style

### Language

- **Server**: CommonJS (`require`, `module.exports`)
- **Frontend**: ES Modules (`import`, `export`)
- **No TypeScript** — plain JavaScript only

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables/functions | camelCase | `renderSlide()`, `clientCount` |
| Constants | UPPER_SNAKE_CASE | `COLOR_RATE_MS`, `WIZ_PORT` |
| DOM element refs | `$` prefix + camelCase | `$('slide-canvas')`, `const $ = id => document.getElementById(id)` |
| State objects | camelCase | `appState`, `state.slides` |
| CSS classes | kebab-case | `.slide-element-text`, `.color-swatch` |

### File Organization

1. **JSDoc header** — Brief purpose, architecture notes
2. **Config/constants** — Top of file
3. **State** — App state object
4. **Functions** — Grouped by feature (slides, WiZ, HTTP, WS)
5. **Boot/initialization** — End of file

### Error Handling

- **Server**: `console.warn()` for recoverable issues, `console.error()` for failures
- **Frontend**: `console.warn()` for non-critical issues
- **JSON.parse**: Always wrap in try/catch
- **WebSocket**: Log errors, don't expose internals to client

### Security

- **Input sanitization**: All user input sanitized (XSS prevention via `sanitize()`, `sanitizeHex()`, `sanitizeEmoji()`)
- **Path traversal**: Validate paths stay within allowed directories
- **Rate limiting**: Per-client rate limits on color changes (300ms), questions (5s), text (8s)
- **Auth**: Host key validated server-side for privileged operations

### HTML/Template

- Use `textContent` instead of `innerHTML` for user data (XSS guard)
- Use `escHtml()` and `escAttr()` helper functions when innerHTML is needed
- Semantic HTML with ARIA attributes for accessibility

### CSS

- CSS custom properties (variables) for theming
- Mobile-first responsive design
- Use `rem` for spacing, `px` for borders/shadows
- Respect `prefers-reduced-motion`

### Specific Patterns

**WebSocket messages (server → client)**:
```javascript
// Server broadcasts
broadcast({ type: 'mode', mode });
```

**WebSocket handlers (client)**:
```javascript
ws.onMessage('mode', ({ mode }) => { switchMode(mode); });
```

**State updates with DOM**:
```javascript
const renderSlideList = debounce(_renderSlideListImmediate, 80);
```

## Making Changes

1. **Test locally**: `npm run dev` (runs without WiZ bulbs)
2. **Test WiZ integration**: `npm start` with real bulb IPs
3. **Check browser**: Open `http://localhost:3000/` (student) and `http://localhost:3000/host` (host)
4. **No build step needed** — changes reload on refresh

## WiZ Bulb Protocol

WiZ bulbs use local UDP on port 38899:

```json
{ "method": "setPilot", "params": { "r": 255, "g": 110, "b": 180, "dimming": 90 } }
```

Test manually:
```bash
echo '{"method":"setPilot","params":{"r":255,"g":0,"b":128,"dimming":80}}' | nc -u 192.168.1.100 38899
```
