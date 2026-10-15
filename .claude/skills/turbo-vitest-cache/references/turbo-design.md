# Why the turbo config looks like this

- `transit` task: a no-op task whose only job is `dependsOn ^transit`, so `test:uncached` hashes include the *internal dependencies' contents* without running their builds. Builds stay outside turbo.
- `outputs: []`: tests produce nothing to restore; turbo caches pass/fail and logs.
- `globalDependencies`: lockfile-adjacent config that changes behavior of every package (package manager config, root tsconfig).
- `env` is hashed; `passThroughEnv` is available but not hashed. Put only behavior-changing vars in `env`.
- `remoteCache` off: fail closed - nothing leaves the machine.
- Per-package `turbo.json` with `extends: ["//"]` adds `inputs` for files outside the package that its tests read (other packages' schema/source, `public/**` plugin trees). Start from `$TURBO_DEFAULT$`.
- Excluding volatile gitignored paths (see SKILL.md pitfalls) is what makes hashes equal across checkouts. Verify with `scripts/compare-hashes.mjs`; diff the `inputs` map in `turbo run --dry=json` output to find the offending files, then `git check-ignore` them and confirm no tracked file would be excluded (`git ls-files -- '<glob>'` must be empty).
- Running tasks: `--concurrency=1` when tests are heavy on shared ports/tmp dirs/git; raise it only after proving isolation.
