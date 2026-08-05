/**
 * The reviewed corpus's formatter invocation shapes (plan §5.8, Phase 3 step
 * 8): one entry per invocation shape — every §5.8 table row's write form(s)
 * and read-only form(s), plus the pinned fail-closed shapes. Consumed by the
 * table-coverage fixture (formatter-table-coverage.test.ts), which asserts
 * that every entry either resolves through the table to a `modify` touch on
 * exactly its explicit file operands (with the expected tool) or is pinned
 * unresolved with its documented reason, that the table's tool set and this
 * list's tool set are equal in both directions, and that each row's read-only
 * forms suppress the touch. An entry that is neither resolvable nor pinned
 * fails the fixture, so table growth and fail-closed pinning are enforced by
 * construction.
 *
 * Commands use relative paths resolved against the fixture's temp cwd.
 */

export type FormatterCorpusEntry =
  | {
      /** The invocation shape, verbatim. */
      command: string;
      /** The §5.8 table tool the shape belongs to. */
      tool: string;
      /** The write form resolves to a whole-file `modify` touch on exactly these operands. */
      expected: 'modify';
      files: string[];
    }
  | {
      command: string;
      tool: string;
      /** A read-only form (or a bare shape with no write form): no touch. */
      expected: 'no-touch';
    }
  | {
      command: string;
      /**
       * The §5.8 table tool the shape belongs to, when its executable is a
       * table tool; null when no table tool is reached (a wrapper obscures
       * the wrapped argv, or the executable is unknown).
       */
      tool: string | null;
      /** A fail-closed shape: no touch, with the documented reason. */
      expected: 'unresolved';
      reason: string;
    };

export const FORMATTER_CORPUS: readonly FormatterCorpusEntry[] = [
  // prettier
  { command: 'prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'prettier --write f.ts f.py', tool: 'prettier', expected: 'modify', files: ['f.ts', 'f.py'] },
  { command: 'prettier -w f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'prettier --check f.ts', tool: 'prettier', expected: 'no-touch' },
  { command: 'prettier --list-different f.ts', tool: 'prettier', expected: 'no-touch' },
  { command: 'prettier --debug-check f.ts', tool: 'prettier', expected: 'no-touch' },
  // eslint
  { command: 'eslint --fix f.ts', tool: 'eslint', expected: 'modify', files: ['f.ts'] },
  { command: 'eslint --fix-dry-run f.ts', tool: 'eslint', expected: 'no-touch' },
  { command: 'eslint f.ts', tool: 'eslint', expected: 'no-touch' },
  // biome
  { command: 'biome check --write f.ts', tool: 'biome', expected: 'modify', files: ['f.ts'] },
  { command: 'biome check --fix f.ts', tool: 'biome', expected: 'modify', files: ['f.ts'] },
  { command: 'biome format --write f.ts', tool: 'biome', expected: 'modify', files: ['f.ts'] },
  { command: 'biome check f.ts', tool: 'biome', expected: 'no-touch' },
  { command: 'biome format f.ts', tool: 'biome', expected: 'no-touch' },
  // gofmt
  { command: 'gofmt -w f.go', tool: 'gofmt', expected: 'modify', files: ['f.go'] },
  { command: 'gofmt -l f.go', tool: 'gofmt', expected: 'no-touch' },
  { command: 'gofmt f.go', tool: 'gofmt', expected: 'no-touch' },
  // goimports
  { command: 'goimports -w f.go', tool: 'goimports', expected: 'modify', files: ['f.go'] },
  { command: 'goimports f.go', tool: 'goimports', expected: 'no-touch' },
  // clang-format
  { command: 'clang-format -i f.cpp', tool: 'clang-format', expected: 'modify', files: ['f.cpp'] },
  { command: 'clang-format --dry-run f.cpp', tool: 'clang-format', expected: 'no-touch' },
  { command: 'clang-format f.cpp', tool: 'clang-format', expected: 'no-touch' },
  // shfmt
  { command: 'shfmt -w f.sh', tool: 'shfmt', expected: 'modify', files: ['f.sh'] },
  { command: 'shfmt -d f.sh', tool: 'shfmt', expected: 'no-touch' },
  { command: 'shfmt f.sh', tool: 'shfmt', expected: 'no-touch' },
  // yapf
  { command: 'yapf -i f.py', tool: 'yapf', expected: 'modify', files: ['f.py'] },
  { command: 'yapf --diff f.py', tool: 'yapf', expected: 'no-touch' },
  { command: 'yapf f.py', tool: 'yapf', expected: 'no-touch' },
  // autopep8
  { command: 'autopep8 -i f.py', tool: 'autopep8', expected: 'modify', files: ['f.py'] },
  { command: 'autopep8 -d f.py', tool: 'autopep8', expected: 'no-touch' },
  { command: 'autopep8 --diff f.py', tool: 'autopep8', expected: 'no-touch' },
  { command: 'autopep8 f.py', tool: 'autopep8', expected: 'no-touch' },
  // black
  { command: 'black f.py', tool: 'black', expected: 'modify', files: ['f.py'] },
  { command: 'black --check f.py', tool: 'black', expected: 'no-touch' },
  { command: 'black --diff f.py', tool: 'black', expected: 'no-touch' },
  // isort
  { command: 'isort f.py', tool: 'isort', expected: 'modify', files: ['f.py'] },
  { command: 'isort --check-only f.py', tool: 'isort', expected: 'no-touch' },
  { command: 'isort --diff f.py', tool: 'isort', expected: 'no-touch' },
  // ruff
  { command: 'ruff format f.py', tool: 'ruff', expected: 'modify', files: ['f.py'] },
  { command: 'ruff check --fix f.py', tool: 'ruff', expected: 'modify', files: ['f.py'] },
  { command: 'ruff check f.py', tool: 'ruff', expected: 'no-touch' },
  { command: 'ruff check --no-fix f.py', tool: 'ruff', expected: 'no-touch' },
  { command: 'ruff format --check f.py', tool: 'ruff', expected: 'no-touch' },
  // deno fmt
  { command: 'deno fmt f.ts', tool: 'deno', expected: 'modify', files: ['f.ts'] },
  { command: 'deno fmt --check f.ts', tool: 'deno', expected: 'no-touch' },
  // dprint fmt
  { command: 'dprint fmt f.ts', tool: 'dprint', expected: 'modify', files: ['f.ts'] },
  { command: 'dprint check f.ts', tool: 'dprint', expected: 'no-touch' },
  // rustfmt
  { command: 'rustfmt f.rs', tool: 'rustfmt', expected: 'modify', files: ['f.rs'] },
  { command: 'rustfmt --check f.rs', tool: 'rustfmt', expected: 'no-touch' },
  { command: 'rustfmt --emit stdout f.rs', tool: 'rustfmt', expected: 'no-touch' },
  // terraform fmt
  { command: 'terraform fmt f.tf', tool: 'terraform', expected: 'modify', files: ['f.tf'] },
  { command: 'terraform fmt -check f.tf', tool: 'terraform', expected: 'no-touch' },
  { command: 'terraform fmt -diff f.tf', tool: 'terraform', expected: 'no-touch' },
  // Transparent package-runner wrappers (plan §5.8 pinned grammar)
  { command: 'npx prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'npx --no-install eslint --fix f.ts', tool: 'eslint', expected: 'modify', files: ['f.ts'] },
  { command: 'npx -y prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'yarn prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'pnpm exec prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'pnpm dlx prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'bunx prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'npm exec prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  { command: 'npm exec -- prettier --write f.ts', tool: 'prettier', expected: 'modify', files: ['f.ts'] },
  // Fail-closed shapes, pinned unresolved
  {
    command: 'npx "prettier --write f.ts"',
    tool: null,
    expected: 'unresolved',
    reason: 'string-form wrapper argument (quoted words in one token)'
  },
  {
    command: 'npx --package=foo prettier --write f.ts',
    tool: null,
    expected: 'unresolved',
    reason: 'argv-altering runner flag (--package=value)'
  },
  {
    command: 'npx --package foo prettier --write f.ts',
    tool: null,
    expected: 'unresolved',
    reason: 'runner flag consuming the next word'
  },
  {
    command: 'npx --prefer-offline prettier --write f.ts',
    tool: null,
    expected: 'unresolved',
    reason: 'runner flag outside the pinned no-arg grammar'
  },
  {
    command: 'npx ./fix-all.sh f.ts',
    tool: null,
    expected: 'unresolved',
    reason: 'wrapper word is itself a script (. prefixed)'
  },
  {
    command: 'somefixer --write f.ts',
    tool: null,
    expected: 'unresolved',
    reason: 'unknown executable (not in the formatter table)'
  },
  {
    command: 'npx somefixer --write f.ts',
    tool: null,
    expected: 'unresolved',
    reason: 'unknown executable (not in the formatter table)'
  },
  {
    command: 'prettier --write src/',
    tool: 'prettier',
    expected: 'unresolved',
    reason: 'directory operand — no static attribution'
  },
  {
    command: 'prettier --write f.ts src/',
    tool: 'prettier',
    expected: 'unresolved',
    reason: 'directory operand poisons the whole command (all-or-nothing)'
  },
  {
    command: "prettier --write '*.ts'",
    tool: 'prettier',
    expected: 'unresolved',
    reason: 'glob operand — no static attribution'
  },
  { command: 'prettier --write', tool: 'prettier', expected: 'unresolved', reason: 'no operand — nothing to attribute' }
];
