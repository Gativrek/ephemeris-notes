/**
 * Fenced-block info strings (SPECS 10.10, 12.5): the first word is the language
 * (matched case-insensitively), the rest becomes positional and `key=value` arguments.
 */
export interface InfoString {
  language: string;
  /** Raw text after the language. */
  rest: string;
  args: { positional: string[]; named: Record<string, string> };
}

/** Splits on whitespace, honouring "double quotes" with \" escapes. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let has = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuote) {
      if (c === '\\' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

export function parseInfoString(info: string): InfoString {
  const trimmed = info.trim();
  const m = /^(\S+)\s*([\s\S]*)$/.exec(trimmed);
  const language = (m?.[1] ?? '').toLowerCase();
  const rest = m?.[2] ?? '';
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const token of splitArgs(rest)) {
    const eq = token.indexOf('=');
    if (eq > 0) named[token.slice(0, eq)] = token.slice(eq + 1);
    else positional.push(token);
  }
  return { language, rest, args: { positional, named } };
}
