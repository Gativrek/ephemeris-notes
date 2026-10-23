/**
 * Code languages for fenced blocks (SPECS 10.5), loaded lazily by info string, and the
 * highlight styles: three code roles only (CodeBlock README), plus Markdown roles for
 * source mode.
 */
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const legacy = (load: () => Promise<StreamLanguage<unknown>>) => async () =>
  new LanguageSupport(await load());

export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'MATLAB',
    alias: ['matlab', 'octave', 'm'],
    load: legacy(async () =>
      StreamLanguage.define((await import('@codemirror/legacy-modes/mode/octave')).octave),
    ),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['python', 'py'],
    load: async () => (await import('@codemirror/lang-python')).python(),
  }),
  LanguageDescription.of({
    name: 'C',
    alias: ['c', 'h'],
    load: async () => (await import('@codemirror/lang-cpp')).cpp(),
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp', 'c++', 'cc', 'hpp', 'cxx'],
    load: async () => (await import('@codemirror/lang-cpp')).cpp(),
  }),
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'javascript', 'jsx', 'mjs'],
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'typescript', 'tsx'],
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['json', 'jsonc'],
    load: async () => (await import('@codemirror/lang-json')).json(),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yaml', 'yml'],
    load: async () => (await import('@codemirror/lang-yaml')).yaml(),
  }),
  LanguageDescription.of({
    name: 'Bash',
    alias: ['bash', 'sh', 'shell', 'zsh', 'console'],
    load: legacy(async () =>
      StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell),
    ),
  }),
  LanguageDescription.of({
    name: 'LaTeX',
    alias: ['latex', 'tex'],
    load: legacy(async () =>
      StreamLanguage.define((await import('@codemirror/legacy-modes/mode/stex')).stex),
    ),
  }),
];

/** Info strings that mean plain code: never "No renderer" for these. */
const PLAIN = new Set([
  '',
  'text',
  'txt',
  'plain',
  'plaintext',
  'output',
  'log',
  'diff',
  'html',
  'css',
  'xml',
  'sql',
  'rust',
  'go',
  'java',
  'csharp',
  'cs',
  'ruby',
  'r',
  'julia',
  'toml',
  'ini',
  'powershell',
  'ps1',
  'bat',
  'cmd',
  'makefile',
  'dockerfile',
  'markdown',
  'md',
]);

export function isCodeLanguage(lang: string): boolean {
  const l = lang.toLowerCase();
  return PLAIN.has(l) || codeLanguages.some((d) => d.alias.includes(l) || d.name.toLowerCase() === l);
}

export function findLanguage(info: string): LanguageDescription | null {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!lang) return null;
  return LanguageDescription.matchLanguageName(codeLanguages, lang, false);
}

/** Code: keywords, comments (italic) and built-ins, per the CodeBlock card. */
export const codeHighlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.self],
    class: 'tok-kw',
  },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'tok-cm' },
  {
    tag: [
      t.number,
      t.bool,
      t.null,
      t.atom,
      t.standard(t.variableName),
      t.function(t.standard(t.variableName)),
      t.special(t.variableName),
    ],
    class: 'tok-bi',
  },
]);

/** Markdown roles, visible in source mode and on the line being edited. */
export const markdownHighlight = HighlightStyle.define([
  { tag: t.strong, class: 'vx-cm-strong' },
  { tag: t.emphasis, class: 'vx-cm-em' },
  { tag: t.strikethrough, class: 'vx-cm-strike' },
  { tag: t.monospace, class: 'vx-cm-code' },
  { tag: [t.processingInstruction, t.contentSeparator], class: 'vx-cm-mark' },
  { tag: [t.url], class: 'vx-cm-url' },
  { tag: [t.link], class: 'vx-cm-link' },
  { tag: t.meta, class: 'vx-cm-meta' },
]);

/** Headings in source mode only; live preview styles heading lines itself. */
export const sourceHeadingHighlight = HighlightStyle.define([{ tag: t.heading, class: 'vx-cm-strong' }]);
