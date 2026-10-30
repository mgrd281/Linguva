/**
 * Pictures for the simulated stores' images (FakeShopifyStore): small flat
 * drawings, so product, collection and blog post images load in browser
 * tests and screenshots. The UI test server answers
 * FIXTURE_IMAGE_PATH<name>.svg with them (tests/ui/server/preload.ts), the
 * way Shopify's CDN serves a store's images; other suites only see the URLs.
 * Test data only: tests/ never ships (.dockerignore).
 */

/** Where the simulated stores' images live on the test server's origin. */
export const FIXTURE_IMAGE_PATH = "/__fixtures/img/";

const svg = (background: string, drawing: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="${background}"/>${drawing}</svg>`;

export const FIXTURE_PICTURES = {
  jacket: svg(
    "#FDECEA",
    '<path d="M58 34h44l28 24-11 24-11-7v51H52V75l-11 7-11-24z" fill="#D9483B"/><path d="M68 34h24l-4 15H72z" fill="#B23A2F"/><path d="M80 49v78" stroke="#8F2E25" stroke-width="3"/><circle cx="89" cy="72" r="3" fill="#6E231C"/><circle cx="89" cy="92" r="3" fill="#6E231C"/>',
  ),
  sweater: svg(
    "#E3ECF7",
    '<path d="M56 38h48l30 24-12 25-12-8v49H50V79l-12 8-12-25z" fill="#2E4A7D"/><path d="M66 38q14 14 28 0" fill="none" stroke="#C9D6EA" stroke-width="5"/><path d="M50 96h60" stroke="#C9D6EA" stroke-width="5" stroke-dasharray="6 5"/>',
  ),
  shoes: svg(
    "#FDE8E1",
    '<path d="M30 100c0-14 7-31 15-39h23l9 17c11 4 31 8 45 12 9 2 13 8 13 14v6H30z" fill="#E4572E"/><path d="M30 110h105v10H30z" fill="#3B3B3B"/><path d="M68 70l6 10M77 66l6 10" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>',
  ),
  bottle: svg(
    "#E2F3F8",
    '<rect x="66" y="26" width="28" height="16" rx="4" fill="#2F3E46"/><rect x="58" y="42" width="44" height="94" rx="14" fill="#3A86C8"/><rect x="58" y="76" width="44" height="22" fill="#9CC9EE"/>',
  ),
  beanie: svg(
    "#E3F4EE",
    '<circle cx="80" cy="42" r="12" fill="#1F6F57"/><path d="M38 106c0-31 19-54 42-54s42 23 42 54z" fill="#2E8B6E"/><rect x="34" y="102" width="92" height="22" rx="6" fill="#1F6F57"/><path d="M54 62v40M69 55v47M91 55v47M106 62v40" stroke="#1F6F57" stroke-width="3"/>',
  ),
  tent: svg(
    "#E6F2E3",
    '<path d="M80 32l54 94H26z" fill="#E8742A"/><path d="M80 32l18 94H62z" fill="#B4521A"/><path d="M18 126h124" stroke="#5B7F4A" stroke-width="4" stroke-linecap="round"/>',
  ),
  mountains: svg(
    "#DCEBF5",
    '<circle cx="118" cy="44" r="12" fill="#F5C542"/><path d="M0 132l46-62 30 38 22-26 62 50v28H0z" fill="#4E7D5B"/><path d="M46 70l10 14-10-4-10 4z" fill="#FFFFFF"/>',
  ),
  forest: svg(
    "#E9F1E4",
    '<rect y="120" width="160" height="40" fill="#A7C79A"/><path d="M38 122l18-42 18 42zM68 122l22-56 22 56zM102 122l17-36 17 36z" fill="#2F6B45"/>',
  ),
  trousers: svg(
    "#ECE8F6",
    '<rect x="50" y="26" width="60" height="12" rx="3" fill="#463A6B"/><path d="M50 38h60l-4 96H86l-6-64-6 64H54z" fill="#5E4F8F"/><path d="M62 38v14M98 38v14" stroke="#463A6B" stroke-width="3" stroke-linecap="round"/>',
  ),
  vest: svg(
    "#FFF3DC",
    '<path d="M60 30l8 8h24l8-8 20 16-6 18v66H46V64l-6-18z" fill="#E09B2D"/><path d="M80 38v92" stroke="#B87A1C" stroke-width="3"/><path d="M48 70h64M48 92h64M48 114h64" stroke="#C7861F" stroke-width="3"/>',
  ),
  socks: svg(
    "#E5EFF7",
    '<rect x="60" y="26" width="32" height="14" rx="3" fill="#2C5A80"/><path d="M60 40h32v46l24 20c9 8 5 24-8 24H84c-14 0-24-10-24-24z" fill="#3F7CAC"/><circle cx="104" cy="122" r="7" fill="#9CC2E0"/><path d="M60 92q14 6 32-6" fill="none" stroke="#9CC2E0" stroke-width="4"/>',
  ),
} as const;

export type FixturePicture = keyof typeof FIXTURE_PICTURES;

/** The pictures an image gets when none is chosen, in turn (a fixed list, so adding a picture changes no existing default). */
export const FIXTURE_PICTURE_NAMES: readonly FixturePicture[] = ["jacket", "sweater", "shoes", "bottle", "beanie", "tent", "mountains", "forest"];

/** The SVG of a picture file name ("jacket.svg"), or null for anything else. */
export function fixturePicture(file: string): string | null {
  const match = /^([a-z]+)\.svg$/.exec(file);
  return match && Object.hasOwn(FIXTURE_PICTURES, match[1]!) ? FIXTURE_PICTURES[match[1] as FixturePicture] : null;
}
