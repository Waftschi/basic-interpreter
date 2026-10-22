# TypeScript BASIC

A small BASIC interpreter written in TypeScript. It runs in the terminal and in the browser, where it looks like a green phosphor CRT with a blinking cursor.

## Getting started

```
npm install
npm run web      # builds, then serves http://127.0.0.1:8080
npm start        # builds, then opens the terminal REPL
npm test
```

Run a program file directly: `node dist/src/cli.js examples/fib.bas`

## Commands

| Command | |
|---|---|
| `RUN`, `LIST`, `NEW` | run, show or clear the program |
| `LOAD "file"`, `SAVE "file"` | in the browser, `SAVE` uses localStorage; `LOAD` also reads `examples/` |
| `EDIT n` | put line `n` back on the prompt for editing |
| `RENUM [start[,step]]` | renumber lines and the GOTO/GOSUB/THEN targets that refer to them |
| `FILES` | list the examples and your saved programs (browser) |
| `HELP` | short reminder |

Type a numbered line to add or replace it; a bare number deletes it. Anything else runs immediately, e.g. `PRINT 2+2`. Cursor keys, Home/End and Up/Down history work at the prompt, and Ctrl+C breaks a running program in the browser.

## The language

- **Statements:** `LET PRINT INPUT IF/THEN/ELSE GOTO GOSUB RETURN FOR/TO/STEP/NEXT WHILE/WEND END STOP DIM DATA READ RESTORE REM CLS SLEEP` (`COLOR LOCATE POKE` are accepted when the host supports them). `:` separates statements on a line. Everything after `THEN` on a line belongs to the `THEN` branch.
- **Numbers and strings:** `A`, `A$`, arrays with `DIM A(10)` (bounds are inclusive), `MOD`, `^`.
- **Logic:** `AND`, `OR`, `NOT` are bitwise, true is -1. There is no short-circuit evaluation.
- **Functions:** `ABS INT SQR SIN COS TAN ATN LOG EXP SGN RND LEN LEFT$ RIGHT$ MID$ STR$ VAL CHR$ ASC UCASE$ LCASE$ INSTR SPACE$ PEEK`.
- **Real-time input:** `INKEY$` returns the next key typed (or `""`), `KEYDOWN(code)` and `KEYUP(code)` tell whether a key is held right now, and `SLEEP ms` pauses. Key codes are the upper-case character code (`65` is A) and `37`-`40` for the arrow keys. These need the browser; the terminal REPL has no key input.
- **Memory:** `PRINT FRE(0)` shows the bytes left of an emulated 8 KB (8192). It counts the program text, variables and arrays, and is only a report: nothing stops a program from going over.

## Examples

Load one with `LOAD "examples/<name>.bas"`, then `RUN`.

| File | |
|---|---|
| `hello`, `fib`, `primes`, `guess` | small programs |
| `invaders` | turn-based Space Invaders, type your moves and press Enter |
| `invaders_live` | real-time version with barricades: `A`/`D` move, `F` fires (browser) |
| `maze3d` | first-person 3D maze drawn with PETSCII lines and a monster that hunts you; `W`/`S` walk, `A`/`D` turn (browser) |
| `petscii` | glyph demo from an abandoned 40x25 grid experiment |

## Source layout

```
src/lexer.ts        tokens and BasicError
src/parser.ts       statements and expressions
src/interpreter.ts  the interpreter and the IO interface the hosts implement
src/renum.ts        RENUM
src/cli.ts          terminal REPL
src/web.ts          browser terminal (DOM, keyboard, timing)
web/                page, CRT styling and the UNSCII font
examples/           BASIC programs
test/               node:test suites
serve.mjs           tiny static server for the browser version
```

The interpreter talks to its host only through the `IO` interface (`print`, `input`, and the optional `cls`, `sleep`, `inkey`, `keyDown`, `peek`, `poke`, ...), so the same code runs in the terminal and in the page.

## Fonts

The browser build uses the [UNSCII](http://viznut.fi/unscii/) 8x8 font (public domain) for the PETSCII-style glyphs, mapped to Unicode box drawing, block elements and card suits.

## Thanks

Special thanks to Mr. Zwölfer for the inspiring schooltime.
