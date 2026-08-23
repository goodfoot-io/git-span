import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(SCRIPT_DIR, '..', 'public');
const sourcePath = path.join(PUBLIC_DIR, 'logo-positive.svg');
const svgPath = path.join(PUBLIC_DIR, 'favicon.svg');
const pngPath = path.join(PUBLIC_DIR, 'favicon.png');

const source = readFileSync(sourcePath, 'utf8');
const openingTag =
  '<svg width="512" height="464" viewBox="0 0 512 464" fill="none" xmlns="http://www.w3.org/2000/svg">';
if (!source.startsWith(`${openingTag}\n`) || !source.endsWith('</svg>\n')) {
  throw new Error('logo-positive.svg does not match the expected 512x464 source structure');
}

const squareSvg = source
  .replace(
    openingTag,
    '<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g transform="translate(0 24)">'
  )
  .replace('</svg>\n', '</g>\n</svg>\n');
writeFileSync(svgPath, squareSvg);
execFileSync('magick', ['-background', 'none', svgPath, '-resize', '48x48', pngPath], { stdio: 'inherit' });

console.log(`Wrote ${svgPath} with the logo centered in a square viewport`);
console.log(`Wrote ${pngPath} as a 48x48 transparent raster`);
