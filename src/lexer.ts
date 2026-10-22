export class BasicError extends Error {
  constructor(message: string, public line?: number) {
    super(line !== undefined && line > 0 ? `${message} in line ${line}` : message);
    this.name = 'BasicError';
  }
}

export type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'data'; v: string };

const NUM_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const ID_RE = /^[A-Za-z][A-Za-z0-9]*\$?/;

/** Tokenize one source line (without its line number). */
export function tokenize(src: string, line: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === "'") break; // comment

    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') s += src[j++];
      if (j >= src.length) throw new BasicError('Unterminated string', line);
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }

    const rest = src.slice(i);
    const num = NUM_RE.exec(rest);
    if (num) {
      out.push({ t: 'num', v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }

    const id = ID_RE.exec(rest);
    if (id) {
      const word = id[0].toUpperCase();
      i += id[0].length;
      if (word === 'REM') break;
      if (word === 'DATA') {
        let j = i;
        let inStr = false;
        while (j < src.length && (inStr || src[j] !== ':')) {
          if (src[j] === '"') inStr = !inStr;
          j++;
        }
        out.push({ t: 'id', v: 'DATA' });
        out.push({ t: 'data', v: src.slice(i, j) });
        i = j;
        continue;
      }
      out.push({ t: 'id', v: word });
      continue;
    }

    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '?') { out.push({ t: 'id', v: 'PRINT' }); i++; continue; }
    if ('+-*/^(),;:=<>'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new BasicError(`Unexpected character '${c}'`, line);
  }
  return out;
}
