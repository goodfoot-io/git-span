---
name: turbo-vitest-cache
description: Add a two-layer test cache to a TypeScript monorepo (Yarn/pnpm/npm workspaces with Vitest) - Turborepo task caching (`test:uncached` pattern) on top of per-file `@goodfoot/vitest-cache` record/replay - and prove it is portable across worktrees. Use whenever the user asks to add turborepo or test caching to a monorepo, wire `@goodfoot/vitest-cache` into many packages, make `yarn test` cache hits survive across git worktrees or checkouts, debug "tests are never cached" / hash drift, or replicate this repo's turbo + vitest-cache setup in another repo or container, even if they do not name both tools.
---

# Turborepo + @goodfoot/vitest-cache for a TypeScript monorepo

Two caches that compose:

- **Turbo** skips a whole package when none of its declared inputs changed (package granularity, replays logs).
- **`@goodfoot/vitest-cache`** skips individual test files inside a package that does execute (file granularity, driven by a `vitest.cache.json` contract). Turbo misses still become cheap.

Neither replaces the other. Keep both. For contract syntax and troubleshooting, load the `vitest-cache:vitest-cache` skill if available.

## Procedure

1. **Survey** (read-only). List workspaces and their test scripts; find existing `vitest.config.ts` / `vitest.cache.json`; note the package manager, Node version, whether the repo uses git worktrees, and any package whose tests read other packages' sources or build outputs (these need extra `inputs`).
2. **Install**: `turbo` as a root devDependency with an exact version (`yarn add -D -W turbo@<x.y.z>`; use the package manager's own flag). `@goodfoot/vitest-cache` as a devDependency of every package with tests. Allow its build script if the package manager gates install scripts (Yarn: `enableScripts`/`dependenciesMeta`; pnpm: `onlyBuiltDependencies`).
3. **Vitest layer**: in each `vitest.config.ts`, wrap the exported config: `export default withTestOutput(defineConfig(...), loadCacheContract(new URL('./vitest.cache.json', import.meta.url)))` from `@goodfoot/vitest-cache/policy`. Create `vitest.cache.json` per package (see the vitest-cache skill). Any test setup/globalSetup that builds artifacts should use `setupNeeded` from `@goodfoot/vitest-cache/plan` so cached runs skip the build.
4. **Turbo layer**: copy `references/root-turbo.json` to the repo root and `references/package-turbo.json` to packages that need extra inputs. See `references/turbo-design.md` for why each field exists.
5. **Scripts**: in every package, `"test:uncached": "<the raw vitest command>"` and `"test": "<pm> run -T turbo run test:uncached --filter=<package-name> --cwd \"$PROJECT_CWD\" --"`. The trailing `--` forwards file arguments. Adapt `-T`/`$PROJECT_CWD` to the package manager (Yarn 4 sets `PROJECT_CWD`; elsewhere use the root path). At the root: `"test": "turbo run test:uncached --concurrency=1"` and `"test:skip-cache": "DISABLE_TEST_CACHE=true turbo run test:uncached --force --concurrency=1"`.
6. **Dependency cycles**: turbo refuses cyclic package graphs. A shared `test-utils` package that depends on packages that depend on it is the usual culprit - move the helpers into the package that owns what they wrap (expose as a `./testing` subpath export) so `test-utils` has no workspace deps.
7. **CI**: cache `.turbo/cache` (turbo's real dir, not `node_modules/.cache/turbo`) with a versioned key prefix, and keep the vitest-cache store cached too if it persists on disk.
8. **Smoke test** (never skip; it finds the real bugs):
   - Run the full suite twice: second run must be all cached ("FULL TURBO"). A first-run -> second-run hash change means an input is rewritten by the run itself.
   - Edit one dependency source: only dependents miss.
   - Create a git worktree, apply uncommitted changes, `install`, and run `scripts/compare-hashes.mjs <checkoutA> <checkoutB>`. Hashes must be identical; entries seeded in one checkout must hit from the other (turbo 2.x shares the main checkout's `.turbo/cache` with its worktrees automatically). Remove the worktree afterwards.
9. **Docs/CI contracts**: update any docs, spans/wiki pages and CI cache keys that described the old caching. Report anything not turbo-ized (lint, typecheck, build are separate decisions - offer, don't assume).

## Pitfalls that actually happened

- Explicit `inputs` globs read **gitignored files straight from disk**: `.DS_Store`, `.turbo/` logs, `dist/`, `build/`, `*.tsbuildinfo`, DB index files, generated hook bundles. Exclude volatile ones with `!` globs or hashes diverge between checkouts or change after the first run. Keep generated artifacts that tests *execute* as inputs (stale bundle must not give a false hit); an unbuilt checkout then correctly misses until built.
- Use `$TURBO_ROOT$` for cross-package inputs; `$TURBO_DEFAULT$` keeps the package's tracked files.
- `envMode: strict` hides env vars from tasks: list needed ones in `env` (hashed) or `passThroughEnv` (not hashed: PATH, HOME, TMPDIR, ...). Tests that spawn git/node need PATH/HOME.
- A task with `cache: false` silently defeats everything; check for leftovers.
- Tests that write untracked, non-ignored files inside their own package invalidate themselves.
- Don't call a flaky failure "unrelated". Rerun alone and in the full suite, record what you saw and what you could not prove.
- Test-file moves require updating `vitest.cache.json` entries (missing keys fail).

## Report

State: packages cached, run-1/run-2 results, cross-checkout hash result, caveats (unbuilt checkouts, package vs file granularity), what was not converted, and that nothing was committed unless asked.
