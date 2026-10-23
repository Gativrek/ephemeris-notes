/** Settings > Math (SPECS 10.3, 10.4): numbering mode, reference format, KaTeX macros. */
import { useState } from 'react';
import { parseMacros } from '../../editor/math';
import { useSettings } from '../../lib/settings';
import { mathSettingsStrings as s } from '../../strings/settings';

function macrosText(v: unknown): string {
  return Object.entries(parseMacros(v))
    .map(([k, val]) => `${k} = ${val}`)
    .join('\n');
}

/** "\R = \mathbb{R}" per line; "#" starts a comment line. */
export function parseMacroLines(text: string): { macros: Record<string, string>; errors: number[] } {
  const macros: Record<string, string> = {};
  const errors: number[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(\\[A-Za-z]+)\s*=\s*(.+)$/.exec(line);
    if (m) macros[m[1]!] = m[2]!.trim();
    else errors.push(i + 1);
  });
  return { macros, errors };
}

export function MathSection() {
  const values = useSettings((st) => st.values);
  const set = useSettings((st) => st.set);
  const [text, setText] = useState(() => macrosText(values['library.math.macros']));
  const [errors, setErrors] = useState<number[]>([]);
  const numbering = values['math.numbering'] === 'labeled' ? 'labeled' : 'all';
  const format = (values['math.referenceFormat'] as string) || 'eq';
  return (
    <div className="vx-settings__page" data-testid="settings-math">
      <h2 className="vx-settings__h">{s.title}</h2>
      <section className="vx-settings__group">
        <div className="vx-settings__item">
          <div>
            <div className="vx-settings__label">{s.numbering}</div>
            <p className="vx-settings__hint">{s.numberingHint}</p>
          </div>
          <select
            className="vx-select"
            aria-label={s.numbering}
            value={numbering}
            onChange={(e) => void set('math.numbering', e.target.value)}
          >
            <option value="all">{s.all}</option>
            <option value="labeled">{s.labeled}</option>
          </select>
        </div>
      </section>
      <section className="vx-settings__group">
        <div className="vx-settings__item">
          <div>
            <div className="vx-settings__label">{s.format}</div>
            <p className="vx-settings__hint">{s.formatHint}</p>
          </div>
          <select
            className="vx-select"
            aria-label={s.format}
            value={format}
            onChange={(e) => void set('math.referenceFormat', e.target.value)}
          >
            <option value="eq">Eq. (3)</option>
            <option value="paren">(3)</option>
            <option value="word">Equation 3</option>
          </select>
        </div>
      </section>
      <section className="vx-settings__group">
        <div>
          <div className="vx-settings__label">{s.macros}</div>
          <p className="vx-settings__hint">{s.macrosHint}</p>
        </div>
        <textarea
          className="vx-textarea"
          aria-label={s.macros}
          spellCheck={false}
          value={text}
          placeholder={'\\R = \\mathbb{R}\n\\norm = \\left\\lVert #1 \\right\\rVert'}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const r = parseMacroLines(text);
            setErrors(r.errors);
            if (!r.errors.length) void set('library.math.macros', r.macros);
          }}
        />
        {errors.length > 0 && (
          <p className="vx-dialog__error" role="alert">
            {s.macroErrors(errors)}
          </p>
        )}
      </section>
    </div>
  );
}
