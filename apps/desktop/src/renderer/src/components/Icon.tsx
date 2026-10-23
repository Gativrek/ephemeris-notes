/**
 * The app's one icon set (design/components/Icon): inline SVG on a 24px grid,
 * stroke currentColor, 1.6 wide. Glyph paths are copied from the Icon README.
 */
import type { CSSProperties, ReactElement } from 'react';

const GLYPHS = {
  academic: (
    <>
      <path d="M2 9.5l10-5 10 5-10 5z" />
      <path d="M6 11.6v4.6c3.2 2.4 8.8 2.4 12 0v-4.6" />
      <path d="M22 9.5v5.5" />
    </>
  ),
  work: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 12.5h18" />
      <path d="M11 12.5v2h2v-2" />
    </>
  ),
  personal: (
    <>
      <path d="M3.5 11L12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  vaults: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  switch: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  note: (
    <>
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  'note-new': (
    <>
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M12.5 11v6M9.5 14h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="10" cy="18" r="2.5" />
      <path d="M8.4 6.3l7.2 1.3M6.8 8.4l2.4 7.2M16.4 10l-4.8 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  reading: (
    <>
      <path d="M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3z" />
      <path d="M21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 6 3 3H7l3-3z" />
      <path d="M12 13v7" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l4.5-1 10.2-10.2a2.1 2.1 0 0 0-3-3L5.5 16z" />
      <path d="M13.8 7.2l3 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  sort: <path d="M7 5v14M4 16l3 3 3-3M13 7h7M13 12h5M13 17h3" />,
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  estimation: (
    <>
      <path d="M3 18c3.5 0 4.5-11 9-11s5.5 11 9 11" />
      <path d="M3 20.5h18" />
    </>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" />
    </>
  ),
  gyro: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M4 12h16" />
    </>
  ),
  papers: (
    <>
      <path d="M8 3.5h7l4 4V18H8z" />
      <path d="M5 7v14h11" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13l2.2-8h11.6L20 13v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" />
      <path d="M12 17.2v.1" />
    </>
  ),
  minimize: <path d="M6 12h12" />,
  maximize: <rect x="6" y="6" width="12" height="12" rx="1" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export function Icon({
  name,
  size,
  className,
  style,
  strokeWidth,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  const s: CSSProperties = { ...style };
  if (size) {
    s.width = size;
    s.height = size;
  }
  if (strokeWidth) s.strokeWidth = strokeWidth;
  return (
    <svg
      className={className ? `vx-icon ${className}` : 'vx-icon'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={s}
    >
      {GLYPHS[name]}
    </svg>
  );
}
