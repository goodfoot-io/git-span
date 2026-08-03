/**
 * Normalizes VS Code's injected `--vscode-*` color variables into the hex
 * forms Monaco's standalone theme parser accepts.
 *
 * VS Code serializes webview theme variables with `Color.toString()`, which
 * emits `#RRGGBB` for opaque colors but `rgba(r, g, b, a)` for anything
 * transparent. Monaco parses `defineTheme` colors with `Color.fromHex()`,
 * which is `parseHex(value) || Color.red` -- so every transparent color handed
 * to it straight from a CSS variable silently becomes opaque red inside the
 * embedded editors. That hit all four diff-editor colors (registered as
 * required-transparent) plus the commonly-transparent selection and
 * line-highlight colors.
 *
 * Monaco's `parseHex` accepts exactly four lengths -- `#RGB`, `#RGBA`,
 * `#RRGGBB`, `#RRGGBBAA` -- and does *not* validate the digits: its
 * `_parseHexDigit` maps any unrecognized character to `0`, so a malformed
 * `#gggggg` parses as black instead of being rejected. Validation therefore
 * has to happen here; passing a bad value through would trade one wrong color
 * for another rather than falling back to the inherited base theme.
 *
 * @summary Converts injected CSS color variables to Monaco-parseable hex.
 * @module spanViewer/webview/themeColor
 */

/**
 * The four hex shapes Monaco's `parseHex` accepts, with digits validated
 * because Monaco itself does not validate them.
 */
const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `rgb()`/`rgba()` with integer channels and an optional unitless alpha.
 *
 * Percentage channels and percentage alpha are deliberately unmatched: VS Code
 * only ever emits this integer form, and an unmatched value degrades to the
 * inherited base-theme color rather than to red.
 */
const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/**
 * Formats a 0-255 channel as exactly two lowercase hex digits.
 *
 * @param channel - The channel value; assumed already clamped to 0-255.
 * @returns A two-character hex string.
 * @throws Never.
 */
function toTwoDigitHex(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}

/**
 * Clamps a parsed colour channel into the 0-255 range CSS defines.
 *
 * @param channel - The raw parsed channel value.
 * @returns The channel clamped to 0-255.
 * @throws Never.
 */
function clampChannel(channel: number): number {
  return Math.max(0, Math.min(255, channel));
}

/**
 * Convert one injected CSS color value into a hex string Monaco can parse.
 *
 * Alpha is rounded with `Math.round(alpha * 255)`, matching VS Code's own
 * `Color.Format.CSS.formatHexA`, so a value round-trips to the same bytes VS
 * Code would have written (`0.2` becomes `33`). Fully opaque colors are
 * emitted compactly as `#RRGGBB`, again matching `formatHexA`'s compact mode.
 *
 * @param value - A raw `--vscode-*` variable value, e.g. `rgba(155, 185, 85, 0.2)`.
 * @returns A `#RRGGBB` or `#RRGGBBAA` string, an already-valid hex value
 *   unchanged, or `null` when the value is empty or not a form Monaco can
 *   parse -- callers must skip `null` rather than forward it.
 * @throws Never.
 */
export function normalizeThemeColor(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (HEX_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const match = RGB_PATTERN.exec(trimmed);
  if (match === null) {
    return null;
  }

  const [, rawRed, rawGreen, rawBlue, rawAlpha] = match;
  if (rawRed === undefined || rawGreen === undefined || rawBlue === undefined) {
    return null;
  }

  const red = clampChannel(Number.parseInt(rawRed, 10));
  const green = clampChannel(Number.parseInt(rawGreen, 10));
  const blue = clampChannel(Number.parseInt(rawBlue, 10));
  const rgb = `#${toTwoDigitHex(red)}${toTwoDigitHex(green)}${toTwoDigitHex(blue)}`;

  if (rawAlpha === undefined) {
    return rgb;
  }

  const alpha = Number.parseFloat(rawAlpha);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    return null;
  }
  if (alpha === 1) {
    return rgb;
  }

  return `${rgb}${toTwoDigitHex(Math.round(alpha * 255))}`;
}
