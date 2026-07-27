/**
 * Command-line interface: argv parsing, candidate rendering, and the runCli
 * entry point used by the bin shim.
 *
 * Output format is one coupling per line, best first:
 * `path[:Lstart-Lend], path[:Lstart-Lend], ...`
 *
 * @summary CLI argument parsing and candidate rendering.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfig } from './config.js';
import { discover } from './pipeline.js';
import type { Candidate, Loc } from './types.js';

const USAGE = [
  'Usage: discover [options]',
  '',
  'Detect implicit couplings in a git repository.',
  '',
  'Options:',
  '  --repo <path>          repository root (default: cwd)',
  '  --exclude <prefix>     excluded path prefix (repeatable)',
  '  --max-candidates <n>   cap on emitted groups (default 300)',
  '  --min-score <x>        confidence floor in [0, 1] (default 0.5)',
  '  --no-messages          disable the commit-message signal',
  '  --json <file>          also write a JSON report',
  '  --help                 show this help'
].join('\n');

/**
 * Render one location in the output notation.
 *
 * @param loc - Location to render.
 * @returns `path` for whole files, `path:Lstart-Lend` for ranges.
 */
export function formatLoc(loc: Loc): string {
  if (loc.start === undefined) {
    return loc.path;
  }
  return `${loc.path}:L${loc.start}-L${loc.end ?? loc.start}`;
}

/**
 * Render one candidate as a single output line.
 *
 * @param candidate - Merged candidate to render.
 * @returns Comma-separated rendered locations.
 */
export function formatCandidateLine(candidate: Candidate): string {
  return candidate.locs.map(formatLoc).join(', ');
}

/**
 * Parse a numeric CLI value, failing closed on anything non-finite.
 *
 * @param raw - Raw flag value.
 * @param flag - Flag name for the error message.
 * @returns The parsed number.
 * @throws Error when the value is not a finite number.
 */
function parseNumber(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${flag} expects a number, got '${raw}'`);
  }
  return value;
}

/**
 * Run the CLI against an argv slice.
 *
 * Exit codes: 0 success, 1 pipeline/config failure, 2 argv parse failure.
 *
 * @param argv - Arguments after the program name.
 * @param out - Sink for stdout lines.
 * @param err - Sink for stderr lines.
 * @returns Process exit code.
 */
export function runCli(argv: readonly string[], out: (line: string) => void, err: (line: string) => void): number {
  let values: {
    repo?: string;
    exclude?: string[];
    'max-candidates'?: string;
    'min-score'?: string;
    'no-messages'?: boolean;
    json?: string;
    help?: boolean;
  };
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        repo: { type: 'string' },
        exclude: { type: 'string', multiple: true },
        'max-candidates': { type: 'string' },
        'min-score': { type: 'string' },
        'no-messages': { type: 'boolean' },
        json: { type: 'string' },
        help: { type: 'boolean' }
      },
      allowPositionals: false
    }).values;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    err(USAGE);
    return 2;
  }

  if (values.help === true) {
    out(USAGE);
    return 0;
  }

  try {
    const maxCandidates = values['max-candidates'];
    const minScore = values['min-score'];
    const config = resolveConfig({
      exclude: values.exclude ?? [],
      useCommitMessages: values['no-messages'] !== true,
      ...(maxCandidates !== undefined ? { maxCandidates: parseNumber(maxCandidates, '--max-candidates') } : {}),
      ...(minScore !== undefined ? { minScore: parseNumber(minScore, '--min-score') } : {})
    });
    const { candidates } = discover(resolve(values.repo ?? '.'), config);
    for (const candidate of candidates) {
      out(formatCandidateLine(candidate));
    }
    if (values.json !== undefined) {
      writeFileSync(values.json, `${JSON.stringify({ candidates }, null, 2)}\n`, 'utf8');
    }
    return 0;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
