import { BasicError, tokenize } from './lexer.js';
import { Expr, Parser, Stmt, Target, Value } from './parser.js';

export interface IO {
  print(s: string): void;
  /** Show the prompt and return the next input line, or null at end of input. */
  input(prompt: string): Promise<string | null>;
  /** Clear the screen (CLS). */
  cls?(): void;
  /** Pause for ms milliseconds (SLEEP). */
  sleep?(ms: number): Promise<void>;
  /** The next key pressed since the last call, or '' if none (INKEY$). */
  inkey?(): string;
  /** Whether the key with this code is held down right now (KEYDOWN/KEYUP). */
  keyDown?(code: number): boolean;
  /** Current cursor column, for screens that wrap or move the cursor (PRINT zones). */
  column?(): number;
  /** COLOR fg[, bg] (palette index 0-15). */
  color?(fg: number, bg?: number): void;
  /** LOCATE row, col (1-based). */
  locate?(row: number, col: number): void;
  /** POKE / PEEK of the emulated memory (screen RAM, colour RAM, border and background). */
  poke?(addr: number, value: number): void;
  peek?(addr: number): number;
}

export interface Options {
  rng?: () => number;
  maxSteps?: number;
  /** Awaited every 1000 statements; lets a host yield to its event loop or abort by throwing. */
  tick?: () => void | Promise<void>;
}

interface Entry { line: number; stmt: Stmt }
export interface Program { entries: Entry[]; lineIndex: Map<number, number>; bytes: number }

/** Size of the emulated memory that FRE(0) reports against. */
export const MEMORY_SIZE = 8192;

export function buildProgram(lines: Map<number, string>): Program {
  const nums = [...lines.keys()].sort((a, b) => a - b);
  const entries: Entry[] = [];
  const lineIndex = new Map<number, number>();
  let bytes = 0;
  for (const n of nums) {
    bytes += 3 + lines.get(n)!.length; // 2-byte line number, text, end marker
    const stmts = new Parser(tokenize(lines.get(n)!, n), n).parseLine();
    lineIndex.set(n, entries.length);
    for (const stmt of stmts) entries.push({ line: n, stmt });
  }
  return { entries, lineIndex, bytes };
}

export function parseProgram(src: string): Program {
  const lines = new Map<number, string>();
  for (const raw of src.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = /^\s*(\d+)\s*(.*)$/.exec(raw);
    if (!m) throw new BasicError(`Missing line number: ${raw.trim()}`);
    lines.set(Number(m[1]), m[2]);
  }
  return buildProgram(lines);
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(10)));
}

const defaultFor = (name: string): Value => (name.endsWith('$') ? '' : 0);

interface ForFrame { name: string; end: number; step: number; pc: number }
interface ArrayData { dims: number[]; data: Map<string, Value> }

export class Interpreter {
  private vars = new Map<string, Value>();
  private arrays = new Map<string, ArrayData>();
  private forStack: ForFrame[] = [];
  /** A GOSUB inside an IF body resumes with the rest of that body (`cont`) before going on at `pc`. */
  private callStack: { pc: number; cont?: { body: Stmt[]; from: number } }[] = [];
  private data: Value[] = [];
  private dataPos = 0;
  private prog: Program = { entries: [], lineIndex: new Map(), bytes: 0 };
  private pc = 0;
  private jump: number | null = null;
  private halted = false;
  private curLine = 0;
  private col = 0;
  private rng: () => number;
  private maxSteps: number;
  private tick?: () => void | Promise<void>;
  private programBytes = 0;

  constructor(private io: IO, opts: Options = {}) {
    this.rng = opts.rng ?? Math.random;
    this.maxSteps = opts.maxSteps ?? Infinity;
    this.tick = opts.tick;
  }

  /** Parse and run a whole program from source text (resets all state). */
  async run(source: string): Promise<void> {
    await this.runProgram(parseProgram(source), true);
  }

  /** Execute a single un-numbered line, keeping existing variables. */
  async runImmediate(text: string): Promise<void> {
    await this.runProgram(buildProgram(new Map([[0, text]])), false);
  }

  /** Bytes left of MEMORY_SIZE after the program, variables and arrays (Commodore-style sizes). */
  private freeMemory(): number {
    let used = this.programBytes;
    for (const [name, v] of this.vars) used += 7 + (typeof v === 'string' ? v.length : 0) + (name.length > 2 ? name.length - 2 : 0);
    for (const [name, a] of this.arrays) {
      const count = a.dims.reduce((t, d) => t * (d + 1), 1);
      used += 5 + 2 * a.dims.length + name.length + count * (name.endsWith('$') ? 3 : 5);
      if (name.endsWith('$')) for (const v of a.data.values()) used += String(v).length;
    }
    return Math.max(0, MEMORY_SIZE - used);
  }

  async runProgram(prog: Program, reset: boolean): Promise<void> {
    this.prog = prog;
    if (reset) {
      this.programBytes = prog.bytes;
      this.vars.clear();
      this.arrays.clear();
      this.data = prog.entries.flatMap((e) => (e.stmt.k === 'data' ? e.stmt.values : []));
      this.dataPos = 0;
    }
    this.forStack = [];
    this.callStack = [];
    this.pc = 0;
    this.halted = false;
    let steps = 0;
    try {
      while (this.pc < prog.entries.length && !this.halted) {
        const { line, stmt } = prog.entries[this.pc];
        this.curLine = line;
        this.jump = null;
        const pendingIo = this.exec(stmt);
        if (pendingIo) await pendingIo;
        if (this.jump !== null) this.pc = this.jump;
        else this.pc++;
        if (++steps > this.maxSteps) throw this.err('Step limit exceeded');
        if (this.tick && steps % 1000 === 0) await this.tick();
      }
    } finally {
      if (this.column() > 0) { this.io.print('\n'); this.col = 0; }
    }
  }

  private err(msg: string): BasicError {
    return new BasicError(msg, this.curLine);
  }

  private column(): number {
    return this.io.column ? this.io.column() : this.col;
  }

  private out(s: string): void {
    this.io.print(s);
    const nl = s.lastIndexOf('\n');
    this.col = nl >= 0 ? s.length - nl - 1 : this.col + s.length;
  }

  private target(line: number): number {
    const idx = this.prog.lineIndex.get(line);
    if (idx === undefined) throw this.err(`Undefined line ${line}`);
    return idx;
  }

  // ---- statements ----
  /** Runs one statement; only INPUT and SLEEP are asynchronous, so everything else returns undefined. */
  private exec(s: Stmt): void | Promise<void> {
    switch (s.k) {
      case 'rem':
      case 'data':
        return;
      case 'let':
        this.assign(s.target, this.eval(s.e));
        return;
      case 'print': {
        let newline = true;
        for (const it of s.items) {
          if (it.e) {
            const v = this.eval(it.e);
            this.out(typeof v === 'number' ? formatNumber(v) : v);
          }
          newline = true;
          if (it.sep === ';') newline = false;
          else if (it.sep === ',') {
            newline = false;
            const zone = this.io.column ? 10 : 14;
            this.out(' '.repeat(zone - (this.column() % zone)));
          }
        }
        if (newline) this.out('\n');
        return;
      }
      case 'input':
        return this.doInput(s.prompt, s.targets);
      case 'if': {
        const body = this.truthy(this.eval(s.cond)) ? s.then : s.else;
        return this.execList(body, 0);
      }
      case 'goto':
        this.jump = this.target(s.line);
        return;
      case 'gosub':
        this.callStack.push({ pc: this.pc + 1 });
        this.jump = this.target(s.line);
        return;
      case 'return': {
        const back = this.callStack.pop();
        if (back === undefined) throw this.err('RETURN without GOSUB');
        if (!back.cont) { this.jump = back.pc; return; }
        this.jump = null;
        this.pc = back.pc - 1; // a GOSUB in the rest of the body must return after the IF, not after the RETURN
        const resume = () => { if (this.jump === null && !this.halted) this.jump = back.pc; };
        const pendingIo = this.execList(back.cont.body, back.cont.from);
        if (pendingIo) return pendingIo.then(resume);
        resume();
        return;
      }
      case 'for': {
        const from = this.num(this.eval(s.from));
        const end = this.num(this.eval(s.to));
        const step = s.step ? this.num(this.eval(s.step)) : 1;
        this.vars.set(s.name, from);
        const i = this.forStack.findIndex((f) => f.name === s.name);
        if (i >= 0) this.forStack.length = i;
        if (step > 0 ? from > end : from < end) {
          this.jump = this.skipLoop(s.name);
          return;
        }
        this.forStack.push({ name: s.name, end, step, pc: this.pc + 1 });
        return;
      }
      case 'next': {
        let i = this.forStack.length - 1;
        if (s.name) while (i >= 0 && this.forStack[i].name !== s.name) i--;
        if (i < 0) throw this.err('NEXT without FOR');
        this.forStack.length = i + 1;
        const f = this.forStack[i];
        const v = (this.vars.get(f.name) as number) + f.step;
        this.vars.set(f.name, v);
        if (f.step > 0 ? v <= f.end : v >= f.end) this.jump = f.pc;
        else this.forStack.pop();
        return;
      }
      case 'while':
        if (!this.truthy(this.eval(s.cond))) this.jump = this.skipWhile();
        return;
      case 'wend':
        this.jump = this.findWhile();
        return;
      case 'end':
        this.halted = true;
        return;
      case 'dim':
        for (const d of s.decls) {
          const dims = d.dims.map((e) => this.index(this.eval(e)));
          this.arrays.set(d.name, { dims, data: new Map() });
        }
        return;
      case 'read':
        for (const t of s.targets) {
          if (this.dataPos >= this.data.length) throw this.err('Out of DATA');
          const v = this.data[this.dataPos++];
          if (t.name.endsWith('$')) this.assign(t, String(v));
          else if (typeof v === 'number') this.assign(t, v);
          else throw this.err('Type mismatch');
        }
        return;
      case 'restore':
        this.dataPos = 0;
        return;
      case 'cls':
        this.io.cls?.();
        this.col = 0;
        return;
      case 'color':
        this.io.color?.(this.num(this.eval(s.fg)), s.bg ? this.num(this.eval(s.bg)) : undefined);
        return;
      case 'locate':
        this.io.locate?.(this.num(this.eval(s.row)), this.num(this.eval(s.col)));
        return;
      case 'poke':
        this.io.poke?.(this.num(this.eval(s.addr)), this.num(this.eval(s.value)));
        return;
      case 'sleep': {
        const ms = this.num(this.eval(s.e));
        if (ms < 0) throw this.err('Illegal function call');
        return this.io.sleep?.(ms);
      }
    }
  }

  private execList(body: Stmt[], from: number): void | Promise<void> {
    for (let i = from; i < body.length; i++) {
      const pendingIo = this.exec(body[i]);
      if (pendingIo) {
        return pendingIo.then(() => {
          if (this.jump === null && !this.halted) return this.execList(body, i + 1);
        });
      }
      if (body[i].k === 'gosub' && i + 1 < body.length) this.callStack[this.callStack.length - 1].cont = { body, from: i + 1 };
      if (this.jump !== null || this.halted) return;
    }
  }

  private skipLoop(name: string): number {
    let depth = 0;
    for (let i = this.pc + 1; i < this.prog.entries.length; i++) {
      const st = this.prog.entries[i].stmt;
      if (st.k === 'for') depth++;
      else if (st.k === 'next') {
        if (depth === 0 && (!st.name || st.name === name)) return i + 1;
        depth--;
      }
    }
    throw this.err('FOR without NEXT');
  }

  private skipWhile(): number {
    let depth = 0;
    for (let i = this.pc + 1; i < this.prog.entries.length; i++) {
      const st = this.prog.entries[i].stmt;
      if (st.k === 'while') depth++;
      else if (st.k === 'wend') {
        if (depth === 0) return i + 1;
        depth--;
      }
    }
    throw this.err('WHILE without WEND');
  }

  private findWhile(): number {
    let depth = 0;
    for (let i = this.pc - 1; i >= 0; i--) {
      const st = this.prog.entries[i].stmt;
      if (st.k === 'wend') depth++;
      else if (st.k === 'while') {
        if (depth === 0) return i;
        depth--;
      }
    }
    throw this.err('WEND without WHILE');
  }

  private async doInput(prompt: string | undefined, targets: Target[]): Promise<void> {
    let text = (prompt ?? '') + '? ';
    for (;;) {
      this.col = 0;
      const line = await this.io.input(text);
      if (line === null) {
        this.halted = true;
        return;
      }
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < targets.length) { text = '?? '; continue; }
      const vals: Value[] = [];
      let ok = true;
      targets.forEach((t, i) => {
        if (t.name.endsWith('$')) vals.push(parts[i]);
        else {
          const n = Number(parts[i]);
          if (parts[i] === '' || isNaN(n)) ok = false;
          else vals.push(n);
        }
      });
      if (!ok) {
        this.out('?Redo from start\n');
        text = (prompt ?? '') + '? ';
        continue;
      }
      targets.forEach((t, i) => this.assign(t, vals[i]));
      return;
    }
  }

  // ---- variables ----
  private index(v: Value): number {
    if (typeof v !== 'number' || !Number.isInteger(Math.floor(v))) throw this.err('Type mismatch');
    return Math.floor(v);
  }

  private arrayKey(name: string, idx: Value[]): { arr: ArrayData; key: string } {
    let arr = this.arrays.get(name);
    if (!arr) {
      arr = { dims: idx.map(() => 10), data: new Map() };
      this.arrays.set(name, arr);
    }
    const ix = idx.map((v) => this.index(v));
    if (ix.length !== arr.dims.length) throw this.err('Wrong number of subscripts');
    ix.forEach((n, i) => {
      if (n < 0 || n > arr!.dims[i]) throw this.err('Subscript out of range');
    });
    return { arr, key: ix.join(',') };
  }

  private assign(t: Target, v: Value): void {
    if (t.name.endsWith('$') !== (typeof v === 'string')) throw this.err('Type mismatch');
    if (t.idx) {
      const { arr, key } = this.arrayKey(t.name, t.idx.map((e) => this.eval(e)));
      arr.data.set(key, v);
    } else this.vars.set(t.name, v);
  }

  // ---- expressions ----
  private truthy(v: Value): boolean {
    if (typeof v === 'string') throw this.err('Type mismatch');
    return v !== 0;
  }

  private num(v: Value): number {
    if (typeof v !== 'number') throw this.err('Type mismatch');
    return v;
  }

  private str(v: Value): string {
    if (typeof v !== 'string') throw this.err('Type mismatch');
    return v;
  }

  private eval(e: Expr): Value {
    switch (e.k) {
      case 'num':
      case 'str':
        return e.v;
      case 'var':
        return this.vars.get(e.name) ?? defaultFor(e.name);
      case 'idx': {
        const { arr, key } = this.arrayKey(e.name, e.args.map((a) => this.eval(a)));
        return arr.data.get(key) ?? defaultFor(e.name);
      }
      case 'un': {
        const v = this.num(this.eval(e.e));
        return e.op === '-' ? -v : ~Math.trunc(v);
      }
      case 'bin':
        return this.binary(e.op, this.eval(e.l), this.eval(e.r));
      case 'fn':
        return this.call(e.name, e.args.map((a) => this.eval(a)));
    }
  }

  private binary(op: string, l: Value, r: Value): Value {
    switch (op) {
      case '+':
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        return this.num(l) + this.num(r);
      case '-': return this.num(l) - this.num(r);
      case '*': return this.num(l) * this.num(r);
      case '/': {
        const d = this.num(r);
        if (d === 0) throw this.err('Division by zero');
        return this.num(l) / d;
      }
      case 'MOD': {
        const d = this.num(r);
        if (d === 0) throw this.err('Division by zero');
        return this.num(l) % d;
      }
      case '^': return Math.pow(this.num(l), this.num(r));
      case 'AND': return Math.trunc(this.num(l)) & Math.trunc(this.num(r));
      case 'OR': return Math.trunc(this.num(l)) | Math.trunc(this.num(r));
      default: {
        if (typeof l !== typeof r) throw this.err('Type mismatch');
        let res: boolean;
        switch (op) {
          case '=': res = l === r; break;
          case '<>': res = l !== r; break;
          case '<': res = l < r; break;
          case '>': res = l > r; break;
          case '<=': res = l <= r; break;
          default: res = l >= r; break;
        }
        return res ? -1 : 0;
      }
    }
  }

  private call(name: string, a: Value[]): Value {
    const need = (n: number) => {
      if (a.length !== n) throw this.err(`Wrong number of arguments for ${name}`);
    };
    const n = (i: number) => this.num(a[i]);
    const s = (i: number) => this.str(a[i]);
    switch (name) {
      case 'ABS': need(1); return Math.abs(n(0));
      case 'INT': need(1); return Math.floor(n(0));
      case 'SQR':
        need(1);
        if (n(0) < 0) throw this.err('Illegal function call');
        return Math.sqrt(n(0));
      case 'SIN': need(1); return Math.sin(n(0));
      case 'COS': need(1); return Math.cos(n(0));
      case 'TAN': need(1); return Math.tan(n(0));
      case 'ATN': need(1); return Math.atan(n(0));
      case 'LOG':
        need(1);
        if (n(0) <= 0) throw this.err('Illegal function call');
        return Math.log(n(0));
      case 'EXP': need(1); return Math.exp(n(0));
      case 'SGN': need(1); return Math.sign(n(0));
      case 'RND': return this.rng();
      case 'LEN': need(1); return s(0).length;
      case 'LEFT$': need(2); return s(0).slice(0, Math.max(0, n(1)));
      case 'RIGHT$': {
        need(2);
        const k = Math.max(0, n(1));
        return k === 0 ? '' : s(0).slice(-k);
      }
      case 'MID$': {
        if (a.length !== 2 && a.length !== 3) throw this.err('Wrong number of arguments for MID$');
        const start = Math.max(1, n(1)) - 1;
        return a.length === 3 ? s(0).substr(start, Math.max(0, n(2))) : s(0).slice(start);
      }
      case 'STR$': need(1); return formatNumber(n(0));
      case 'VAL': {
        need(1);
        const v = parseFloat(s(0));
        return isNaN(v) ? 0 : v;
      }
      case 'CHR$': need(1); return String.fromCharCode(n(0));
      case 'ASC': {
        need(1);
        if (s(0).length === 0) throw this.err('Illegal function call');
        return s(0).charCodeAt(0);
      }
      case 'UCASE$': need(1); return s(0).toUpperCase();
      case 'LCASE$': need(1); return s(0).toLowerCase();
      case 'SPACE$': need(1); return ' '.repeat(Math.max(0, n(0)));
      case 'INKEY$': need(0); return this.io.inkey?.() ?? '';
      case 'KEYDOWN': need(1); return this.io.keyDown?.(n(0)) ? -1 : 0;
      case 'KEYUP': need(1); return this.io.keyDown?.(n(0)) ? 0 : -1;
      case 'PEEK': need(1); return this.io.peek?.(n(0)) ?? 0;
      case 'FRE': need(1); return this.freeMemory();
      case 'INSTR': need(2); return s(0).indexOf(s(1)) + 1;
    }
    throw this.err(`Unknown function ${name}`);
  }
}
