import { BasicError, Token } from './lexer.js';

export type Value = number | string;

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'idx'; name: string; args: Expr[] }
  | { k: 'fn'; name: string; args: Expr[] }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr };

export type Target = { name: string; idx?: Expr[] };

export type Stmt =
  | { k: 'let'; target: Target; e: Expr }
  | { k: 'print'; items: { e?: Expr; sep: string }[] }
  | { k: 'input'; prompt?: string; targets: Target[] }
  | { k: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] }
  | { k: 'goto'; line: number }
  | { k: 'gosub'; line: number }
  | { k: 'return' }
  | { k: 'for'; name: string; from: Expr; to: Expr; step?: Expr }
  | { k: 'next'; name?: string }
  | { k: 'while'; cond: Expr }
  | { k: 'wend' }
  | { k: 'end' }
  | { k: 'dim'; decls: { name: string; dims: Expr[] }[] }
  | { k: 'data'; values: Value[] }
  | { k: 'read'; targets: Target[] }
  | { k: 'restore' }
  | { k: 'cls' }
  | { k: 'sleep'; e: Expr }
  | { k: 'color'; fg: Expr; bg?: Expr }
  | { k: 'locate'; row: Expr; col: Expr }
  | { k: 'poke'; addr: Expr; value: Expr }
  | { k: 'rem' };

export const FUNCS = new Set([
  'ABS', 'INT', 'SQR', 'SIN', 'COS', 'TAN', 'ATN', 'LOG', 'EXP', 'SGN', 'RND',
  'LEN', 'LEFT$', 'RIGHT$', 'MID$', 'STR$', 'VAL', 'CHR$', 'ASC', 'UCASE$', 'LCASE$',
  'INSTR', 'SPACE$', 'INKEY$', 'KEYDOWN', 'KEYUP', 'PEEK', 'FRE',
]);

const RESERVED = new Set([
  'LET', 'PRINT', 'INPUT', 'IF', 'THEN', 'ELSE', 'GOTO', 'GOSUB', 'RETURN', 'FOR', 'TO',
  'STEP', 'NEXT', 'WHILE', 'WEND', 'END', 'STOP', 'DIM', 'DATA', 'READ', 'RESTORE',
  'AND', 'OR', 'NOT', 'MOD', 'REM', 'CLS', 'SLEEP', 'COLOR', 'LOCATE', 'POKE',
]);

export function parseDataValues(raw: string): Value[] {
  const out: Value[] = [];
  let cur = '';
  let inStr = false;
  let wasQuoted = false;
  const flush = () => {
    const s = cur.trim();
    if (wasQuoted) out.push(cur);
    else if (s !== '' && !isNaN(Number(s))) out.push(Number(s));
    else out.push(s);
    cur = '';
    wasQuoted = false;
  };
  for (const ch of raw) {
    if (ch === '"') {
      inStr = !inStr;
      if (inStr) { wasQuoted = true; cur = ''; }
    } else if (ch === ',' && !inStr) flush();
    else if (inStr || !wasQuoted) cur += ch;
  }
  flush();
  return out;
}

export class Parser {
  private p = 0;
  constructor(private toks: Token[], private line: number) {}

  private fail(msg: string): never {
    throw new BasicError(msg, this.line);
  }
  private peek(): Token | undefined { return this.toks[this.p]; }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }
  private isId(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'id' && t.v === v;
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) this.fail(`Syntax error: expected '${v}'`);
    this.p++;
  }
  private expectId(v: string): void {
    if (!this.isId(v)) this.fail(`Syntax error: expected ${v}`);
    this.p++;
  }
  private atEnd(): boolean { return this.p >= this.toks.length; }

  parseLine(): Stmt[] {
    const out = this.parseStatements(false);
    if (!this.atEnd()) this.fail('Syntax error');
    return out;
  }

  private parseStatements(inIf: boolean): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      while (this.isOp(':')) this.p++;
      if (this.atEnd()) break;
      if (inIf && this.isId('ELSE')) break;
      out.push(this.parseStatement());
      if (this.atEnd()) break;
      if (this.isOp(':')) continue;
      if (inIf && this.isId('ELSE')) break;
      this.fail('Syntax error');
    }
    return out;
  }

  private lineNumber(): number {
    const t = this.peek();
    if (!t || t.t !== 'num' || !Number.isInteger(t.v)) this.fail('Syntax error: line number expected');
    this.p++;
    return (t as { v: number }).v;
  }

  private parseTarget(): Target {
    const t = this.peek();
    if (!t || t.t !== 'id' || RESERVED.has(t.v) || FUNCS.has(t.v)) this.fail('Syntax error: variable expected');
    this.p++;
    const name = (t as { v: string }).v;
    if (this.isOp('(')) return { name, idx: this.parseArgs() };
    return { name };
  }

  private parseTargets(): Target[] {
    const list = [this.parseTarget()];
    while (this.isOp(',')) { this.p++; list.push(this.parseTarget()); }
    return list;
  }

  private parseArgs(): Expr[] {
    this.expectOp('(');
    const args: Expr[] = [];
    if (!this.isOp(')')) {
      args.push(this.parseExpr());
      while (this.isOp(',')) { this.p++; args.push(this.parseExpr()); }
    }
    this.expectOp(')');
    return args;
  }

  private parseBranch(): Stmt[] {
    const t = this.peek();
    if (t && t.t === 'num') return [{ k: 'goto', line: this.lineNumber() }];
    return this.parseStatements(true);
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    if (!t || t.t !== 'id') this.fail('Syntax error');
    const word = (t as { v: string }).v;
    switch (word) {
      case 'LET':
        this.p++;
        return this.parseAssign();
      case 'PRINT': {
        this.p++;
        const items: { e?: Expr; sep: string }[] = [];
        while (!this.atEnd() && !this.isOp(':') && !this.isId('ELSE')) {
          const e = this.parseExpr();
          let sep = '';
          if (this.isOp(';') || this.isOp(',')) {
            sep = (this.peek() as { v: string }).v;
            this.p++;
          }
          items.push({ e, sep });
          if (sep === '') break;
        }
        // trailing separator with nothing after: items' last sep carries it
        return { k: 'print', items };
      }
      case 'INPUT': {
        this.p++;
        let prompt: string | undefined;
        const n = this.peek();
        if (n && n.t === 'str') {
          prompt = n.v;
          this.p++;
          if (this.isOp(';') || this.isOp(',')) this.p++;
        }
        return { k: 'input', prompt, targets: this.parseTargets() };
      }
      case 'IF': {
        this.p++;
        const cond = this.parseExpr();
        if (this.isId('THEN')) this.p++;
        else if (!this.isId('GOTO')) this.fail('Syntax error: expected THEN');
        const then = this.parseBranchAfterThen();
        let els: Stmt[] = [];
        if (this.isId('ELSE')) {
          this.p++;
          els = this.parseBranch();
        }
        return { k: 'if', cond, then, else: els };
      }
      case 'GOTO':
        this.p++;
        return { k: 'goto', line: this.lineNumber() };
      case 'GOSUB':
        this.p++;
        return { k: 'gosub', line: this.lineNumber() };
      case 'RETURN':
        this.p++;
        return { k: 'return' };
      case 'FOR': {
        this.p++;
        const v = this.parseTarget();
        if (v.idx || v.name.endsWith('$')) this.fail('Syntax error: bad FOR variable');
        this.expectOp('=');
        const from = this.parseExpr();
        this.expectId('TO');
        const to = this.parseExpr();
        let step: Expr | undefined;
        if (this.isId('STEP')) { this.p++; step = this.parseExpr(); }
        return { k: 'for', name: v.name, from, to, step };
      }
      case 'NEXT': {
        this.p++;
        const n = this.peek();
        if (n && n.t === 'id' && !RESERVED.has(n.v)) { this.p++; return { k: 'next', name: n.v }; }
        return { k: 'next' };
      }
      case 'WHILE':
        this.p++;
        return { k: 'while', cond: this.parseExpr() };
      case 'WEND':
        this.p++;
        return { k: 'wend' };
      case 'END':
      case 'STOP':
        this.p++;
        return { k: 'end' };
      case 'REM':
        this.p++;
        return { k: 'rem' };
      case 'DIM': {
        this.p++;
        const decls: { name: string; dims: Expr[] }[] = [];
        do {
          if (decls.length) this.p++;
          const tg = this.parseTarget();
          if (!tg.idx) this.fail('Syntax error: DIM needs dimensions');
          decls.push({ name: tg.name, dims: tg.idx! });
        } while (this.isOp(','));
        return { k: 'dim', decls };
      }
      case 'DATA': {
        this.p++;
        const d = this.peek();
        if (!d || d.t !== 'data') this.fail('Syntax error');
        this.p++;
        return { k: 'data', values: parseDataValues((d as { v: string }).v) };
      }
      case 'READ':
        this.p++;
        return { k: 'read', targets: this.parseTargets() };
      case 'RESTORE':
        this.p++;
        return { k: 'restore' };
      case 'CLS':
        this.p++;
        return { k: 'cls' };
      case 'SLEEP':
        this.p++;
        return { k: 'sleep', e: this.parseExpr() };
      case 'COLOR': {
        this.p++;
        const fg = this.parseExpr();
        let bg: Expr | undefined;
        if (this.isOp(',')) { this.p++; bg = this.parseExpr(); }
        return { k: 'color', fg, bg };
      }
      case 'LOCATE': {
        this.p++;
        const row = this.parseExpr();
        this.expectOp(',');
        return { k: 'locate', row, col: this.parseExpr() };
      }
      case 'POKE': {
        this.p++;
        const addr = this.parseExpr();
        this.expectOp(',');
        return { k: 'poke', addr, value: this.parseExpr() };
      }
      default:
        return this.parseAssign();
    }
  }

  private parseBranchAfterThen(): Stmt[] {
    return this.parseBranch();
  }

  private parseAssign(): Stmt {
    const target = this.parseTarget();
    this.expectOp('=');
    return { k: 'let', target, e: this.parseExpr() };
  }

  // ---- expressions ----
  parseExpr(): Expr { return this.parseOr(); }

  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isId('OR')) { this.p++; l = { k: 'bin', op: 'OR', l, r: this.parseAnd() }; }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseNot();
    while (this.isId('AND')) { this.p++; l = { k: 'bin', op: 'AND', l, r: this.parseNot() }; }
    return l;
  }
  private parseNot(): Expr {
    if (this.isId('NOT')) { this.p++; return { k: 'un', op: 'NOT', e: this.parseNot() }; }
    return this.parseCmp();
  }
  private parseCmp(): Expr {
    let l = this.parseAdd();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.p++;
        l = { k: 'bin', op: t.v, l, r: this.parseAdd() };
      } else return l;
    }
  }
  private parseAdd(): Expr {
    let l = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.peek() as { v: string }).v;
      this.p++;
      l = { k: 'bin', op, l, r: this.parseMul() };
    }
    return l;
  }
  private parseMul(): Expr {
    let l = this.parseUnary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.peek() as { v: string }).v;
        this.p++;
        l = { k: 'bin', op, l, r: this.parseUnary() };
      } else if (this.isId('MOD')) {
        this.p++;
        l = { k: 'bin', op: 'MOD', l, r: this.parseUnary() };
      } else return l;
    }
  }
  private parseUnary(): Expr {
    if (this.isOp('-')) { this.p++; return { k: 'un', op: '-', e: this.parseUnary() }; }
    if (this.isOp('+')) { this.p++; return this.parseUnary(); }
    return this.parsePower();
  }
  private parsePower(): Expr {
    const base = this.parsePrimary();
    if (this.isOp('^')) {
      this.p++;
      return { k: 'bin', op: '^', l: base, r: this.parseUnary() };
    }
    return base;
  }
  private parsePrimary(): Expr {
    const t = this.peek();
    if (!t) this.fail('Syntax error: unexpected end of line');
    switch (t!.t) {
      case 'num': this.p++; return { k: 'num', v: (t as { v: number }).v };
      case 'str': this.p++; return { k: 'str', v: (t as { v: string }).v };
      case 'op':
        if (t!.v === '(') {
          this.p++;
          const e = this.parseExpr();
          this.expectOp(')');
          return e;
        }
        return this.fail(`Syntax error: unexpected '${t!.v}'`);
      case 'id': {
        const name = t!.v;
        if (FUNCS.has(name)) {
          this.p++;
          const args = this.isOp('(') ? this.parseArgs() : [];
          return { k: 'fn', name, args };
        }
        if (RESERVED.has(name)) this.fail(`Syntax error: unexpected ${name}`);
        this.p++;
        if (this.isOp('(')) return { k: 'idx', name, args: this.parseArgs() };
        return { k: 'var', name };
      }
      default:
        return this.fail('Syntax error');
    }
  }
}
