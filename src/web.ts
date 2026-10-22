import { BasicError } from './lexer.js';
import { Interpreter, IO, buildProgram } from './interpreter.js';
import { renumber } from './renum.js';

const screen = document.getElementById('screen') as HTMLElement;
const outEl = document.getElementById('out') as HTMLElement;
const lineEl = document.getElementById('line') as HTMLElement;
const cursorEl = document.getElementById('cursor') as HTMLElement;
const afterEl = document.getElementById('after') as HTMLElement;
const outText = outEl.appendChild(document.createTextNode(''));

let pending: ((s: string | null) => void) | null = null;
let buffer = '';
let pos = 0;
let breakRequested = false;
const history: string[] = [];
let histPos = 0;

const scroll = () => { screen.scrollTop = screen.scrollHeight; };

// Output is queued and written to the DOM in one go, so a CLS + redraw never shows a half-drawn frame.
let queued = '';
let clearOnFlush = false;
let lastFlush = performance.now();

function flush(): void {
  if (clearOnFlush) { outText.data = ''; clearOnFlush = false; }
  outText.data += queued;
  queued = '';
  lastFlush = performance.now();
  scroll();
}

function print(s: string): void {
  queued += s;
}

// Keyboard state for INKEY$ / KEYDOWN / KEYUP while a program runs.
const held = new Set<number>();
const keyQueue: string[] = [];

function codeOf(e: KeyboardEvent): number {
  if (e.key.length === 1) return e.key.toUpperCase().charCodeAt(0);
  switch (e.key) {
    case 'ArrowLeft': return 37;
    case 'ArrowUp': return 38;
    case 'ArrowRight': return 39;
    case 'ArrowDown': return 40;
    case 'Enter': return 13;
    case 'Escape': return 27;
    case 'Backspace': return 8;
    default: return 0;
  }
}

function setBuffer(s: string, at = s.length): void {
  buffer = s;
  pos = Math.min(Math.max(0, at), s.length);
  lineEl.textContent = s.slice(0, pos);
  cursorEl.textContent = s[pos] ?? ' ';
  afterEl.textContent = s.slice(pos + 1);
  scroll();
}

/** Show a prompt and resolve with the line the user types. */
function readLine(prompt: string, remember = false, initial = ''): Promise<string | null> {
  print(prompt);
  flush();
  keyQueue.length = 0;
  held.clear();
  setBuffer(initial);
  histPos = history.length;
  screen.classList.remove('running');
  return new Promise((resolve) => {
    pending = (s) => {
      if (remember && s) history.push(s);
      resolve(s);
    };
  });
}

function submit(): void {
  if (!pending) return;
  const done = pending;
  const text = buffer;
  pending = null;
  print(text + '\n');
  flush();
  setBuffer('');
  screen.classList.add('running');
  done(text);
}

function recall(delta: number): void {
  if (!pending || !history.length) return;
  histPos = Math.min(history.length, Math.max(0, histPos + delta));
  setBuffer(history[histPos] ?? '');
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'c' && !pending) {
    breakRequested = true;
    e.preventDefault();
    return;
  }
  if (!pending) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const code = codeOf(e);
    if (code) held.add(code);
    if (!e.repeat && keyQueue.length < 16) {
      if (e.key.length === 1) keyQueue.push(e.key);
      else if (code === 13 || code === 27) keyQueue.push(String.fromCharCode(code));
    }
    if (e.key.length === 1 || e.key.startsWith('Arrow')) e.preventDefault();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter') submit();
  else if (e.key === 'Backspace') { if (pos > 0) setBuffer(buffer.slice(0, pos - 1) + buffer.slice(pos), pos - 1); }
  else if (e.key === 'Delete') setBuffer(buffer.slice(0, pos) + buffer.slice(pos + 1), pos);
  else if (e.key === 'ArrowLeft') setBuffer(buffer, pos - 1);
  else if (e.key === 'ArrowRight') setBuffer(buffer, pos + 1);
  else if (e.key === 'Home') setBuffer(buffer, 0);
  else if (e.key === 'End') setBuffer(buffer, buffer.length);
  else if (e.key === 'ArrowUp') recall(-1);
  else if (e.key === 'ArrowDown') recall(1);
  else if (e.key.length === 1) setBuffer(buffer.slice(0, pos) + e.key + buffer.slice(pos), pos + 1);
  else return;
  e.preventDefault();
});

document.addEventListener('keyup', (e) => { held.delete(codeOf(e)); });
window.addEventListener('blur', () => held.clear());

document.addEventListener('paste', (e) => {
  if (!pending) return;
  const text = e.clipboardData?.getData('text') ?? '';
  const [first, ...more] = text.split(/\r?\n/);
  setBuffer(buffer.slice(0, pos) + first + buffer.slice(pos), pos + first.length);
  for (const l of more) { submit(); setBuffer(l); }
  e.preventDefault();
});

function checkBreak(): void {
  if (breakRequested) {
    breakRequested = false;
    throw new BasicError('Break');
  }
}

const io: IO = {
  print,
  input: (prompt) => readLine(prompt),
  cls() { queued = ''; clearOnFlush = true; },
  async sleep(ms) {
    flush();
    await new Promise((r) => setTimeout(r, ms));
    checkBreak();
  },
  inkey: () => keyQueue.shift() ?? '',
  keyDown: (code) => held.has(code),
};

// Yield through a MessageChannel: setTimeout(0) is clamped to 4ms, which made every frame crawl.
const channel = new MessageChannel();
const yieldNow = () => new Promise<void>((resolve) => {
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(0);
});
let lastYield = performance.now();

const interp = new Interpreter(io, {
  async tick() {
    // keep the page responsive (keys, repaint) by yielding about every 12ms of work
    if (performance.now() - lastYield < 12) return;
    // after a CLS, hold the frame back until the program sleeps or asks for input
    if (!clearOnFlush || performance.now() - lastFlush > 100) flush();
    await yieldNow();
    lastYield = performance.now();
    checkBreak();
  },
});

const HELP = `Commands: RUN, LIST, NEW, LOAD "file", SAVE "file", EDIT n, RENUM [start[,step]], FILES, HELP
Type a numbered line to add/replace it (a bare number deletes it).
Anything else runs immediately, e.g. PRINT 2+2
To load a program: LOAD "examples/invaders_live.bas"  then RUN. FILES lists the examples and your saved programs.
Ctrl+C breaks a running program.`;

const EXAMPLES = ['hello', 'fib', 'primes', 'guess', 'invaders', 'invaders_live', 'maze3d'];
const store = (name: string) => `basic:${name}`;

async function loadSource(name: string): Promise<string> {
  const saved = localStorage.getItem(store(name));
  if (saved !== null) return saved;
  const res = await fetch(name);
  if (!res.ok) throw new BasicError(`File not found: ${name}`);
  return res.text();
}

async function repl(): Promise<void> {
  const program = new Map<number, string>();
  const sorted = () => [...program.entries()].sort((a, b) => a[0] - b[0]);
  print('TypeScript BASIC  (HELP for commands)\n');
  let prefill = '';

  for (;;) {
    const raw = await readLine('> ', true, prefill);
    prefill = '';
    const text = (raw ?? '').trim();
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
        case 'HELP':
          print(HELP + '\n');
          break;
        case 'NEW':
          program.clear();
          break;
        case 'LIST':
          for (const [n, l] of sorted()) print(`${n} ${l}\n`);
          break;
        case 'RUN':
          await interp.runProgram(buildProgram(program), true);
          break;
        case 'EDIT': {
          const n = Number(arg);
          const l = program.get(n);
          if (l === undefined) throw new BasicError(`Undefined line ${arg}`);
          prefill = `${n} ${l}`;
          break;
        }
        case 'RENUM': {
          const [start, step] = arg ? arg.split(/[\s,]+/).map(Number) : [];
          const renumbered = renumber(program, start, step);
          program.clear();
          for (const [n, l] of renumbered) program.set(n, l);
          break;
        }
        case 'FILES': {
          const mine = Object.keys(localStorage).filter((k) => k.startsWith('basic:')).map((k) => k.slice(6));
          for (const f of [...EXAMPLES.map((e) => `examples/${e}.bas`), ...mine]) print(f + '\n');
          break;
        }
        case 'LOAD': {
          const src = await loadSource(arg);
          program.clear();
          for (const l of src.split(/\r?\n/)) {
            const m = /^\s*(\d+)\s*(.*)$/.exec(l);
            if (m) program.set(Number(m[1]), m[2]);
          }
          break;
        }
        case 'SAVE':
          localStorage.setItem(store(arg), sorted().map(([n, l]) => `${n} ${l}`).join('\n') + '\n');
          break;
        default:
          await interp.runImmediate(text);
      }
    } catch (e) {
      if (e instanceof BasicError) print(`?${e.message}\n`);
      else print(`?${(e as Error).message}\n`);
    }
  }
}

screen.focus();
void repl();
