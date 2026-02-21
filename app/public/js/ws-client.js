/**
 * ws-client.js
 *
 * WebSocket client with:
 * - Automatic reconnection (exponential backoff, capped at 30s)
 * - Message queue: messages sent while disconnected are buffered and flushed on reconnect
 * - Typed message helpers
 * - Event emitter pattern so app.js can subscribe to message types
 *
 * Architecture note:
 * The client intentionally has NO knowledge of app modes or DOM.
 * It is a pure transport layer. App logic lives in app.js.
 */

const WS_URL = (() => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host;
  return `${proto}://${host}/ws`;
})();

// Reconnect config
const RECONNECT_BASE_MS   = 500;
const RECONNECT_MAX_MS    = 30_000;
const RECONNECT_MULTIPLIER = 2;

class PixelWSClient extends EventTarget {
  #ws = null;
  #reconnectDelay = RECONNECT_BASE_MS;
  #reconnectTimer = null;
  #queue = [];        // buffered outbound messages
  #connected = false;
  #destroyed = false;
  #sessionId = null;  // set once server confirms join

  constructor() {
    super();
  }

  get connected() {
    return this.#connected;
  }

  /**
   * Connect to the WebSocket server.
   * Safe to call multiple times — won't double-connect.
   */
  connect() {
    if (this.#destroyed) return;
    if (this.#ws?.readyState === WebSocket.OPEN ||
        this.#ws?.readyState === WebSocket.CONNECTING) return;

    this.#ws = new WebSocket(WS_URL);

    this.#ws.addEventListener('open', () => {
      this.#connected = true;
      this.#reconnectDelay = RECONNECT_BASE_MS;
      // Drop stale messages from the queue:
      // - color: stale — would change the light to an outdated color
      // - join: stale — app.js re-sends join from the welcome handler on reconnect,
      //         so replaying an old queued join would cause a double-join
      this.#queue = this.#queue.filter(msg => {
        try {
          const parsed = JSON.parse(msg);
          return parsed.type !== 'color' && parsed.type !== 'join';
        } catch {
          return false;
        }
      });
      this._emit('connected');
      this.#flushQueue();
    });

    this.#ws.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.warn('[ws] Bad JSON from server:', event.data);
        return;
      }
      // Emit a generic 'message' event with the parsed payload
      this._emit('message', data);
      // Also emit a typed event so callers can listen to specific message types
      if (data.type) {
        this._emit(`msg:${data.type}`, data);
      }
    });

    this.#ws.addEventListener('close', (event) => {
      this.#connected = false;
      this.#ws = null;
      this._emit('disconnected', { code: event.code, reason: event.reason });
      if (!this.#destroyed) {
        this.#scheduleReconnect();
      }
    });

    this.#ws.addEventListener('error', () => {
      // Let the 'close' handler do the work.
      // Log for debugging.
      this._emit('error');
    });
  }

  /**
   * Cleanly close and stop reconnecting.
   */
  destroy() {
    this.#destroyed = true;
    clearTimeout(this.#reconnectTimer);
    this.#ws?.close(1000, 'Client closed');
  }

  /**
   * Send a message. If disconnected, queues it for when we reconnect.
   * @param {object} payload
   */
  send(payload) {
    const str = JSON.stringify(payload);
    if (this.#connected && this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(str);
    } else {
      // Buffer — but cap queue size so we don't leak memory
      if (this.#queue.length < 20) {
        this.#queue.push(str);
      }
    }
  }

  // --- Typed send helpers ---

  /**
   * Announce joining the session.
   * Server responds with msg:welcome containing the current state.
   */
  sendJoin(name, colorHex) {
    this.send({ type: 'join', name, hex: colorHex });
  }

  /** User tapped a color swatch. */
  sendColor(name, colorHex) {
    this.send({ type: 'color', name, hex: colorHex });
  }

  /** User tapped a reaction emoji. */
  sendReaction(name, emoji) {
    this.send({ type: 'reaction', name, emoji });
  }

  /** User submitted a free-text response. */
  sendTextResponse(name, text) {
    this.send({ type: 'text_response', name, text });
  }

  /** User submitted a question. */
  sendQuestion(name, text) {
    this.send({ type: 'question', name, text });
  }

  // --- Private ---

  #flushQueue() {
    while (this.#queue.length > 0) {
      const msg = this.#queue.shift();
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#ws.send(msg);
      } else {
        // Connection dropped again mid-flush — put it back
        this.#queue.unshift(msg);
        break;
      }
    }
  }

  #scheduleReconnect() {
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => {
      this._emit('reconnecting', { delay: this.#reconnectDelay });
      this.connect();
      // Backoff
      this.#reconnectDelay = Math.min(
        this.#reconnectDelay * RECONNECT_MULTIPLIER,
        RECONNECT_MAX_MS
      );
    }, this.#reconnectDelay);
  }

  /**
   * Internal EventTarget helper — dispatches a CustomEvent.
   * @param {string} type
   * @param {*} detail
   */
  _emit(type, detail = null) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * Convenience: subscribe to typed messages.
   * @param {string} messageType
   * @param {function} handler
   * @returns {function} unsubscribe function
   */
  onMessage(messageType, handler) {
    const wrapper = (e) => handler(e.detail);
    this.addEventListener(`msg:${messageType}`, wrapper);
    return () => this.removeEventListener(`msg:${messageType}`, wrapper);
  }
}

// Singleton export — one connection for the whole app session.
export const ws = new PixelWSClient();
