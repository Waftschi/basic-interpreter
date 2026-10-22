import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interpreter } from '../src/interpreter.js';
import { renumber } from '../src/renum.js';

async function run(src: string, inputs: string[] = []): Promise<string> {
  let out = '';
  const q = [...inputs];
  const interp = new Interpreter(
    {
      print: (s) => { out += s; },
      input: async (p) => { out += p; return q.length ? q.shift()! : null; },
    },
    { maxSteps: 100000, rng: () => 0.5 },
  );
  await interp.run(src);
  return out;
}

test('print and arithmetic precedence', async () => {
  assert.equal(await run('10 PRINT 2+3*4\n20 PRINT -2^2\n30 PRINT 2^3^2\n40 PRINT (1+2)*3'), '14\n-4\n512\n9\n');
});

test('strings and functions', async () => {
  const src = [
    '10 A$ = "Hello"',
    '20 PRINT A$ + ", " + "World"; LEN(A$)',
    '30 PRINT LEFT$(A$,2); RIGHT$(A$,2); MID$(A$,2,3)',
    '40 PRINT UCASE$(A$); STR$(42); VAL("3.5")',
    '50 PRINT INT(3.7); ABS(-2); SQR(16)',
  ].join('\n');
  assert.equal(await run(src), 'Hello, World5\nHeloell\nHELLO423.5\n324\n');
});

test('FOR/NEXT with STEP and empty loops', async () => {
  const src = '10 FOR I=1 TO 10 STEP 3: PRINT I;: NEXT I\n20 PRINT\n30 FOR I=5 TO 1: PRINT "no": NEXT\n40 FOR I=3 TO 1 STEP -1: PRINT I;: NEXT';
  assert.equal(await run(src), '14710\n321\n');
});

test('nested loops', async () => {
  const src = '10 FOR I=1 TO 2\n20 FOR J=1 TO 2\n30 PRINT I*10+J;\n40 NEXT J\n50 NEXT I';
  assert.equal(await run(src), '11122122\n');
});

test('GOSUB/RETURN and GOTO', async () => {
  const src = '10 GOSUB 100\n20 PRINT "back"\n30 GOTO 50\n40 PRINT "skipped"\n50 END\n100 PRINT "sub"\n110 RETURN';
  assert.equal(await run(src), 'sub\nback\n');
});

test('IF/THEN/ELSE', async () => {
  const src = '10 FOR I=1 TO 3\n20 IF I=2 THEN PRINT "two" ELSE PRINT "other"\n30 NEXT\n40 IF 1 THEN 60\n50 PRINT "no"\n60 PRINT "done"';
  assert.equal(await run(src), 'other\ntwo\nother\ndone\n');
});

test('comparison, AND/OR/NOT', async () => {
  assert.equal(await run('10 PRINT 1<2; 2<1; (1<2) AND (2<3); NOT 0; "a"<"b"'), '-10-1-1-1\n');
});

test('WHILE/WEND', async () => {
  assert.equal(await run('10 I=0\n20 WHILE I<3\n30 PRINT I;\n40 I=I+1\n50 WEND\n60 PRINT "x"'), '012x\n');
});

test('arrays', async () => {
  const src = '10 DIM A(5), M(2,2)\n20 FOR I=0 TO 5: A(I)=I*I: NEXT\n30 M(1,2)=7\n40 PRINT A(4); M(1,2); M(0,0)';
  assert.equal(await run(src), '1670\n');
});

test('DATA/READ/RESTORE', async () => {
  const src = '10 READ A, B$\n20 PRINT A; B$\n30 RESTORE\n40 READ C\n50 PRINT C\n60 DATA 5, "hi there"';
  assert.equal(await run(src), '5hi there\n5\n');
});

test('INPUT', async () => {
  const src = '10 INPUT "Name"; N$\n20 INPUT X, Y\n30 PRINT N$; X+Y';
  assert.equal(await run(src, ['Ada', '3, 4']), 'Name? ? Ada7\n');
});

test('INPUT retries on bad number', async () => {
  const out = await run('10 INPUT X\n20 PRINT X', ['abc', '9']);
  assert.match(out, /Redo from start/);
  assert.ok(out.endsWith('9\n'));
});

test('print zones with comma', async () => {
  assert.equal(await run('10 PRINT 1, 2'), '1' + ' '.repeat(13) + '2\n');
});

test('REM, colon separators, lowercase keywords', async () => {
  assert.equal(await run('10 rem nothing\n20 print "a": print "b"\n30 x = 4 : print x'), 'a\nb\n4\n');
});

test('RND uses injected rng', async () => {
  assert.equal(await run('10 PRINT INT(RND(1)*10)'), '5\n');
});

test('errors carry line numbers', async () => {
  await assert.rejects(run('10 PRINT 1\n20 PRINT 1/0'), /Division by zero in line 20/);
  await assert.rejects(run('10 GOTO 99'), /Undefined line 99 in line 10/);
  await assert.rejects(run('10 RETURN'), /RETURN without GOSUB/);
  await assert.rejects(run('10 PRINT "a" + 1'), /Type mismatch/);
  await assert.rejects(run('10 PRINT )'), /Syntax error/);
});

test('immediate mode keeps variables after RUN', async () => {
  let out = '';
  const interp = new Interpreter({ print: (s) => { out += s; }, input: async () => null });
  await interp.run('10 X = 42');
  await interp.runImmediate('PRINT X * 2');
  assert.equal(out, '84\n');
});

test('infinite loop hits step limit', async () => {
  await assert.rejects(run('10 GOTO 10'), /Step limit/);
});

test('renumber rewrites line references but not strings, REM or DATA', () => {
  const prog = new Map([
    [1, 'PRINT "GOTO 2"'],
    [2, 'IF X = 1 THEN 5 ELSE GOSUB 5'],
    [5, "GOTO 1 : REM GOTO 2"],
    [7, 'DATA GOTO 5, 6'],
  ]);
  assert.deepEqual([...renumber(prog, 100, 5)], [
    [100, 'PRINT "GOTO 2"'],
    [105, 'IF X = 1 THEN 110 ELSE GOSUB 110'],
    [110, 'GOTO 100 : REM GOTO 2'],
    [115, 'DATA GOTO 5, 6'],
  ]);
});

test('renumber rejects references to missing lines', () => {
  assert.throws(() => renumber(new Map([[10, 'GOTO 99']])), /Undefined line 99/);
});

test('INKEY$, KEYDOWN, KEYUP, SLEEP and CLS use the host IO', async () => {
  let out = '';
  const keys = ['x', ''];
  const slept: number[] = [];
  const interp = new Interpreter({
    print: (s) => { out += s; },
    input: async () => null,
    cls: () => { out += '<cls>'; },
    sleep: async (ms) => { slept.push(ms); },
    inkey: () => keys.shift() ?? '',
    keyDown: (c) => c === 65,
  });
  await interp.run('10 CLS: SLEEP 25\n20 PRINT INKEY$; "|"; INKEY$; "|"; KEYDOWN(65); KEYUP(65); KEYDOWN(66); KEYUP(66)');
  assert.equal(out, '<cls>x||-100-1\n');
  assert.deepEqual(slept, [25]);
});

test('key functions default to "no key" without host support', async () => {
  assert.equal(await run('10 PRINT "["; INKEY$; "]"; KEYDOWN(65): CLS: SLEEP 5'), '[]0\n');
});

test('FRE(0) reports what is left of 8 KB', async () => {
  const src = '10 A=FRE(0)\n20 DIM B(99)\n30 C=FRE(0)\n40 PRINT A>C; C>0; A<8192';
  assert.equal(await run(src), '-1-1-1\n');
});

test('GOSUB inside an IF body resumes with the rest of that body', async () => {
  const src = '10 IF 1 THEN GOSUB 100: PRINT "b": PRINT "c"\n20 PRINT "d": END\n100 PRINT "a": RETURN';
  assert.equal(await run(src), 'a\nb\nc\nd\n');
});

test('two GOSUBs in one IF body both return into the body', async () => {
  const src = '10 IF 1 THEN GOSUB 100: GOSUB 100: PRINT "x"\n20 PRINT "y": END\n100 PRINT "a": RETURN';
  assert.equal(await run(src), 'a\na\nx\ny\n');
});
