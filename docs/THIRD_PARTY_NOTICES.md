# Third-party notices

Files from other projects that are part of the app itself (not npm dependencies, which carry their own licenses in `node_modules`).

## Country flags: country-flag-icons 1.6.20

| | |
|---|---|
| What | 265 country and region flags as SVG files in a 3:2 ratio (`3x2/*.svg` of the npm package) |
| Where | `public/flags/<CODE>.svg`, served by the app at `/flags/<CODE>.svg`; shown by `app/components/Flag.tsx` |
| Source | npm package [`country-flag-icons`](https://www.npmjs.com/package/country-flag-icons) version 1.6.20, files unchanged |
| License | MIT, copyright (c) 2020 @catamphetamine; the full text is in `public/flags/LICENSE.txt` |

Why vendored instead of a dependency: the app shows flags as plain images from its own origin (no new script or style host for the Content Security Policy), and emoji flags show as two letters on Windows.

The files are checked by `tests/unit/flags.test.ts`: the list of countries with a picture (`FLAG_COUNTRIES` in `app/lib/flags.ts`) matches the files, and every file is a plain drawing (only shapes such as `path`, `circle` and `rect` with drawing attributes; no scripts, styles, links or external references), because static files are served without the app's security headers. Run the test again when replacing the files with a newer version.
