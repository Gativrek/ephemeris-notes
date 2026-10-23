import type { ReactNode } from 'react';

export function Kbd({ children, word }: { children: ReactNode; word?: boolean }) {
  return (
    <span className={word ? 'vx-kbd vx-kbd--word' : 'vx-kbd'} aria-hidden="true">
      {children}
    </span>
  );
}

export function EnterCap({ className }: { className?: string }) {
  return (
    <span className={`vx-kbd vx-kbd--enter${className ? ` ${className}` : ''}`} aria-hidden="true">
      Enter
      <svg
        width="12"
        height="9"
        viewBox="0 0 12 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 1v3.5H2" />
        <path d="M4.5 1.8L1.6 4.5l2.9 2.7" />
      </svg>
    </span>
  );
}

/** A keyboard hint: caps, then the action in plain text. */
export function Hint({
  keys,
  children,
}: {
  keys: Array<{ label: string; word?: boolean }>;
  children: ReactNode;
}) {
  return (
    <span className="vx-hint">
      <span className="vx-hint__keys">
        {keys.map((k) => (
          <Kbd key={k.label} word={k.word}>
            {k.label}
          </Kbd>
        ))}
      </span>
      {children}
    </span>
  );
}
