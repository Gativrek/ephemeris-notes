/** Short relative times for meta lines: "just now", "5 min ago", "2 h ago", "3 days ago". */
export function relativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (d < 60) return `${w} weeks ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} months ago`;
  const y = Math.round(d / 365);
  return y === 1 ? 'a year ago' : `${y} years ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
