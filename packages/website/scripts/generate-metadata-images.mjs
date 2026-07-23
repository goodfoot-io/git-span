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

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const DOCS_CONTENT_DIR = path.resolve(__dirname, '..', 'content', 'docs');
const DOCS_OG_DIR = path.join(PUBLIC_DIR, 'og', 'docs');
const DOC_OG_IMAGES_MANIFEST = path.resolve(__dirname, '..', 'app', 'lib', 'doc-og-images.json');

const FONT_FILE_URL = fileURLToPath(
  import.meta.resolve('@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-standard-normal.woff2')
);
// Same family as the site's `font-mono` token (global.css#L78: `--font-mono: 'IBM Plex Mono',
// ...`), which is what renders the homepage's "Install git-span" button text -- medium (500)
// rather than the button's semibold (600), a lighter weight for the larger title-row rendering.
const MONO_FONT_FILE_URL = fileURLToPath(
  import.meta.resolve('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2')
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
 * @param {'centered' | 'left-lockup'} [params.layout] - `centered` (default) stacks the mark
 *   above an optional tagline, both centered. `left-lockup` places the mark on the left,
 *   margin-pinned, sized to the combined height of a "git-span" title row (monospace) and a
 *   tagline row stacked to its right; the tagline never wraps and shrinks to fit its width.
 * @returns {{html: string, fit: {textColumnWidth: number, titleFontSize: number, taglineFontSize: number} | null}}
 *   `fit` is non-null only for `left-lockup` -- the caller must post-process the rendered page
 *   with {@link fitTextToWidth} using these values before screenshotting.
 */
function renderTemplate({ logoSrc, tagline, backgroundColor, inkColor, width, height, layout = 'centered' }) {
  if (layout === 'left-lockup') {
    return renderLeftLockupTemplate({ logoSrc, tagline, backgroundColor, inkColor, width, height });
  }

  const logoSize = Math.round(Math.min(width, height) * 0.32);
  const taglineMarkup = tagline
    ? `<p class="tagline">${escapeHtml(tagline)}</p>`
    : '';

  const html = `<!doctype html>
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
  return { html, fit: null };
}

// Left/right edge margin for the left-lockup layout. The logo's top/bottom padding matches this
// same value, so the logo's height is derived from the canvas height minus twice the margin --
// the row heights (and gap) are in turn derived from the logo's height, so the two text rows
// always exactly span the logo regardless of canvas size.
const EDGE_MARGIN = 80;
const ROW_GAP = 20;
const GIT_SPAN_TITLE = 'git-span';
const ROW_HEIGHT_FONT_CAP_RATIO = 0.85;
// "git-span"'s glyph ink renders at this multiple of the logo's height, vertically centered on
// the logo -- a straight 1:1 match reads visually smaller than the logo next to it.
const GIT_SPAN_TITLE_HEIGHT_SCALE = 1.890213;
// After centering, the title is shifted up an additional this fraction of the logo's height.
const GIT_SPAN_TITLE_RAISE_RATIO = 0.1;
// The title and tagline are each shifted left by this fraction of the canvas width.
const TITLE_SHIFT_LEFT_RATIO = 0.005;
const TAGLINE_SHIFT_LEFT_RATIO = 0.015;
// The tagline's available column (and font-size cap) is grown by this factor before fitting, so
// the enlarged text's left/right edges land flush with the title row's left edge and the canvas's
// right margin instead of underfilling them.
const TAGLINE_SCALE = 1.029;

/**
 * Measures `element`'s actual rendered width at its current font-size and rescales that
 * font-size so the text fills exactly `targetWidth` on one line (growing or shrinking as
 * needed), never exceeding `maxFontSize`. Uses the browser's own text layout via
 * `getBoundingClientRect` rather than an offline glyph-width estimate, so it is exact for any
 * string -- "git-span" or an arbitrary doc title -- instead of approximate.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {number} targetWidth - Available width in CSS pixels the text should fill.
 * @param {number} maxFontSize - Upper bound in CSS pixels (e.g. driven by row height).
 */
async function fitTextToWidth(page, selector, targetWidth, maxFontSize) {
  await page.evaluate(
    ({ selector, targetWidth, maxFontSize }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      // Font metrics don't scale perfectly linearly with font-size (sub-pixel rounding, hinting),
      // so an exact proportional rescale can still overflow by a pixel or two. Iterate down from
      // the linear estimate until the measured width actually fits, rather than trusting one shot.
      el.style.fontSize = `${maxFontSize}px`;
      const measuredWidth = el.getBoundingClientRect().width;
      let fitted = Math.floor(maxFontSize * (targetWidth / measuredWidth));
      fitted = Math.max(1, Math.min(maxFontSize, fitted));
      el.style.fontSize = `${fitted}px`;
      while (fitted > 1 && el.getBoundingClientRect().width > targetWidth) {
        fitted -= 1;
        el.style.fontSize = `${fitted}px`;
      }
    },
    { selector, targetWidth, maxFontSize }
  );
}

/**
 * Sizes and positions `element` so its glyph ink -- the tallest ascender to the lowest descender,
 * e.g. the top of "i" to the bottom of "g" in "git-span" -- spans `heightScale` times
 * `logoSelector`'s rendered height, with its ink-top aligned to the logo's top edge. Uses
 * `Range.getBoundingClientRect()` on the text node rather than the element's line-box
 * (`getBoundingClientRect()` on the element includes font leading above/below the glyphs, which
 * would leave a visible gap even at the "right" font-size).
 *
 * @param {import('playwright').Page} page
 * @param {string} textSelector
 * @param {string} logoSelector
 * @param {number} [heightScale] - Ink height as a multiple of the logo's height. 1 matches the
 *   logo's height exactly.
 * @param {number} [maxWidth] - If set, caps the element's rendered width -- the height-derived
 *   font-size shrinks further (keeping the ink-top alignment) rather than overflowing the canvas.
 * @param {number} [raiseRatio] - After vertically centering on the logo, shift the text up by
 *   this fraction of the logo's height.
 * @param {number} [shiftLeftPx] - Shift the text left by this many CSS pixels after alignment.
 */
async function alignTextInkToElement(
  page,
  textSelector,
  logoSelector,
  heightScale = 1,
  maxWidth = Infinity,
  raiseRatio = 0,
  shiftLeftPx = 0
) {
  await page.evaluate(
    ({ textSelector, logoSelector, heightScale, maxWidth, raiseRatio, shiftLeftPx }) => {
      const textEl = document.querySelector(textSelector);
      const logoEl = document.querySelector(logoSelector);
      if (!textEl || !logoEl) return;

      const inkRect = () => {
        const range = document.createRange();
        range.selectNodeContents(textEl);
        return range.getBoundingClientRect();
      };

      const targetHeight = logoEl.getBoundingClientRect().height * heightScale;
      let fontSize = Number.parseFloat(getComputedStyle(textEl).fontSize);
      for (let i = 0; i < 12; i++) {
        const height = inkRect().height;
        if (Math.abs(height - targetHeight) < 0.25) break;
        fontSize *= targetHeight / height;
        textEl.style.fontSize = `${fontSize}px`;
      }

      let width = textEl.getBoundingClientRect().width;
      while (width > maxWidth && fontSize > 1) {
        fontSize *= maxWidth / width;
        textEl.style.fontSize = `${fontSize}px`;
        width = textEl.getBoundingClientRect().width;
      }

      textEl.style.position = 'relative';
      textEl.style.top = '0px';
      // Center the ink vertically on the logo rather than pinning ink-top to logo-top -- at
      // heightScale > 1 the extra ink height is split evenly above and below the logo instead of
      // all hanging below it.
      const logoRect = logoEl.getBoundingClientRect();
      const logoCenter = logoRect.top + logoRect.height / 2;
      const currentInkRect = inkRect();
      const inkCenter = currentInkRect.top + currentInkRect.height / 2;
      const offset = logoCenter - inkCenter - logoRect.height * raiseRatio;
      textEl.style.top = `${offset}px`;
      textEl.style.left = `-${shiftLeftPx}px`;
    },
    { textSelector, logoSelector, heightScale, maxWidth, raiseRatio, shiftLeftPx }
  );
}

/**
 * Builds the two-row lockup used for the OG/Twitter image: a top row with the mark (quartered
 * from the original lockup's size) and "git-span" to its right, margined from the logo by the
 * same distance as the logo's own left padding; a second row below, left-aligned with the logo
 * and spanning the full canvas width minus the horizontal padding, holding the tagline. Both text
 * elements start at their row-height-derived cap; {@link fitTextToWidth} rescales each, after the
 * page renders, to fill their available width exactly -- so neither wraps nor clips regardless of
 * tagline length.
 *
 * @param {object} params
 * @param {string} params.logoSrc
 * @param {string} [params.tagline]
 * @param {string} params.backgroundColor
 * @param {string} params.inkColor
 * @param {number} params.width
 * @param {number} params.height
 * @returns {string} A complete HTML document.
 */
function renderLeftLockupTemplate({ logoSrc, tagline, backgroundColor, inkColor, width, height }) {
  // 1.5x the quartered lockup's logo size (which itself was a quarter of the original lockup's
  // logo, which filled the canvas height minus the top/bottom margin) -- the logo's top-left
  // position is unchanged, only its size scales. titleRowHeight/titleColumnWidth/the title's
  // left margin all derive from logoSize and EDGE_MARGIN below, so the "git-span" row height and
  // the logo-to-text gap track this change automatically, and the tagline row's left edge already
  // shares the same EDGE_MARGIN offset as the logo.
  const logoSize = Math.round(((height - EDGE_MARGIN * 2) / 4) * 1.5);
  const titleRowHeight = logoSize;
  const taglineRowHeight = height - EDGE_MARGIN * 2 - logoSize - ROW_GAP;
  const titleColumnWidth = width - EDGE_MARGIN * 2 - logoSize - EDGE_MARGIN;
  const taglineColumnWidth = width - EDGE_MARGIN * 2;

  const titleFontSize = Math.round(titleRowHeight * ROW_HEIGHT_FONT_CAP_RATIO);
  const taglineFontSize = Math.round(taglineRowHeight * ROW_HEIGHT_FONT_CAP_RATIO);

  const html = `<!doctype html>
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
  @font-face {
    font-family: 'IBM Plex Mono';
    src: url('file://${MONO_FONT_FILE_URL}') format('woff2');
    font-weight: 500;
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
    padding: ${EDGE_MARGIN}px;
    gap: ${ROW_GAP}px;
    font-family: 'IBM Plex Sans Variable', ui-sans-serif, system-ui, sans-serif;
  }
  .title-row {
    flex: none;
    height: ${titleRowHeight}px;
    display: flex;
    align-items: center;
  }
  .logo {
    flex: none;
    width: ${logoSize}px;
    height: ${logoSize}px;
  }
  .title-text {
    flex-shrink: 0;
    margin-left: ${EDGE_MARGIN}px;
    color: ${TITLE_COLOR};
    font-family: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;
    font-size: ${titleFontSize}px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
  }
  .tagline-row {
    flex: none;
    height: ${taglineRowHeight}px;
    width: ${Math.round(taglineColumnWidth * TAGLINE_SCALE)}px;
    margin-left: -${Math.round(width * TAGLINE_SHIFT_LEFT_RATIO)}px;
    display: flex;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
  }
  .tagline {
    color: ${inkColor};
    font-weight: 500;
    font-size: ${taglineFontSize}px;
  }
</style>
</head>
<body>
  <div class="title-row">
    <img class="logo" src="${logoSrc}" alt="" />
    <span id="title-text" class="title-text">${GIT_SPAN_TITLE}</span>
  </div>
  ${tagline ? `<div class="tagline-row"><span id="tagline-text" class="tagline">${escapeHtml(tagline)}</span></div>` : ''}
</body>
</html>`;

  return {
    html,
    fit: {
      titleColumnWidth,
      titleFontSize,
      tagline: Boolean(tagline),
      taglineColumnWidth: Math.round(taglineColumnWidth * TAGLINE_SCALE),
      taglineFontSize: Math.round(taglineFontSize * TAGLINE_SCALE),
      shiftLeftPx: Math.round(width * TITLE_SHIFT_LEFT_RATIO),
    },
  };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const OG_TAGLINE = 'Agents should read between the lines.';
const GROUND = '#f4f1e8';
const INK_PRIMARY = '#1b1e23';
// Muted purple-gray for the "git-span" title text -- a desaturated tint of the brand accent
// (`--color-accent: #5b21e6` in app/styles/global.css) rather than the tagline's near-black ink.
const TITLE_COLOR = '#5c5468';

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
    layout: 'left-lockup',
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

/**
 * Recursively collects every `.mdx` file under `dir`, returning paths relative to `dir`
 * with POSIX separators (e.g. `guides/mine-span-candidates.mdx`), regardless of host OS.
 *
 * @param {string} dir - Directory to walk.
 * @param {string} [baseDir] - The root `dir` passed on the initial call, used to compute
 *   relative paths on recursive calls.
 * @returns {string[]} Relative `.mdx` file paths.
 */
function findMdxFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMdxFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      files.push(path.relative(baseDir, fullPath).split(path.sep).join('/'));
    }
  }
  return files;
}

/**
 * Extracts the frontmatter `title` from an `.mdx` file's contents. The frontmatter here
 * is flat `key: value` strings only (verified across every `content/docs` mdx file),
 * so a small regex suffices -- a full YAML parser is unwarranted.
 *
 * @param {string} contents - The `.mdx` file's raw text.
 * @returns {string | undefined} The frontmatter title, if present.
 */
function extractFrontmatterTitle(contents) {
  const frontmatterMatch = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return undefined;
  const titleMatch = frontmatterMatch[1].match(/^title:\s*(.+?)\s*$/m);
  return titleMatch ? titleMatch[1] : undefined;
}

/**
 * Renders `params` to `page` at `htmlPath` and, for `left-lockup` layouts, aligns the "git-span"
 * title's glyph ink to the logo via {@link alignTextInkToElement} and fits the tagline to its
 * available row width via {@link fitTextToWidth}, before the caller screenshots it.
 *
 * @param {import('playwright').Page} page
 * @param {object} params - Same shape as {@link renderTemplate}'s params.
 * @param {string} htmlPath - Where to write the rendered HTML document.
 */
async function renderAndFit(page, params, htmlPath) {
  const { html, fit } = renderTemplate(params);
  writeFileSync(htmlPath, html);
  await page.goto(`file://${htmlPath}`);
  if (fit) {
    await alignTextInkToElement(
      page,
      '#title-text',
      '.logo',
      GIT_SPAN_TITLE_HEIGHT_SCALE,
      fit.titleColumnWidth,
      GIT_SPAN_TITLE_RAISE_RATIO,
      fit.shiftLeftPx
    );
    if (fit.tagline) {
      await fitTextToWidth(page, '#tagline-text', fit.taglineColumnWidth, fit.taglineFontSize);
    }
  }
}

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
        const htmlPath = path.join(workDir, `${set.name}.html`);
        await renderAndFit(page, set, htmlPath);
        await page.screenshot({ path: set.outputPath, omitBackground: false });
        console.log(`Wrote ${set.outputPath} (${set.width}x${set.height})`);
      } finally {
        await page.close();
      }
    }

    mkdirSync(DOCS_OG_DIR, { recursive: true });
    const docOgImages = {};
    for (const relativePath of findMdxFiles(DOCS_CONTENT_DIR)) {
      const absolutePath = path.join(DOCS_CONTENT_DIR, ...relativePath.split('/'));
      const contents = readFileSync(absolutePath, 'utf-8');
      const title = extractFrontmatterTitle(contents);
      if (!title) {
        console.warn(`Skipping ${relativePath}: no frontmatter title found`);
        continue;
      }

      const slug = relativePath.replace(/\.mdx$/, '');
      const outputPath = path.join(DOCS_OG_DIR, `${slug}.png`);
      mkdirSync(path.dirname(outputPath), { recursive: true });

      const page = await browser.newPage({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 1,
      });
      try {
        const htmlPath = path.join(workDir, `doc-${slug.replace(/\//g, '-')}.html`);
        await renderAndFit(
          page,
          {
            logoSrc: logoAccentUrl,
            tagline: title,
            backgroundColor: GROUND,
            inkColor: INK_PRIMARY,
            width: 1200,
            height: 630,
            layout: 'left-lockup',
          },
          htmlPath
        );
        await page.screenshot({ path: outputPath, omitBackground: false });
        console.log(`Wrote ${outputPath} (1200x630)`);
      } finally {
        await page.close();
      }

      docOgImages[slug] = `/og/docs/${slug}.png`;
    }

    writeFileSync(DOC_OG_IMAGES_MANIFEST, `${JSON.stringify(docOgImages, null, 2)}\n`);
    console.log(`Wrote ${DOC_OG_IMAGES_MANIFEST} (${Object.keys(docOgImages).length} docs)`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    await browser.close();
  }
}

await main();
