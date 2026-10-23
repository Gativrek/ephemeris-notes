/** Semver range checks for plugin manifests (SPECS 12.2): the host, not the public API. */
/** True when `version` satisfies `range` (^, ~, >=, >, <=, <, =, x-ranges, || and spaces). */
export function satisfies(version: string, range: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(v.trim());
    if (!m) return null;
    const n = (s: string | undefined) => (s === undefined || s === 'x' || s === '*' ? null : Number(s));
    return [Number(m[1]), n(m[2]), n(m[3])] as [number, number | null, number | null];
  };
  const v = parse(version);
  if (!v || v[1] === null || v[2] === null) return false;
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  const vv = [v[0], v[1], v[2]];
  const one = (c: string): boolean => {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(c.trim());
    if (!m) return false;
    const r = parse(m[2]!);
    if (!r) return false;
    const [maj, min, pat] = r;
    const lo = [maj, min ?? 0, pat ?? 0];
    switch (m[1]) {
      case '^':
        return (
          cmp(vv, lo) >= 0 &&
          (maj > 0
            ? vv[0] === maj
            : min !== null && min > 0
              ? vv[0] === 0 && vv[1] === min
              : cmp(vv, [0, min ?? 0, (pat ?? 0) + 1]) < 0 && vv[0] === 0)
        );
      case '~':
        return cmp(vv, lo) >= 0 && vv[0] === maj && (min === null || vv[1] === min);
      case '>=':
        return cmp(vv, lo) >= 0;
      case '>':
        return cmp(vv, lo) > 0;
      case '<=':
        return cmp(vv, lo) <= 0;
      case '<':
        return cmp(vv, lo) < 0;
      default:
        // "1", "1.x" and "1.2.3".
        return vv[0] === maj && (min === null || vv[1] === min) && (pat === null || vv[2] === pat);
    }
  };
  return range.split('||').some((alt) => {
    const parts = alt.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every(one);
  });
}
