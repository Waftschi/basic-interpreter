
// Commodore-style character set and palette for the 40x25 screen.
// Text is ASCII; codes 128-255 follow PETSCII (graphics, colours, cursor control).

/** Palette indexes: 0-15 are the C64 colours, then the terminal's own defaults. */
export const PHOSPHOR = 16;
export const DEFAULT_BG = 17;

export const PALETTE = [
  '#000000', '#ffffff', '#813338', '#75cec8', '#8e3c97', '#56ac4d', '#2e2c9b', '#edf171',
  '#8e5029', '#553800', '#c46c71', '#4a4a4a', '#7b7b7b', '#a9ff9f', '#706deb', '#b2b2b2',
  '#33ff66', // 16: green phosphor (default text)
  '#020a04', // 17: near-black (default background)
];

/** PETSCII colour control codes -> palette index. */
export const COLOR_CODES: Record<number, number> = {
  144: 0, 5: 1, 28: 2, 159: 3, 156: 4, 30: 5, 31: 6, 158: 7,
  129: 8, 149: 9, 150: 10, 151: 11, 152: 12, 153: 13, 154: 14, 155: 15,
};

// PETSCII 192-223 (shift+letter graphics) and 160-191 (Commodore-key graphics), as Unicode.
const GFX_C0 = [
  0x2500, 0x2660, 0x1FB72, 0x1FB78, 0x1FB77, 0x1FB76, 0x1FB7A, 0x1FB71,
  0x1FB74, 0x256E, 0x2570, 0x256F, 0x1FB7C, 0x2572, 0x2571, 0x1FB7D,
  0x1FB7E, 0x25CF, 0x1FB7B, 0x2665, 0x1FB70, 0x256D, 0x2573, 0x25CB,
  0x2663, 0x1FB75, 0x2666, 0x253C, 0x1FB8C, 0x2502, 0x03C0, 0x25E5,
];
const GFX_A0 = [
  0x20, 0x258C, 0x2584, 0x2594, 0x2581, 0x258E, 0x2592, 0x2595,
  0x1FB8F, 0x25E4, 0x1FB87, 0x251C, 0x2597, 0x2514, 0x2510, 0x2582,
  0x250C, 0x2534, 0x252C, 0x2524, 0x258E, 0x258D, 0x1FB88, 0x1FB82,
  0x1FB83, 0x2583, 0x2713, 0x2596, 0x259D, 0x2518, 0x2598, 0x259A,
];

/**
 * The character to draw for a cell code, or '' for none.
 * `lower` selects the lowercase set, where 193-218 show capitals instead of graphics.
 */
export function glyphFor(code: number, lower: boolean): string {
  if (code > 255) return String.fromCodePoint(code);
  if (code === 127) return '';
  if (code === 255) code = 223; // 255 repeats pi
  else if (code >= 224) code -= 64; // 224-254 repeat 160-190
  if (code < 32 || (code >= 128 && code < 160)) return '';
  if (code >= 192) {
    if (lower && code >= 193 && code <= 218) return String.fromCharCode(code - 128);
    return String.fromCodePoint(GFX_C0[code - 192]);
  }
  if (code >= 160) return String.fromCodePoint(GFX_A0[code - 160]);
  if (code === 96) return String.fromCodePoint(GFX_C0[0]);
  if (code >= 97 && code <= 122 && !lower) return String.fromCharCode(code - 32);
  return String.fromCharCode(code);
}

/** Screen-memory code (as POKEd into 1024-2023) -> cell code. */
export function screenToCode(sc: number): number {
  sc &= 127;
  if (sc < 32) return sc + 64;
  if (sc < 64) return sc;
  if (sc < 96) return sc + 128;
  return sc + 64;
}

/** Cell code -> screen-memory code (0-127). */
export function codeToScreen(code: number): number {
  if (code > 255) return 32;
  if (code === 255) code = 223;
  else if (code >= 224) code -= 64;
  if (code >= 192) return code - 128;
  if (code >= 160) return code - 64;
  if (code >= 97 && code <= 122) return code - 96;
  if (code >= 96) return 64;
  if (code >= 64) return code - 64;
  if (code >= 32) return code;
  return 32;
}
