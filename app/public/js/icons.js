/**
 * icons.js
 *
 * All pixel art icons as inline SVG strings.
 * Each icon is designed on a 16×16 or 32×32 pixel grid.
 * Colors use currentColor so they inherit from CSS.
 *
 * Rendering approach:
 * - Each "pixel" is an SVG <rect> at integer coordinates
 * - viewBox is the native pixel resolution
 * - scale up with width/height attributes in HTML
 * - image-rendering: pixelated keeps them crisp
 *
 * Usage:
 *   el.innerHTML = Icons.bulb();
 *   el.innerHTML = Icons.fire({ color: '#FF6EB4', size: 32 });
 */

export const Icons = {
  /**
   * Lightbulb — 16×16
   * Used for the "💡 reaction" button and ambient mode hints.
   */
  bulb({ color = 'currentColor', size = 32 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Glass dome -->
      <rect x="5" y="0" width="6" height="1" fill="${color}"/>
      <rect x="3" y="1" width="10" height="1" fill="${color}"/>
      <rect x="2" y="2" width="12" height="1" fill="${color}"/>
      <rect x="1" y="3" width="14" height="1" fill="${color}"/>
      <rect x="1" y="4" width="14" height="1" fill="${color}"/>
      <rect x="1" y="5" width="14" height="1" fill="${color}"/>
      <rect x="1" y="6" width="14" height="1" fill="${color}"/>
      <rect x="2" y="7" width="12" height="1" fill="${color}"/>
      <rect x="3" y="8" width="10" height="1" fill="${color}"/>
      <!-- Inner glow highlight -->
      <rect x="4" y="3" width="3" height="2" fill="rgba(255,255,255,0.4)"/>
      <!-- Neck -->
      <rect x="4" y="9"  width="8" height="1" fill="${color}"/>
      <rect x="5" y="10" width="6" height="1" fill="${color}"/>
      <rect x="5" y="11" width="6" height="1" fill="${color}"/>
      <!-- Base -->
      <rect x="4" y="12" width="8" height="1" fill="${color}"/>
      <rect x="5" y="13" width="6" height="1" fill="${color}"/>
      <rect x="5" y="14" width="6" height="1" fill="${color}"/>
      <!-- Rays (top) -->
      <rect x="8"  y="0"  width="1" height="1" fill="${color}" opacity="0.7"/>
      <rect x="1"  y="1"  width="1" height="1" fill="${color}" opacity="0.5"/>
      <rect x="14" y="1"  width="1" height="1" fill="${color}" opacity="0.5"/>
      <rect x="0"  y="4"  width="1" height="1" fill="${color}" opacity="0.5"/>
      <rect x="15" y="4"  width="1" height="1" fill="${color}" opacity="0.5"/>
    </svg>`;
  },

  /**
   * Fire / Flame — 16×16
   * Used for the "🔥 reaction" button.
   */
  fire({ color = '#FF6B35', size = 32 } = {}) {
    const tip = '#FFD93D';
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Flame tip (yellow) -->
      <rect x="7" y="1" width="2" height="1" fill="${tip}"/>
      <rect x="6" y="2" width="4" height="1" fill="${tip}"/>
      <rect x="6" y="3" width="4" height="1" fill="${tip}"/>
      <!-- Mid flame -->
      <rect x="5" y="4" width="6" height="1" fill="${color}"/>
      <rect x="4" y="5" width="8" height="1" fill="${color}"/>
      <rect x="3" y="6" width="10" height="1" fill="${color}"/>
      <rect x="3" y="7" width="10" height="1" fill="${color}"/>
      <!-- Inner bright -->
      <rect x="6" y="5" width="4" height="2" fill="${tip}" opacity="0.7"/>
      <!-- Base flame -->
      <rect x="2" y="8"  width="12" height="1" fill="${color}"/>
      <rect x="2" y="9"  width="12" height="1" fill="${color}"/>
      <rect x="3" y="10" width="10" height="1" fill="${color}"/>
      <rect x="4" y="11" width="8"  height="1" fill="${color}"/>
      <rect x="5" y="12" width="6"  height="1" fill="${color}"/>
      <rect x="6" y="13" width="4"  height="1" fill="${color}"/>
      <rect x="6" y="14" width="4"  height="1" fill="${color}"/>
      <rect x="7" y="15" width="2"  height="1" fill="${color}"/>
    </svg>`;
  },

  /**
   * Mailbox / Envelope — 16×16
   * Used for the "📬 park a question" button.
   */
  mailbox({ color = 'currentColor', size = 32 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Envelope body -->
      <rect x="1" y="3"  width="14" height="10" fill="${color}"/>
      <!-- Flap fold lines (white) -->
      <rect x="2" y="4"  width="5"  height="1"  fill="rgba(255,255,255,0.5)"/>
      <rect x="9" y="4"  width="5"  height="1"  fill="rgba(255,255,255,0.5)"/>
      <rect x="3" y="5"  width="3"  height="1"  fill="rgba(255,255,255,0.5)"/>
      <rect x="10" y="5" width="3"  height="1"  fill="rgba(255,255,255,0.5)"/>
      <!-- Seal dot -->
      <rect x="7"  y="7"  width="2"  height="2"  fill="rgba(255,255,255,0.7)"/>
      <!-- Bottom strip -->
      <rect x="1" y="11" width="14" height="2"  fill="${color}" opacity="0.6"/>
    </svg>`;
  },

  /**
   * Arrow Right (→) — "NYC" send confirmation — 16×16
   */
  arrowRight({ color = 'currentColor', size = 32 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Shaft -->
      <rect x="1" y="7" width="10" height="2" fill="${color}"/>
      <!-- Arrowhead -->
      <rect x="11" y="5" width="2" height="6" fill="${color}"/>
      <rect x="13" y="6" width="2" height="4" fill="${color}"/>
      <rect x="15" y="7" width="1" height="2" fill="${color}"/>
      <!-- Pixel step top -->
      <rect x="9"  y="5" width="2" height="2" fill="${color}"/>
      <rect x="9"  y="9" width="2" height="2" fill="${color}"/>
    </svg>`;
  },

  /**
   * Pixel Person — 12×16
   * Used in the lobby counter row.
   * Rendered at 16px height so they stack nicely.
   */
  person({ color = 'currentColor', size = 24 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 16"
      width="${Math.round(size * 0.75)}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Head -->
      <rect x="3" y="0" width="6" height="1" fill="${color}"/>
      <rect x="2" y="1" width="8" height="1" fill="${color}"/>
      <rect x="2" y="2" width="8" height="1" fill="${color}"/>
      <rect x="2" y="3" width="8" height="1" fill="${color}"/>
      <rect x="3" y="4" width="6" height="1" fill="${color}"/>
      <!-- Neck -->
      <rect x="4" y="5" width="4" height="1" fill="${color}"/>
      <!-- Body -->
      <rect x="2" y="6"  width="8" height="1" fill="${color}"/>
      <rect x="1" y="7"  width="10" height="1" fill="${color}"/>
      <rect x="1" y="8"  width="10" height="1" fill="${color}"/>
      <rect x="2" y="9"  width="8" height="1" fill="${color}"/>
      <rect x="2" y="10" width="8" height="1" fill="${color}"/>
      <!-- Legs -->
      <rect x="2" y="11" width="3" height="1" fill="${color}"/>
      <rect x="7" y="11" width="3" height="1" fill="${color}"/>
      <rect x="2" y="12" width="3" height="1" fill="${color}"/>
      <rect x="7" y="12" width="3" height="1" fill="${color}"/>
      <rect x="1" y="13" width="3" height="1" fill="${color}"/>
      <rect x="8" y="13" width="3" height="1" fill="${color}"/>
      <rect x="1" y="14" width="3" height="1" fill="${color}"/>
      <rect x="8" y="14" width="3" height="1" fill="${color}"/>
      <rect x="1" y="15" width="3" height="1" fill="${color}"/>
      <rect x="8" y="15" width="3" height="1" fill="${color}"/>
    </svg>`;
  },

  /**
   * Star — 16×16
   * Used as photo decoration and sparkle.
   */
  star({ color = '#FFD93D', size = 16 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <rect x="7"  y="0"  width="2" height="2" fill="${color}"/>
      <rect x="7"  y="14" width="2" height="2" fill="${color}"/>
      <rect x="0"  y="7"  width="2" height="2" fill="${color}"/>
      <rect x="14" y="7"  width="2" height="2" fill="${color}"/>
      <rect x="7"  y="2"  width="2" height="10" fill="${color}"/>
      <rect x="2"  y="7"  width="12" height="2" fill="${color}"/>
      <rect x="3"  y="3"  width="2" height="2" fill="${color}"/>
      <rect x="11" y="3"  width="2" height="2" fill="${color}"/>
      <rect x="3"  y="11" width="2" height="2" fill="${color}"/>
      <rect x="11" y="11" width="2" height="2" fill="${color}"/>
    </svg>`;
  },

  /**
   * Heart — 16×16
   * Photo decoration.
   */
  heart({ color = '#FF6EB4', size = 16 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <rect x="1"  y="2"  width="4" height="1" fill="${color}"/>
      <rect x="11" y="2"  width="4" height="1" fill="${color}"/>
      <rect x="0"  y="3"  width="6" height="4" fill="${color}"/>
      <rect x="10" y="3"  width="6" height="4" fill="${color}"/>
      <rect x="1"  y="7"  width="14" height="2" fill="${color}"/>
      <rect x="2"  y="9"  width="12" height="2" fill="${color}"/>
      <rect x="3"  y="11" width="10" height="2" fill="${color}"/>
      <rect x="4"  y="13" width="8"  height="1" fill="${color}"/>
      <rect x="5"  y="14" width="6"  height="1" fill="${color}"/>
      <rect x="7"  y="15" width="2"  height="1" fill="${color}"/>
      <!-- Highlight -->
      <rect x="2"  y="4"  width="2" height="2" fill="rgba(255,255,255,0.4)"/>
    </svg>`;
  },

  /**
   * Eye / Lookin — 16×16
   * Used for the "👀" reaction button.
   */
  eyes({ color = 'currentColor', size = 32 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Left eye white -->
      <rect x="0" y="5"  width="6" height="6" fill="${color}"/>
      <!-- Left pupil -->
      <rect x="2" y="6"  width="2" height="3" fill="#1A1A1A"/>
      <!-- Right eye white -->
      <rect x="10" y="5" width="6" height="6" fill="${color}"/>
      <!-- Right pupil -->
      <rect x="12" y="6" width="2" height="3" fill="#1A1A1A"/>
      <!-- Reflection dots -->
      <rect x="3"  y="6"  width="1" height="1" fill="rgba(255,255,255,0.7)"/>
      <rect x="13" y="6"  width="1" height="1" fill="rgba(255,255,255,0.7)"/>
    </svg>`;
  },

  /**
   * "Wow / !" — 16×16
   * Used for the "😮" reaction button.
   */
  wow({ color = 'currentColor', size = 32 } = {}) {
    return `<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="${size}" height="${size}"
      style="image-rendering:pixelated;display:block"
      aria-hidden="true"
    >
      <!-- Face outline -->
      <rect x="3" y="0"  width="10" height="1" fill="${color}"/>
      <rect x="1" y="1"  width="14" height="1" fill="${color}"/>
      <rect x="1" y="14" width="14" height="1" fill="${color}"/>
      <rect x="3" y="15" width="10" height="1" fill="${color}"/>
      <rect x="0" y="2"  width="1"  height="12" fill="${color}"/>
      <rect x="15" y="2" width="1"  height="12" fill="${color}"/>
      <!-- Eyes -->
      <rect x="4" y="5"  width="2"  height="2"  fill="${color}"/>
      <rect x="10" y="5" width="2"  height="2"  fill="${color}"/>
      <!-- "O" mouth -->
      <rect x="6"  y="10" width="4" height="1" fill="${color}"/>
      <rect x="5"  y="11" width="6" height="1" fill="${color}"/>
      <rect x="5"  y="12" width="6" height="1" fill="${color}"/>
      <rect x="6"  y="13" width="4" height="1" fill="${color}"/>
      <rect x="5"  y="10" width="1" height="3" fill="${color}"/>
      <rect x="10" y="10" width="1" height="3" fill="${color}"/>
    </svg>`;
  },
};
