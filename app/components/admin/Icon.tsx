/**
 * The admin console's icons: small inline SVGs (no icon font, nothing
 * loaded from elsewhere), drawn with the text colour. Decorative only: a
 * text always stands next to them. Icons that point somewhere (arrows,
 * chevrons, "opens elsewhere", sign out) are mirrored in right-to-left
 * pages by admin.css (.adm-icon--dir).
 */
import type { ReactNode } from "react";

const PATHS = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  store: (
    <>
      <path d="M4 9.5V20h16V9.5" />
      <path d="M3 9.5 4.6 4h14.8L21 9.5" />
      <path d="M3 9.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6.5 15h4" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  signOut: (
    <>
      <path d="M9.5 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
      <path d="m16 16.5 4.5-4.5L16 7.5" />
      <path d="M20.5 12H9" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  external: (
    <>
      <path d="M14 3.5h6.5V10" />
      <path d="M20.5 3.5 11 13" />
      <path d="M18.5 14v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5" />
    </>
  ),
  chevronRight: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  chevronLeft: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  arrowLeft: (
    <>
      <path d="M19.5 12h-15" />
      <path d="m11 5.5-6.5 6.5 6.5 6.5" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4.5 12h15" />
      <path d="m13 5.5 6.5 6.5-6.5 6.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.5 20.5-4.8-4.8" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.7 2.7L16 9.7" />
    </>
  ),
  minus: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.5h.01" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v7.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12" />
      <path d="M12 8v12.5" />
      <path d="M12 8C10.5 5 7.5 3.5 7 5.5S9 8 12 8zM12 8c1.5-3 4.5-4.5 5-2.5S15 8 12 8z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11.2 11.8 8.8-8.8" />
      <path d="m16.5 6.5 3 3" />
      <path d="m14 9 2 2" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 3.5 12.9 9l5.6 2-5.6 2L11 18.5 9.1 13l-5.6-2 5.6-2z" />
      <path d="M18.5 15.5v5M16 18h5" />
    </>
  ),
  trend: (
    <>
      <path d="m3.5 17 5.5-5.5 4 4 7.5-7.5" />
      <path d="M15 8h5.5v5.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 9 4.5-9 4.5L3 8z" />
      <path d="m3 12.5 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  shield: <path d="M12 3 19.5 6v6c0 4.4-3.1 7.6-7.5 9-4.4-1.4-7.5-4.6-7.5-9V6z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** Icons that point in the reading direction: mirrored right to left. */
const DIRECTIONAL: ReadonlySet<IconName> = new Set(["signOut", "external", "chevronRight", "chevronLeft", "arrowLeft", "arrowRight"]);

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const classes = ["adm-icon", DIRECTIONAL.has(name) ? "adm-icon--dir" : null, className].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Linguva's mark: two speech marks crossing, on the accent square. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="adm-brandmark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" className="adm-brandmark__bg" />
      <path d="M9 9.5h9a3 3 0 0 1 3 3v3.5a3 3 0 0 1-3 3h-4.5L10 22v-3H9a3 3 0 0 1-3-3v-3.5a3 3 0 0 1 3-3z" className="adm-brandmark__fg" />
      <path d="M23.5 13.5h.5a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5h-.5v2.5l-3-2.5h-2" className="adm-brandmark__fg2" />
    </svg>
  );
}
