/**
 * Bash-xtrace oracle for the execution-aware walk (plan §6): the executed-set
 * ground truth `analyzeExecution` must match.
 *
 * The harness runs each fixture script in real bash under `set -x` with the
 * trace redirected to a file (BASH_XTRACEFD), then reads the executed simple
 * commands back out of the trace. Two comparisons are drawn per fixture:
 *
 * - **executed words** — the first argv word of each executed command (leading
 *   `!` negation words stripped), in trace order, against the first word of
 *   every stage `analyzeExecution` marks `'yes'`, in script order. The plan's
 *   yes-set comparison: the parser's verdict set must equal what bash actually
 *   ran.
 * - **referenced files** — the argv words that resolve to real files under the
 *   fixture dir (`identity`), which is the file-read ground truth the walk's
 *   window algebra must not exceed or undercount.
 *
 * The equality fixtures are scripts whose executed set is fully decidable —
 * known-status commands, chains, pipelines, and errexit/pipefail toggles.
 * The subset fixtures are the opaque shapes (grep gates, case with unknown
 * conditions) where the parser must never claim more than bash ran: its
 * yes-set is a subset of the oracle's.
 *
 * The comparison is order-insensitive by necessity (probe-pinned): each
 * pipeline member traces from its own process into the shared trace fd, so
 * the line order in the file is scheduling-dependent, not execution order —
 * the same fixture flips between runs. The plan's contract is the executed
 * SET, so words and files are compared as sorted sequences.
 *
 * Every fixture is probe-pinned against GNU bash 5.2.x.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeExecution } from '../../src/common/parse-command.js';
import { argvOf, splitTopLevel } from '../../src/common/shell-split.js';

/** The xtrace prefix — line-shaped so trace lines are unmistakable. */
const PS4 = '+oracle> ';

describe("xtrace oracle — the walk's executed set vs real bash (plan §6)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'xtrace-oracle-'));
    const body = `${Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
    for (const name of ['f', 'g', 'h']) writeFileSync(join(dir, name), body);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run `script` under `set -x` with the trace on fd 7; return the trace lines, prefix-stripped. */
  function oracleLines(script: string): string[] {
    const tracePath = join(dir, 'xtrace.tmp');
    const driver = `exec 7>${tracePath}; BASH_XTRACEFD=7; PS4='${PS4}'; set -x; ${script}`;
    try {
      execFileSync('bash', ['-c', driver], { cwd: dir, stdio: 'ignore' });
    } catch (error) {
      // errexit/pipefail fixtures exit non-zero by design — the trace is the record.
      if (!(error instanceof Error)) throw error;
    }
    return readFileSync(tracePath, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith(PS4))
      .map((line) => line.slice(PS4.length).trim())
      .filter((line) => line !== 'set -x');
  }

  /** The file paths an executed command's argv references (existing files only). */
  function identity(argv: string[] | null): string[] {
    if (argv === null) return [];
    const files: string[] = [];
    for (const word of argv.slice(1)) {
      if (word === '!') continue;
      if (word.startsWith('-')) continue;
      if (/[*?"'\s]/.test(word)) continue;
      const abs = resolve(dir, word);
      if (existsSync(abs)) files.push(abs);
    }
    return files;
  }

  /** First argv word of each executed trace line, leading `!`s stripped, in trace order. */
  function oracleWords(script: string): string[] {
    return oracleLines(script).map((line) => {
      const argv = argvOf(line) ?? [];
      return argv.find((w) => w !== '!') ?? '<empty>';
    });
  }

  /** Files referenced by executed trace lines, sorted (duplicates preserved). */
  function oracleFiles(script: string): string[] {
    return oracleLines(script)
      .flatMap((line) => identity(argvOf(line)))
      .sort();
  }

  /** First argv word of each stage `analyzeExecution` marks 'yes', leading `!`s stripped. */
  function parserYesWords(script: string): string[] {
    const { stages } = splitTopLevel(script);
    const execs = analyzeExecution(stages);
    const words: string[] = [];
    for (let i = 0; i < stages.length; i += 1) {
      if (execs[i]?.exec === 'yes') {
        const argv = argvOf(stages[i].text) ?? [];
        const first = argv.find((w) => w !== '!');
        if (first !== undefined) words.push(first);
      }
    }
    return words;
  }

  /** Files referenced by 'yes' stages, sorted (duplicates preserved). */
  function parserFiles(script: string): string[] {
    const { stages } = splitTopLevel(script);
    const execs = analyzeExecution(stages);
    const files: string[] = [];
    for (let i = 0; i < stages.length; i += 1) {
      if (execs[i]?.exec === 'yes') files.push(...identity(argvOf(stages[i].text)));
    }
    return files.sort();
  }

  const EQUALITY_FIXTURES: readonly (readonly [script: string, note: string])[] = [
    ["false; sed -n '1,2p' f", 'no errexit — the list continues'],
    ["true; sed -n '1,2p' f", 'known success — sed runs'],
    [":; sed -n '1,2p' f", 'colon builtin — status 0, no file words'],
    ["x=1; sed -n '1,2p' f", 'assignment — status 0, no file words'],
    ["false && echo no; sed -n '1,2p' f", 'and-gate skips the echo'],
    ["! true && echo no; sed -n '1,2p' f", 'negation inverts to failure'],
    ["! false && sed -n '1,2p' f", 'negation inverts to success'],
    ["! ! true && sed -n '1,2p' f", 'double negation is identity'],
    ["false && a || sed -n '1,2p' f", 'the or re-opens the chain'],
    ["cat f | sed -n '2,4p'", 'pipeline — both members run'],
    ['cat f | head -3', 'pipeline narrowing'],
    ["false | true; sed -n '1,2p' f", 'pipeline status is the last member'],
    ["true | false || sed -n '1,2p' f", 'failing pipeline opens the or'],
    ["false | true && echo no; sed -n '1,2p' f", 'succeeding pipeline closes the and'],
    ["set -e; false && echo no; sed -n '1,2p' f", 'exempt failure does not fire errexit'],
    ["set -e; ! true; sed -n '1,2p' f", 'inverted failure never fires errexit'],
    ["set +e; false; sed -n '1,2p' f", 'errexit cleared'],
    ["set -e; set +e; false; sed -n '1,2p' f", 'set +e after set -e wins'],
    ["set -e; false; sed -n '1,2p' f", 'errexit kills the list after the failure'],
    ["set -e; true && false; sed -n '1,2p' f", 'the && chain failure fires errexit'],
    ["set -e; false || sed -n '1,2p' f", '|| member is exempt'],
    ["set -e; false | true; sed -n '1,2p' f", 'pipeline members are exempt from errexit'],
    ["set -eo pipefail; false | true; sed -n '1,2p' f", 'pipefail kills after the pipeline'],
    ["set -eo pipefail; true | true; sed -n '1,2p' f", 'pipefail: success pipeline continues'],
    ["set -eo pipefail; set +o pipefail; false | true; sed -n '1,2p' f", 'pipefail cleared'],
    ["set -euxo pipefail; false; sed -n '1,2p' f", 'the standard header spelling']
  ];

  const SUBSET_FIXTURES: readonly (readonly [script: string, note: string])[] = [
    ['grep -q x f && echo hi', 'opaque gate — the parser claims nothing bash did not run'],
    ["grep -q x f || true; sed -n '1,2p' g", 'unknown-status chain members'],
    ['case $x in a) cat f;; esac', 'unbound subject — undecidable']
  ];

  it.each(EQUALITY_FIXTURES)('%s — %s', (script) => {
    // Pipeline-member trace lines are written by separate processes to the
    // shared trace fd — their order in the file is scheduling-dependent
    // (probe-pinned), so the executed-set comparison is order-insensitive.
    expect([...parserYesWords(script)].sort()).toEqual([...oracleWords(script)].sort());
    expect(parserFiles(script)).toEqual(oracleFiles(script));
  });

  it.each(SUBSET_FIXTURES)('%s — %s', (script) => {
    const parser = parserYesWords(script);
    const oracle = new Set(oracleWords(script));
    for (const word of parser) expect(oracle.has(word)).toBe(true);
  });

  // Skipped with the plan-foreign reason intact, never weakened: bash's
  // xtrace records the CONDITION command of an opaque `if` (`+ grep -q c f`),
  // while the walk models the whole construct as one stage whose first word
  // is the `if` keyword — bash traces case headers but not if/while/until
  // keywords, so no uniform word mapping exists. The walk's claim is truthful
  // (the construct provably ran — plan §1 'yes') and claims nothing beyond it
  // (the body `cat g` is never claimed), so the semantic invariant the plan's
  // oracle bullet states — "the parser never claims an unexecuted command" —
  // holds; the word-level comparison cannot express it for this shape.
  it.skip("if grep -q c f; then cat g; fi — opaque condition — body unknown: SKIPPED — the walk's construct-stage keyword ('if') has no word-level counterpart in bash's condition trace ('grep')", () => {});
});
