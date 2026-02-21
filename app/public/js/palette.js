/**
 * palette.js
 *
 * The 30-color pixel art palette for the chunky color grid.
 *
 * Curation philosophy:
 * - Warm, joyful, diverse — think Stardew Valley's item palette
 * - No muted/dark colors — these need to GLOW as light bulb hues
 * - Evenly spread across hue wheel so every student picks something different
 * - Each color has a lighter variant for dither pairing (colorB)
 * - Each has a human-readable name so we can use it in the terminal log
 */

export const PALETTE = [
  // --- Pinks & Reds ---
  { id: 'hot-pink',      hex: '#FF6EB4', colorB: '#FFB3D9', name: 'Hot Pink' },
  { id: 'bubblegum',     hex: '#FF9FD2', colorB: '#FFD5EC', name: 'Bubblegum' },
  { id: 'coral',         hex: '#FF6B6B', colorB: '#FFB3B3', name: 'Coral' },
  { id: 'tomato',        hex: '#FF4040', colorB: '#FF9999', name: 'Tomato' },
  { id: 'rose',          hex: '#FF0080', colorB: '#FF6EB4', name: 'Rose' },

  // --- Oranges ---
  { id: 'tangerine',     hex: '#FF8C42', colorB: '#FFB97A', name: 'Tangerine' },
  { id: 'peach',         hex: '#FFB347', colorB: '#FFD699', name: 'Peach' },
  { id: 'creamsicle',    hex: '#FF9950', colorB: '#FFCC99', name: 'Creamsicle' },

  // --- Yellows ---
  { id: 'sunshine',      hex: '#FFD93D', colorB: '#FFECAA', name: 'Sunshine' },
  { id: 'lemon',         hex: '#FFEE58', colorB: '#FFFACD', name: 'Lemon' },
  { id: 'gold',          hex: '#FFBB00', colorB: '#FFD966', name: 'Gold' },

  // --- Greens ---
  { id: 'lime',          hex: '#AAFF00', colorB: '#D4FF80', name: 'Lime' },
  { id: 'mint',          hex: '#6BCB77', colorB: '#B5E8BB', name: 'Mint' },
  { id: 'sage',          hex: '#52B788', colorB: '#A7D7C0', name: 'Sage' },
  { id: 'forest',        hex: '#2D9E5C', colorB: '#7DCCAA', name: 'Forest' },

  // --- Teals & Cyans ---
  { id: 'teal',          hex: '#00C9A7', colorB: '#80E7D3', name: 'Teal' },
  { id: 'aqua',          hex: '#00BFFF', colorB: '#80DFFF', name: 'Aqua' },
  { id: 'sky',           hex: '#4DBBFF', colorB: '#AADDFF', name: 'Sky' },

  // --- Blues ---
  { id: 'cornflower',    hex: '#6495ED', colorB: '#AABEF6', name: 'Cornflower' },
  { id: 'cobalt',        hex: '#0047AB', colorB: '#6699CC', name: 'Cobalt' },
  { id: 'periwinkle',    hex: '#9999FF', colorB: '#CCCCFF', name: 'Periwinkle' },

  // --- Purples ---
  { id: 'lavender',      hex: '#C77DFF', colorB: '#E3BEFF', name: 'Lavender' },
  { id: 'violet',        hex: '#8B00FF', colorB: '#C980FF', name: 'Violet' },
  { id: 'grape',         hex: '#9B59B6', colorB: '#C39BD3', name: 'Grape' },

  // --- Pinks → Purples ---
  { id: 'fuchsia',       hex: '#FF00FF', colorB: '#FF80FF', name: 'Fuchsia' },
  { id: 'orchid',        hex: '#DA70D6', colorB: '#EDB8EB', name: 'Orchid' },

  // --- Warm Neutrals (still vibrant) ---
  { id: 'cream',         hex: '#FFF8E7', colorB: '#FFFFFF', name: 'Cream' },
  { id: 'butter',        hex: '#FFFACD', colorB: '#FFFFFF', name: 'Butter' },

  // --- Wilds ---
  { id: 'electric-blue', hex: '#00FFFF', colorB: '#80FFFF', name: 'Electric' },
  { id: 'neon-green',    hex: '#39FF14', colorB: '#9AFF80', name: 'Neon' },
];

/**
 * Given a hex color, derive a reasonable "lighter" dither partner.
 * Used when a color is sent from the bulb state (not our palette).
 * Simple: blend toward white by 40%.
 *
 * @param {string} hex - e.g. "#FF6EB4"
 * @returns {string} lighter hex
 */
export function deriveDitherPair(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * 0.45);
  const lg = Math.round(g + (255 - g) * 0.45);
  const lb = Math.round(b + (255 - b) * 0.45);
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
}

/**
 * Find a palette entry by hex. Returns null if not found.
 * @param {string} hex
 * @returns {object|null}
 */
export function findByHex(hex) {
  return PALETTE.find(p => p.hex.toLowerCase() === hex.toLowerCase()) ?? null;
}
