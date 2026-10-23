/**
 * Frontmatter values (SPECS 10.6), read with the same Lezer YAML grammar that
 * highlights YAML in the editor. Read-only: the app never rewrites frontmatter.
 */
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/yaml';

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export interface YamlResult {
  value: YamlValue;
  /** Set when the YAML does not parse; the value is then null. */
  error: string | null;
}

function lineOf(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function plainScalar(s: string): YamlValue {
  const v = s.trim();
  if (v === '' || v === '~' || v === 'null' || v === 'Null' || v === 'NULL') return null;
  if (/^(true|True|TRUE)$/.test(v)) return true;
  if (/^(false|False|FALSE)$/.test(v)) return false;
  if (/^[-+]?(0|[1-9][0-9_]*)$/.test(v)) return Number(v.replace(/_/g, ''));
  if (/^[-+]?(\d[\d_]*)?\.\d+([eE][-+]?\d+)?$/.test(v) || /^[-+]?\d+(\.\d*)?[eE][-+]?\d+$/.test(v))
    return Number(v);
  return v;
}

function unquote(raw: string): string {
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  const body = raw.slice(1, -1);
  return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    switch (e[0]) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '0':
        return '\0';
      case 'u':
      case 'x':
        return String.fromCharCode(parseInt(e.slice(1), 16));
      default:
        return e;
    }
  });
}

function blockLiteral(node: SyntaxNode, text: string): string {
  const header = node.getChild('BlockLiteralHeader');
  const content = node.getChild('BlockLiteralContent');
  const style = header ? text.slice(header.from, header.to) : '|';
  if (!content) return '';
  const raw = text.slice(content.from, content.to).split('\n');
  const indent = Math.min(...raw.filter((l) => l.trim() !== '').map((l) => /^ */.exec(l)![0].length));
  const lines = raw.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
  const keep = style.includes('+');
  const strip = style.includes('-');
  let out = style.startsWith('>')
    ? lines.join('\n').replace(/([^\n])\n(?=[^\n ])/g, '$1 ')
    : lines.join('\n');
  if (strip) out = out.replace(/\n+$/, '');
  else if (!keep) out = out.replace(/\n*$/, '\n');
  return out;
}

function convert(node: SyntaxNode | null, text: string): YamlValue {
  if (!node) return null;
  switch (node.name) {
    case 'Document': {
      const child = node.firstChild;
      return child ? convert(child, text) : null;
    }
    case 'BlockMapping':
    case 'FlowMapping': {
      const out: { [key: string]: YamlValue } = {};
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name !== 'Pair') continue;
        const key = c.getChild('Key');
        const keyText = key?.firstChild ? String(convert(key.firstChild, text) ?? '') : '';
        let value: SyntaxNode | null = null;
        for (let v = key?.nextSibling ?? null; v; v = v.nextSibling) {
          if (v.name !== ':') {
            value = v;
            break;
          }
        }
        out[keyText] = convert(value, text);
      }
      return out;
    }
    case 'BlockSequence':
    case 'FlowSequence': {
      const out: YamlValue[] = [];
      for (let c = node.firstChild; c; c = c.nextSibling)
        if (c.name === 'Item') out.push(convert(c.firstChild, text));
      return out;
    }
    case 'Literal':
      return plainScalar(text.slice(node.from, node.to));
    case 'QuotedLiteral':
      return unquote(text.slice(node.from, node.to));
    case 'BlockLiteral':
      return blockLiteral(node, text);
    case 'Tagged': {
      const last = node.lastChild;
      return last ? convert(last, text) : null;
    }
    default:
      // Anchors, aliases and anything unusual stay as their source text.
      return text.slice(node.from, node.to).trim();
  }
}

export function parseYaml(text: string): YamlResult {
  if (text.trim() === '') return { value: {}, error: null };
  const tree = parser.parse(text);
  let errorAt = -1;
  tree.iterate({
    enter(n) {
      if (errorAt < 0 && n.type.isError) errorAt = n.from;
      return errorAt < 0;
    },
  });
  if (errorAt >= 0) return { value: null, error: `Invalid YAML near line ${lineOf(text, errorAt)}.` };
  const doc = tree.topNode.getChild('Document');
  return { value: convert(doc, text), error: null };
}
