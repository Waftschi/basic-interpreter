import { COLOR_CODES, DEFAULT_BG, PHOSPHOR } from './petscii.js';

export const COLS = 40;
export const ROWS = 25;

export interface Snapshot {
  code: Uint32Array;
  color: Uint8Array;
  rev: Uint8Array;
  row: number;
  col: number;
  bg: number;
  border: number;
  lower: boolean;
}

/** A 40x25 character screen with a C64-style cursor, colours and PETSCII control codes. */
export class Screen {
  readonly code = new Uint32Array(COLS * ROWS).fill(32);
  readonly color = new Uint8Array(COLS * ROWS).fill(PHOSPHOR);
  readonly rev = new Uint8Array(COLS * ROWS);
  /** wrap[r] = 1 when row r continues the logical line of row r-1. */
  readonly wrap = new Uint8Array(ROWS);
  row = 0;
  col = 0;
  fg = PHOSPHOR;
  bg = DEFAULT_BG;
  border = DEFAULT_BG;
  reverse = false;
  lower = false;
  /** Where the current INPUT started; follows the text when the screen scrolls. */
  anchor: { row: number; col: number } | null = null;

  snapshot(): Snapshot {
    return {
      code: Uint32Array.from(this.code),
      color: Uint8Array.from(this.color),
      rev: Uint8Array.from(this.rev),
      row: this.row,
      col: this.col,
      bg: this.bg,
      border: this.border,
      lower: this.lower,
    };
  }

  private cell(r: number, c: number): number { return r * COLS + c; }

  clear(): void {
    this.code.fill(32);
    this.color.fill(this.fg);
    this.rev.fill(0);
    this.wrap.fill(0);
    this.row = 0;
    this.col = 0;
    this.anchor = null;
  }

  home(): void {
    this.row = 0;
    this.col = 0;
  }

  locate(row: number, col: number): void {
    this.row = Math.min(ROWS - 1, Math.max(0, row));
    this.col = Math.min(COLS - 1, Math.max(0, col));
  }

  private scroll(): void {
    this.code.copyWithin(0, COLS);
    this.color.copyWithin(0, COLS);
    this.rev.copyWithin(0, COLS);
    this.wrap.copyWithin(0, 1);
    const last = (ROWS - 1) * COLS;
    this.code.fill(32, last);
    this.color.fill(this.fg, last);
    this.rev.fill(0, last);
    this.wrap[ROWS - 1] = 0;
    if (this.anchor) {
      this.anchor.row--;
      if (this.anchor.row < 0) this.anchor = { row: 0, col: 0 };
    }
  }

  private lineFeed(): void {
    this.row++;
    if (this.row >= ROWS) {
      this.scroll();
      this.row = ROWS - 1;
    }
  }

  newline(): void {
    this.col = 0;
    this.lineFeed();
    this.wrap[this.row] = 0;
    this.reverse = false;
  }

  putChar(code: number): void {
    const i = this.cell(this.row, this.col);
    this.code[i] = code;
    this.color[i] = this.fg;
    this.rev[i] = this.reverse ? 1 : 0;
    this.col++;
    if (this.col >= COLS) {
      this.col = 0;
      this.lineFeed();
      this.wrap[this.row] = 1;
    }
  }

  moveRight(): void {
    this.col++;
    if (this.col >= COLS) {
      this.col = 0;
      this.lineFeed();
    }
  }

  moveLeft(): void {
    this.col--;
    if (this.col < 0) {
      if (this.row > 0) { this.row--; this.col = COLS - 1; } else this.col = 0;
    }
  }

  moveUp(): void { if (this.row > 0) this.row--; }
  moveDown(): void { this.lineFeed(); }

  chainStart(row: number): number {
    while (row > 0 && this.wrap[row]) row--;
    return row;
  }

  chainEnd(row: number): number {
    while (row + 1 < ROWS && this.wrap[row + 1]) row++;
    return row;
  }

  private copyCell(from: number, to: number): void {
    this.code[to] = this.code[from];
    this.color[to] = this.color[from];
    this.rev[to] = this.rev[from];
  }

  private blankCell(i: number): void {
    this.code[i] = 32;
    this.color[i] = this.fg;
    this.rev[i] = 0;
  }

  /** DEL: remove the character left of the cursor and pull the rest of the line in. */
  backspace(): void {
    if (this.col === 0 && !this.wrap[this.row]) return;
    this.moveLeft();
    this.deleteHere();
  }

  /** Remove the character under the cursor and pull the rest of the logical line in. */
  deleteHere(): void {
    const end = (this.chainEnd(this.row) + 1) * COLS;
    for (let i = this.cell(this.row, this.col); i < end - 1; i++) this.copyCell(i + 1, i);
    this.blankCell(end - 1);
  }

  /** INS: open a gap under the cursor, pushing the rest of the logical line right. */
  insertSpace(): void {
    const at = this.cell(this.row, this.col);
    const end = (this.chainEnd(this.row) + 1) * COLS;
    for (let i = end - 1; i > at; i--) this.copyCell(i - 1, i);
    this.blankCell(at);
  }

  /** Text on the logical line under the cursor (from the INPUT anchor if it is on that line). */
  readLine(): string {
    const start = this.chainStart(this.row);
    const end = this.chainEnd(this.row);
    let from = start * COLS;
    const a = this.anchor;
    if (a && a.row >= start && a.row <= end) from = this.cell(a.row, a.col);
    let s = '';
    for (let i = from; i < (end + 1) * COLS; i++) s += String.fromCodePoint(this.code[i]);
    return s.replace(/[  ]+$/, '');
  }

  /** Move below the logical line under the cursor (after Enter). */
  endLine(): void {
    this.row = this.chainEnd(this.row);
    this.newline();
  }

  /** Write text, interpreting newlines and PETSCII control codes. */
  print(s: string): void {
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      this.control(c);
    }
  }

  /** Handle one code: either a control action or a printable character. */
  control(c: number): void {
    if (c in COLOR_CODES) { this.fg = COLOR_CODES[c]; return; }
    switch (c) {
      case 10: case 13: case 141: this.newline(); return;
      case 147: this.clear(); return;
      case 19: this.home(); return;
      case 17: this.moveDown(); return;
      case 145: this.moveUp(); return;
      case 29: this.moveRight(); return;
      case 157: this.moveLeft(); return;
      case 18: this.reverse = true; return;
      case 146: this.reverse = false; return;
      case 14: this.lower = true; return;
      case 142: this.lower = false; return;
      case 20: this.backspace(); return;
      case 148: this.insertSpace(); return;
    }
    if (c < 32 || (c >= 128 && c < 160)) return;
    this.putChar(c);
  }
}
