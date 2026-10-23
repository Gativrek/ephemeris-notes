/**
 * Renders a short piece of inline Markdown to DOM (table cells, previews), with the
 * same parser and link resolution as the editor.
 */
import type { SyntaxNode } from '@lezer/common';
import { markdownParser, splitTarget } from '@ephemeris-notes/markdown';
import type { EditorContext } from './context';
import { renderMath } from './math';
import { linkAttrs, linkClass } from './widgets';

export function renderInline(text: string, ctx: EditorContext): Node {
  const tree = markdownParser.parse(text);
  const frag = document.createDocumentFragment();
  const walk = (node: SyntaxNode, into: Node, from: number, to: number) => {
    let pos = from;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.from > pos) into.appendChild(document.createTextNode(text.slice(pos, c.from)));
      into.appendChild(renderNode(c));
      pos = c.to;
    }
    if (to > pos) into.appendChild(document.createTextNode(text.slice(pos, to)));
  };
  const inner = (node: SyntaxNode, tag: string, cls?: string) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    const marks = node
      .getChildren('EmphasisMark')
      .concat(node.getChildren('StrikethroughMark'), node.getChildren('CodeMark'));
    const start = marks.length ? marks[0]!.to : node.from;
    const end = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
    const holder = document.createElement('span');
    let pos = start;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.from < start || c.to > end) continue;
      if (c.from > pos) holder.appendChild(document.createTextNode(text.slice(pos, c.from)));
      holder.appendChild(renderNode(c));
      pos = c.to;
    }
    if (end > pos) holder.appendChild(document.createTextNode(text.slice(pos, end)));
    el.append(...holder.childNodes);
    return el;
  };
  const renderNode = (node: SyntaxNode): Node => {
    switch (node.name) {
      case 'StrongEmphasis':
        return inner(node, 'strong');
      case 'Emphasis':
        return inner(node, 'em');
      case 'Strikethrough':
        return inner(node, 's');
      case 'InlineCode':
        return inner(node, 'code', 'vx-cm-code');
      case 'InlineMath': {
        const c = node.getChild('MathContent');
        const marks = node.getChildren('MathMark');
        return renderMath(
          c ? text.slice(c.from, c.to) : '',
          (marks[0]?.to ?? 0) - (marks[0]?.from ?? 0) === 2,
          ctx.macros,
        );
      }
      case 'WikiLink':
      case 'Embed': {
        const t = node.getChild('WikiLinkTarget');
        const a = node.getChild('WikiLinkAlias');
        const raw = t ? text.slice(t.from, t.to) : '';
        const parts = splitTarget(raw);
        const r = ctx.resolve(parts.target);
        const el = document.createElement('span');
        el.className = linkClass({ path: r.path, candidates: r.candidates });
        linkAttrs(el, { ...parts, path: r.path });
        el.textContent = a ? text.slice(a.from, a.to) : raw.replace(/#\^?/, ' › ');
        return el;
      }
      case 'Link': {
        const url = node.getChild('URL');
        const marks = node.getChildren('LinkMark');
        const el = document.createElement('span');
        el.className = 'vx-cm-link';
        if (url) el.dataset.href = text.slice(url.from, url.to);
        el.dataset.vxLink = '1';
        el.textContent =
          marks.length >= 2 ? text.slice(marks[0]!.to, marks[1]!.from) : text.slice(node.from, node.to);
        return el;
      }
      case 'Tag': {
        const el = document.createElement('span');
        el.className = 'vx-cm-tag';
        el.textContent = text.slice(node.from, node.to);
        return el;
      }
      case 'Escape':
        return document.createTextNode(text.slice(node.from + 1, node.to));
      default: {
        const span = document.createElement('span');
        walk(node, span, node.from, node.to);
        return span;
      }
    }
  };
  const top = tree.topNode.firstChild;
  if (top) walk(top, frag, top.from, top.to);
  else frag.appendChild(document.createTextNode(text));
  return frag;
}
