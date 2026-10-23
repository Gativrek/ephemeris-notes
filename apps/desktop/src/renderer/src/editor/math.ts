/**
 * KaTeX rendering (SPECS 10.3): `throwOnError: false` semantics with our own error
 * display (source in `danger`, KaTeX's message as a tooltip), `trust: false`,
 * `strict: 'warn'`, and the library's macros.
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';

const cache = new Map<string, string>();

export function renderMath(tex: string, display: boolean, macros: Record<string, string>): HTMLElement {
  const key = `${display ? 'D' : 'I'}${JSON.stringify(macros)}\u0000${tex}`;
  const wrap = document.createElement('span');
  const cached = cache.get(key);
  if (cached !== undefined) {
    wrap.innerHTML = cached;
    return wrap;
  }
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'warn',
      output: 'htmlAndMathml',
      // KaTeX mutates the macros object for \gdef; give it a copy.
      macros: { ...macros },
    });
    if (cache.size > 2000) cache.clear();
    cache.set(key, html);
    wrap.innerHTML = html;
  } catch (err) {
    wrap.className = 'vx-math-error';
    wrap.textContent = display ? `$$${tex}$$` : `$${tex}$`;
    wrap.title = err instanceof Error ? err.message : String(err);
  }
  return wrap;
}

/** Validates the macro setting: `{ "\\R": "\\mathbb{R}" }`. */
export function parseMacros(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/^\\[A-Za-z]+$/.test(k) && typeof val === 'string') out[k] = val;
  }
  return out;
}
