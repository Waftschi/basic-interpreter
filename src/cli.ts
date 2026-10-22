#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { BasicError } from './lexer.js';
import { Interpreter, IO, buildProgram } from './interpreter.js';
import { renumber } from './renum.js';

const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();

const io: IO = {
  print: (s) => { process.stdout.write(s); },
  async input(prompt) {
    process.stdout.write(prompt);
    const r = await lines.next();
    return r.done ? null : (r.value as string);
  },
  cls() { if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H'); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

function report(e: unknown): void {
  if (e instanceof BasicError) console.log(`?${e.message}`);
  else throw e;
}

async function runFile(path: string): Promise<void> {
  const src = readFileSync(path, 'utf8');
  try {
    await new Interpreter(io).run(src);
  } catch (e) {
    report(e);
    process.exitCode = 1;
  }
}

const HELP = `Commands: RUN, LIST, NEW, LOAD "file", SAVE "file", RENUM [start[,step]], HELP, QUIT
Type a numbered line to add/replace it (a bare number deletes it).
Anything else runs immediately, e.g. PRINT 2+2
To load a program: LOAD "examples/invaders.bas"  then RUN`;

async function repl(): Promise<void> {
  const interp = new Interpreter(io);
  const program = new Map<number, string>();
  const sorted = () => [...program.entries()].sort((a, b) => a[0] - b[0]);
  console.log('TypeScript BASIC  (HELP for commands)');

  for (;;) {
    process.stdout.write('> ');
    const r = await lines.next();
    if (r.done) break;
    const text = (r.value as string).trim();
    if (!text) continue;

    const numbered = /^(\d+)\s*(.*)$/.exec(text);
    if (numbered) {
      const n = Number(numbered[1]);
      if (numbered[2]) program.set(n, numbered[2]);
      else program.delete(n);
      continue;
    }

    const [cmdRaw, ...restParts] = text.split(/\s+/);
    const cmd = cmdRaw.toUpperCase();
    const arg = restParts.join(' ').replace(/^"|"$/g, '');
    try {
      switch (cmd) {
        case 'QUIT':
        case 'EXIT':
          rl.close();
          return;
        case 'HELP':
          console.log(HELP);
          break;
        case 'NEW':
          program.clear();
          break;
        case 'LIST':
          for (const [n, l] of sorted()) console.log(`${n} ${l}`);
          break;
        case 'RUN':
          await interp.runProgram(buildProgram(program), true);
          break;
        case 'RENUM': {
          const [start, step] = arg ? arg.split(/[\s,]+/).map(Number) : [];
          const renumbered = renumber(program, start, step);
          program.clear();
          for (const [n, l] of renumbered) program.set(n, l);
          break;
        }
        case 'LOAD': {
          program.clear();
          for (const raw of readFileSync(arg, 'utf8').split(/\r?\n/)) {
            const m = /^\s*(\d+)\s*(.*)$/.exec(raw);
            if (m) program.set(Number(m[1]), m[2]);
          }
          break;
        }
        case 'SAVE':
          writeFileSync(arg, sorted().map(([n, l]) => `${n} ${l}`).join('\n') + '\n');
          break;
        default:
          await interp.runImmediate(text);
      }
    } catch (e) {
      if (e instanceof BasicError) console.log(`?${e.message}`);
      else if ((e as NodeJS.ErrnoException).code) console.log(`?${(e as Error).message}`);
      else throw e;
    }
  }
}

const file = process.argv[2];
if (file) await runFile(file).finally(() => rl.close());
else await repl();
