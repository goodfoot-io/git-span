/**
 * The §5.8 table-coverage fixture (plan Phase 3 step 8): pins the formatter
 * family grammar to its checked-in invocation-shape corpus. Every corpus entry
 * either resolves through the table to a whole-file `modify` touch on exactly
 * its explicit file operands or is pinned unresolved (fail-closed); the table
 * tool set and the corpus tool set are equal in both directions; and each
 * table row's read-only forms suppress the write — alone, and when a write
 * form is present at the same time.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORMATTER_TABLE, parseCommand, parseCommandDetailed } from '../../src/common/parse-command.js';
import { FORMATTER_CORPUS } from './fixtures/formatter-corpus.js';

/** One real fixture file per table tool, for the table-driven checks. */
const FILE_FOR_TOOL: Record<string, string> = {
  prettier: 'f.ts',
  eslint: 'f.ts',
  biome: 'f.ts',
  gofmt: 'f.go',
  goimports: 'f.go',
  'clang-format': 'f.cpp',
  shfmt: 'f.sh',
  yapf: 'f.py',
  autopep8: 'f.py',
  black: 'f.py',
  isort: 'f.py',
  ruff: 'f.py',
  deno: 'f.ts',
  dprint: 'f.ts',
  rustfmt: 'f.rs',
  terraform: 'f.tf'
};

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'formatter-corpus-test-'));
  writeFileSync(join(dir, 'f.ts'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'f.py'), 'print(1)\n');
  writeFileSync(join(dir, 'f.go'), 'package main\n');
  writeFileSync(join(dir, 'f.rs'), 'fn main() {}\n');
  writeFileSync(join(dir, 'f.sh'), 'echo hi\n');
  writeFileSync(join(dir, 'f.tf'), 'resource "x" "y" {}\n');
  writeFileSync(join(dir, 'f.cpp'), 'int main() {}\n');
  mkdirSync(join(dir, 'src')); // the directory-operand fail-closed shape stats it
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('formatter table corpus coverage (§5.8)', () => {
  for (const entry of FORMATTER_CORPUS) {
    if (entry.expected === 'modify') {
      it(`resolves ${entry.command} to a modify touch on its explicit operands`, () => {
        expect(parseCommand(entry.command, dir)).toEqual(
          entry.files.map((file) => ({ operation: 'modify', absolutePath: join(dir, file), simpleCommandIndex: 0 }))
        );
        const detailed = parseCommandDetailed(entry.command, dir);
        expect(detailed).toHaveLength(entry.files.length);
        for (const match of detailed) {
          expect(match.status).toBe('resolved');
          if (match.status === 'resolved') expect(match.idiom).toBe('formatter-write');
        }
      });
    } else if (entry.expected === 'no-touch') {
      it(`touches nothing: ${entry.command}`, () => {
        expect(parseCommand(entry.command, dir)).toEqual([]);
      });
    } else {
      it(`fails closed: ${entry.command}`, () => {
        // The fail-closed contract: no touch, and anything the detailed parse
        // does report is an unresolved formatter-write, never a span.
        expect(parseCommand(entry.command, dir)).toEqual([]);
        for (const match of parseCommandDetailed(entry.command, dir)) {
          expect(match.status).toBe('unresolved');
          if (match.status === 'unresolved') expect(match.idiom).toBe('formatter-write');
        }
      });
    }
  }

  it('the corpus tool set and the table tool set are equal in both directions', () => {
    const corpusTools = new Set(FORMATTER_CORPUS.filter((e) => e.tool !== null).map((e) => e.tool as string));
    const tableTools = new Set(FORMATTER_TABLE.map((row) => row.command));
    expect(corpusTools).toEqual(tableTools);
  });

  for (const row of FORMATTER_TABLE) {
    for (const form of row.readOnlyForms) {
      const command = [row.command, ...form, FILE_FOR_TOOL[row.command]].join(' ');
      it(`read-only form suppresses the write: ${command}`, () => {
        expect(parseCommand(command, dir)).toEqual([]);
      });
    }
  }

  for (const row of FORMATTER_TABLE) {
    for (const write of row.writeForms) {
      for (const readOnly of row.readOnlyForms) {
        // A form whose first token is a subcommand is positional (it must lead
        // the args); two forms with different positional subcommands cannot be
        // present together, so no combined shape exists for those pairs.
        const subcommandOf = (form: string[]): string | null =>
          form[0] !== undefined && !form[0].startsWith('-') ? form[0] : null;
        const writeSub = subcommandOf(write);
        const readOnlySub = subcommandOf(readOnly);
        if (writeSub !== null && readOnlySub !== null && writeSub !== readOnlySub) continue;
        const command = [row.command, ...write, ...readOnly, FILE_FOR_TOOL[row.command]].join(' ');
        it(`read-only wins over write when both are present: ${command}`, () => {
          expect(parseCommand(command, dir)).toEqual([]);
        });
      }
    }
  }
});
