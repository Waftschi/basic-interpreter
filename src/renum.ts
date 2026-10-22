import { BasicError } from './lexer.js';

const LINE_REFS = new Set(['GOTO', 'GOSUB', 'THEN', 'ELSE']);

/** Renumber a program, rewriting the line numbers that GOTO/GOSUB/THEN/ELSE refer to. */
export function renumber(program: Map<number, string>, start = 10, step = 10): Map<number, string> {
  if (!Number.isInteger(start) || !Number.isInteger(step) || start < 0 || step < 1) {
    throw new BasicError('Illegal function call');
  }
  const olds = [...program.keys()].sort((a, b) => a - b);
  const map = new Map(olds.map((n, i) => [n, start + i * step]));

  const rewrite = (text: string, line: number): string => {
    let out = '';
    let i = 0;
    let expectLine = false;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        const j = text.indexOf('"', i + 1);
        const end = j < 0 ? text.length : j + 1;
        out += text.slice(i, end);
        i = end;
        expectLine = false;
      } else if (c === "'") {
        return out + text.slice(i);
      } else if (/[A-Za-z]/.test(c)) {
        const word = /^[A-Za-z][A-Za-z0-9]*\$?/.exec(text.slice(i))![0];
        const up = word.toUpperCase();
        out += word;
        i += word.length;
        if (up === 'REM') return out + text.slice(i);
        if (up === 'DATA') {
          let inStr = false;
          while (i < text.length && (inStr || text[i] !== ':')) {
            if (text[i] === '"') inStr = !inStr;
            out += text[i++];
          }
        }
        expectLine = LINE_REFS.has(up);
      } else if (/\d|\./.test(c)) {
        const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i))![0];
        if (expectLine && /^\d+$/.test(num)) {
          const to = map.get(Number(num));
          if (to === undefined) throw new BasicError(`Undefined line ${num}`, line);
          out += to;
        } else out += num;
        i += num.length;
        expectLine = false;
      } else {
        out += c;
        i++;
        if (c !== ' ' && c !== '\t') expectLine = false;
      }
    }
    return out;
  };

  const result = new Map<number, string>();
  for (const n of olds) result.set(map.get(n)!, rewrite(program.get(n)!, n));
  return result;
}
