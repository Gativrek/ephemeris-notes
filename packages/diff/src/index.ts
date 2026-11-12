/**
 * Line and word differences between two texts, for the Git timeline (SPECS 4.12): Myers'
 * O(ND) algorithm on lines, then on words within changed lines, and rows with folded
 * context for display. Line ends are compared without their CR, so CRLF and LF agree.
 */

export type OpType = 'equal' | 'insert' | 'delete';
export interface Op {
  type: OpType;
  /** Lines of `a` (equal, delete) or `b` (insert). */
  lines: string[];
}

/** Past this many changes the middle is reported as replaced whole: the trace grows as the square. */
const MAX_EDITS = 4000;

function myers<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean,
): Array<{ type: OpType; item: T }> {
  // Common prefix and suffix first: most versions differ in a few places.
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start]!, b[start]!)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1]!, b[endB - 1]!)) {
    endA--;
    endB--;
  }
  const out: Array<{ type: OpType; item: T }> = [];
  for (let i = 0; i < start; i++) out.push({ type: 'equal', item: a[i]! });
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  const max = n + m;
  const middle: Array<{ type: OpType; item: T }> = [];
  if (n === 0) for (const item of B) middle.push({ type: 'insert', item });
  else if (m === 0) for (const item of A) middle.push({ type: 'delete', item });
  else {
    const v = new Int32Array(2 * max + 1);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && v[max + k - 1]! < v[max + k + 1]!) ? v[max + k + 1]! : v[max + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && eq(A[x]!, B[y]!)) {
          x++;
          y++;
        }
        v[max + k] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
      if (found !== -1) break;
    }
    if (found === -1) {
      for (const item of A) middle.push({ type: 'delete', item });
      for (const item of B) middle.push({ type: 'insert', item });
    } else {
      // Walk the trace back from the end.
      let x = n;
      let y = m;
      const rev: Array<{ type: OpType; item: T }> = [];
      for (let d = found; d > 0; d--) {
        const vd = trace[d]!;
        const k = x - y;
        const prevK = k === -d || (k !== d && vd[max + k - 1]! < vd[max + k + 1]!) ? k + 1 : k - 1;
        const prevX = vd[max + prevK]!;
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
          rev.push({ type: 'equal', item: A[--x]! });
          y--;
        }
        if (x === prevX) rev.push({ type: 'insert', item: B[--y]! });
        else rev.push({ type: 'delete', item: A[--x]! });
      }
      while (x > 0 && y > 0) {
        rev.push({ type: 'equal', item: A[--x]! });
        y--;
      }
      middle.push(...rev.reverse());
    }
  }
  out.push(...middle);
  for (let i = endA; i < a.length; i++) out.push({ type: 'equal', item: a[i]! });
  return out;
}

/** The text's lines, without line ends. */
export function splitLines(text: string): string[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  // A final line end does not start another line.
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Line operations turning `a` into `b`, adjacent ones of a kind joined. */
export function diffLines(a: string, b: string): Op[] {
  const ops: Op[] = [];
  for (const { type, item } of myers(splitLines(a), splitLines(b), (x, y) => x === y)) {
    const last = ops.at(-1);
    if (last && last.type === type) last.lines.push(item);
    else ops.push({ type, lines: [item] });
  }
  return ops;
}

export function countChanges(ops: Op[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.type === 'insert') added += o.lines.length;
    if (o.type === 'delete') removed += o.lines.length;
  }
  return { added, removed };
}

export interface WordPart {
  text: string;
  /** Changed in this line: removed (in an old line) or added (in a new one). */
  changed: boolean;
}

/** Word marks for a changed line pair: the parts of `a` and of `b` that differ. */
export function diffWords(a: string, b: string): { old: WordPart[]; new: WordPart[] } {
  const tokens = (s: string) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const old: WordPart[] = [];
  const now: WordPart[] = [];
  const push = (list: WordPart[], text: string, changed: boolean) => {
    const last = list.at(-1);
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const { type, item } of myers(tokens(a), tokens(b), (x, y) => x === y)) {
    if (type !== 'insert') push(old, item, type === 'delete');
    if (type !== 'delete') push(now, item, type === 'insert');
  }
  return { old, new: now };
}

export type Row =
  | { kind: 'equal'; text: string; oldLine: number; newLine: number }
  | { kind: 'delete'; text: string; oldLine: number; words?: WordPart[] }
  | { kind: 'insert'; text: string; newLine: number; words?: WordPart[] }
  /** Unchanged lines left out: `count` of them, from `oldLine`/`newLine`. */
  | { kind: 'fold'; count: number; oldLine: number; newLine: number };

/**
 * Display rows: changes with `context` unchanged lines around them, the rest folded. A
 * removed block followed by an added one is paired line by line for word marks.
 */
export function rows(ops: Op[], context = 3): Row[] {
  const out: Row[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.type === 'equal') {
      const first = i === 0;
      const last = i === ops.length - 1;
      const keepHead = first ? 0 : context;
      const keepTail = last ? 0 : context;
      if (op.lines.length > keepHead + keepTail + 1) {
        for (let j = 0; j < keepHead; j++)
          out.push({ kind: 'equal', text: op.lines[j]!, oldLine: oldLine + j, newLine: newLine + j });
        const count = op.lines.length - keepHead - keepTail;
        out.push({ kind: 'fold', count, oldLine: oldLine + keepHead, newLine: newLine + keepHead });
        for (let j = op.lines.length - keepTail; j < op.lines.length; j++)
          out.push({ kind: 'equal', text: op.lines[j]!, oldLine: oldLine + j, newLine: newLine + j });
      } else
        for (const [j, text] of op.lines.entries())
          out.push({ kind: 'equal', text, oldLine: oldLine + j, newLine: newLine + j });
      oldLine += op.lines.length;
      newLine += op.lines.length;
    } else if (op.type === 'delete') {
      const next = ops[i + 1];
      const added = next?.type === 'insert' ? next.lines : [];
      for (const [j, text] of op.lines.entries()) {
        const pair = added[j];
        out.push({
          kind: 'delete',
          text,
          oldLine: oldLine + j,
          ...(pair !== undefined ? { words: diffWords(text, pair).old } : {}),
        });
      }
      oldLine += op.lines.length;
      if (added.length) {
        for (const [j, text] of added.entries()) {
          const pair = op.lines[j];
          out.push({
            kind: 'insert',
            text,
            newLine: newLine + j,
            ...(pair !== undefined ? { words: diffWords(pair, text).new } : {}),
          });
        }
        newLine += added.length;
        i++;
      }
    } else {
      for (const [j, text] of op.lines.entries()) out.push({ kind: 'insert', text, newLine: newLine + j });
      newLine += op.lines.length;
    }
  }
  return out;
}
