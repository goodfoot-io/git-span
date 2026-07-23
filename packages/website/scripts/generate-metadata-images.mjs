#!/usr/bin/env node

/**
 * Renders parameterized metadata PNGs (OG/Twitter share image, apple-touch-icon,
 * favicon PNG fallback) from a shared HTML/CSS template using Playwright.
 *
 * The template is a plain flex-centered layout: the mark image, plus an optional
 * tagline (icon-only renders omit it). Fonts are loaded via `@font-face` pointing
 * directly at the `IBM Plex Sans Variable` woff2 file on disk (a `file://` URL
 * resolved through the `@fontsource-variable/ibm-plex-sans` package), so rendering
 * never touches the network.
 *
 * Not wired into `yarn build` -- run explicitly via `yarn generate:images` (or
 * `node scripts/generate-metadata-images.mjs`) whenever the mark, palette, or copy
 * changes and the metadata PNGs need to be regenerated.
 *
 * Usage:
 *   node scripts/generate-metadata-images.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const FONT_FILE_URL = fileURLToPath(
  import.meta.resolve('@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-standard-normal.woff2')
);

/**
 * Builds a full HTML document string for a metadata image render.
 *
 * @param {object} params
 * @param {string} params.logoSrc - Absolute `file://` URL to the logo SVG.
 * @param {string} [params.tagline] - Tagline text; omitted/empty renders the mark alone.
 * @param {string} params.backgroundColor - Page background color.
 * @param {string} params.inkColor - Tagline text color.
 * @param {number} params.width - Render width in CSS pixels.
 * @param {number} params.height - Render height in CSS pixels.
 * @returns {string} A complete HTML document.
 */
function renderTemplate({ logoSrc, tagline, backgroundColor, inkColor, width, height }) {
  const logoSize = Math.round(Math.min(width, height) * 0.32);
  const taglineMarkup = tagline
    ? `<p class="tagline">${escapeHtml(tagline)}</p>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'IBM Plex Sans Variable';
    src: url('file://${FONT_FILE_URL}') format('woff2');
    font-weight: 100 700;
    font-style: normal;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: ${backgroundColor};
  }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    font-family: 'IBM Plex Sans Variable', ui-sans-serif, system-ui, sans-serif;
  }
  .logo {
    width: ${logoSize}px;
    height: ${logoSize}px;
  }
  .tagline {
    color: ${inkColor};
    font-size: 32px;
    font-weight: 500;
    text-align: center;
    max-width: 90%;
  }
</style>
</head>
<body>
  <img class="logo" src="${logoSrc}" alt="" />
  ${taglineMarkup}
</body>
</html>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const OG_TAGLINE = 'Git tracks changes. Spans track connections.';
const GROUND = '#f4f1e8';
const INK_PRIMARY = '#1b1e23';

const logoAccentUrl = `file://${path.join(PUBLIC_DIR, 'logo-accent.svg')}`;

/** Parameter sets for each metadata image to render. */
const IMAGE_SETS = [
  {
    name: 'og-image',
    width: 1200,
    height: 630,
    logoSrc: logoAccentUrl,
    tagline: OG_TAGLINE,
    backgroundColor: GROUND,
    inkColor: INK_PRIMARY,
    outputPath: path.join(PUBLIC_DIR, 'og-image.png'),
  },
  {
    name: 'apple-touch-icon',
    width: 180,
    height: 180,
    logoSrc: logoAccentUrl,
    tagline: '',
    backgroundColor: GROUND,
    inkColor: INK_PRIMARY,
    outputPath: path.join(PUBLIC_DIR, 'apple-touch-icon.png'),
  },
  {
    name: 'favicon',
    // .ico generation is out of scope for this script -- a PNG fallback satisfies
    // the card's requirement without adding an ico-conversion dependency.
    width: 48,
    height: 48,
    logoSrc: logoAccentUrl,
    tagline: '',
    backgroundColor: GROUND,
    inkColor: INK_PRIMARY,
    outputPath: path.join(PUBLIC_DIR, 'favicon.png'),
  },
];

async function main() {
  const browser = await chromium.launch();
  // Chromium refuses to load file:// resources (the logo SVG, the font file) from a
  // page with no document URL, which is what `page.setContent()` produces. Writing the
  // template to a real file:// HTML document and navigating to it with `page.goto()`
  // gives the page a file:// origin, so its own file:// <img>/@font-face references load.
  const workDir = mkdtempSync(path.join(tmpdir(), 'git-span-metadata-images-'));
  try {
    for (const set of IMAGE_SETS) {
      const page = await browser.newPage({
        viewport: { width: set.width, height: set.height },
        deviceScaleFactor: 1,
      });
      try {
        const html = renderTemplate(set);
        const htmlPath = path.join(workDir, `${set.name}.html`);
        writeFileSync(htmlPath, html);
        await page.goto(`file://${htmlPath}`);
        await page.screenshot({ path: set.outputPath, omitBackground: false });
        console.log(`Wrote ${set.outputPath} (${set.width}x${set.height})`);
      } finally {
        await page.close();
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    await browser.close();
  }
}

await main();
