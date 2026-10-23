import type { CSSProperties, ReactNode } from 'react';

/** Double-hairline frame with corner brackets and gems (chooser and Vault dialog only). */
export function OrnamentFrame({
  dialog,
  className,
  children,
  label,
  role,
  style,
}: {
  dialog?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
  role?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={`vx-frame${dialog ? ' vx-frame--dialog' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      role={role}
      style={style}
    >
      <span className="vx-frame__corner vx-frame__corner--tl" />
      <span className="vx-frame__corner vx-frame__corner--tr" />
      <span className="vx-frame__corner vx-frame__corner--bl" />
      <span className="vx-frame__corner vx-frame__corner--br" />
      <span className="vx-frame__gems" aria-hidden="true">
        <span className="vx-gem" />
        <span className="vx-gem vx-gem--lg" />
        <span className="vx-gem" />
      </span>
      {children}
    </section>
  );
}
