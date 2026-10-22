import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, Screen } from '../src/screen.js';
import { codeToScreen, glyphFor, screenToCode } from '../src/petscii.js';
import { Interpreter } from '../src/interpreter.js';

const rowText = (s: Screen, r: number) =>
  String.fromCodePoint(...s.code.slice(r * COLS, (r + 1) * COLS)).replace(/ +$/, '');

test('print writes text and newline moves to the next row', () => {
  const s = new Screen();
  s.print('HELLO\nWORLD');
  assert.equal(rowText(s, 0), 'HELLO');
  assert.equal(rowText(s, 1), 'WORLD');
  assert.deepEqual([s.row, s.col], [1, 5]);
});

test('long lines wrap and read back as one logical line', () => {
  const s = new Screen();
  const text = 'X'.repeat(COLS + 5);
  s.print(text);
  assert.equal(s.row, 1);
  s.moveUp();
  assert.equal(s.readLine(), text);
});

test('the screen scrolls and the INPUT anchor follows the text', () => {
  const s = new Screen();
  s.locate(ROWS - 1, 0);
  s.print('NAME? ');
  s.anchor = { row: s.row, col: s.col };
  s.print('BOB');
  s.print('\nMORE\n');
  assert.equal(s.anchor!.row, ROWS - 3);
  assert.equal(rowText(s, ROWS - 3), 'NAME? BOB');
});

test('PETSCII control codes: clear, home, cursor keys, colours, reverse', () => {
  const s = new Screen();
  s.print('ABC');
  s.print(String.fromCharCode(147) + 'Z');
  assert.equal(rowText(s, 0), 'Z');
  s.print(String.fromCharCode(17, 29, 5, 18) + 'Q'); // down, right, white, reverse
  assert.equal(s.code[1 * COLS + 2], 81);
  assert.equal(s.color[1 * COLS + 2], 1);
  assert.equal(s.rev[1 * COLS + 2], 1);
  s.print('\n');
  assert.equal(s.reverse, false);
});

test('DEL and INS edit the logical line under the cursor', () => {
  const s = new Screen();
  s.print('ABCDE');
  s.locate(0, 2);
  s.control(20); // DEL removes B
  assert.equal(rowText(s, 0), 'ACDE');
  s.control(148); // INS opens a gap at the cursor
  s.putChar(66);
  assert.equal(rowText(s, 0), 'ABCDE');
});

test('PETSCII graphics map to Unicode and POKE codes round-trip', () => {
  assert.equal(glyphFor(193, false), '♠'); // spade
  assert.equal(glyphFor(193, true), 'A');
  assert.equal(glyphFor(97, false), 'A');
  assert.equal(glyphFor(97, true), 'a');
  assert.equal(glyphFor(160 + 1, false), '▌');
  assert.equal(glyphFor(147, false), '');
  for (const sc of [0, 1, 26, 32, 63, 64, 90, 96, 127]) {
    assert.equal(codeToScreen(screenToCode(sc)), sc === 0 ? 0 : sc);
  }
});

test('COLOR, LOCATE, POKE, PEEK and column() go through the host IO', async () => {
  const log: string[] = [];
  let col = 0;
  const interp = new Interpreter({
    print: (s) => { col += s.length; },
    input: async () => null,
    column: () => col,
    color: (fg, bg) => log.push(`color ${fg} ${bg}`),
    locate: (r, c) => log.push(`locate ${r} ${c}`),
    poke: (a, v) => log.push(`poke ${a} ${v}`),
    peek: (a) => a + 1,
  });
  await interp.run('10 COLOR 5: COLOR 2, 0: LOCATE 3, 7: POKE 1024, 1: PRINT PEEK(99)');
  assert.deepEqual(log, ['color 5 undefined', 'color 2 0', 'locate 3 7', 'poke 1024 1']);
});
