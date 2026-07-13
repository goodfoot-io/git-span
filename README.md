# git-span

`git-span` is a Rust CLI for recording durable relationships between exact
anchors in a Git repository. It stores span metadata as ordinary tracked files
so teams can review, fetch, push, and audit those relationships alongside the
code they describe.

The monorepo ships:

- **`git-span`** - the Rust CLI and npm wrapper
- **`goodfoot.git-span`** - a lightweight VS Code extension that manages the
  packaged `git-span` binary and exposes command entry points

The extension intentionally does not include a visualization webview yet. The
current goal is reliable binary resolution and command execution; richer span
visualization will be added later.

## CLI

During local development, run commands from `packages/git-span`:

```bash
cd packages/git-span
yarn build
```

Common command shape:

```bash
git span doctor
git span add checkout-request-flow src/client.ts#L10-L40 src/server.ts#L20-L64
git span why checkout-request-flow -m "Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server."
git add .span && git commit -m "Record checkout-request-flow span"
git span stale checkout-request-flow
```

See [docs/git-span-the-missing-handbook.md](./docs/git-span-the-missing-handbook.md)
for the project model and workflow.

### Exit codes

`git-span` follows the POSIX convention used by `git` and `cargo`:

- **0** — success.
- **1** — operational failure: the command was well-formed, but
  the environment or repository state prevents completion.
  Example: `git span fetch nope` when `nope` is not a configured
  remote, or `git span show nope` when `nope` is not a known span.
- **2** — usage error: the command itself is malformed (unknown
  flag, missing required argument). Example: `git span fetch --bogus`.

`git span stale` overlays its own §10.4 contract on top of this:
exit 1 when drift is found, exit 0 with `--no-exit-code`. The
`pre-commit` subcommand likewise exits 1 on in-flight drift.

## VS Code Extension

The VS Code extension workspace is named `git-span-extension` (to avoid
colliding with the CLI's `git-span` npm package name) but publishes to the
Marketplace as `goodfoot.git-span`. For now it is a lightweight command and
binary manager:

- resolves the packaged `git-span` executable for the current platform
- installs or retries the managed binary when needed
- exposes Git Span command entry points inside VS Code
- keeps terminal PATH integration focused on the managed binary

It does not register a custom editor, Markdown renderer, search UI, or webview.

## Monorepo Layout

```text
.
├── packages/
│   ├── git-span/       # git-span Rust CLI
│   └── extension/      # goodfoot.git-span VS Code extension
├── npm/
│   └── git-span-*/     # platform-specific binary distribution packages
├── docs/
│   ├── git-span-the-missing-handbook.md
│   └── cross-compilation.md
└── scripts/
    ├── sync-versions.sh
    ├── validate.sh
    └── release.sh
```

## Development Prerequisites

Before running tests or building the CLI locally, install the following tools:

**cargo-nextest** (test runner):

```bash
cargo install cargo-nextest --locked
```

For faster installation using prebuilt binaries, see the
[nextest install docs](https://nexte.st/book/pre-built-binaries.html).

**Linker (Linux only):**

```bash
sudo apt-get install mold        # Ubuntu/Debian — recommended
# sudo apt-get install lld       # alternative linker (override with CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER)
```

On macOS no extra install is required — the mold linker config is gated to
Linux GNU targets only. If you cross-compile to Linux from macOS, install `lld`
(via Homebrew or Xcode) and override the linker:

```bash
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="/opt/homebrew/opt/lld/bin/lld" cargo build
```

(The per-target `CARGO_TARGET_*_LINKER` env var overrides `[target.*].linker` in config files.)

**Per-user Cargo target directory:**

Build artifacts are stored in a shared per-user directory at
`$HOME/.cache/git-span/cargo-target/<crate>/<group>/` — `<group>` is `check`
(non-codegen `cargo check`/`clippy`) or `build` (codegen `cargo test`/`build`).
The two are kept separate on purpose: mixing rmeta-only (`check`) and rlib
(`build`) artifacts in one directory causes spurious `can't find crate` link
failures. See
[packages/git-span/scripts/cargo-build-system.md](packages/git-span/scripts/cargo-build-system.md)
for details. This directory is shared across all worktrees on the same machine —
a worktree cloned from `main` will reuse dependency artifacts already built by
another worktree.

Override the target root via `GIT_SPAN_CARGO_TARGET_ROOT`:

```bash
GIT_SPAN_CARGO_TARGET_ROOT=/tmp/my-target yarn test
```

Note: `yarn build:clean` cleans only the `git-span/build` subdirectory of the
shared target root. Running it while another worktree is building waits for that
build (it takes the exclusive target-root lock) rather than corrupting it.

## Contributing

```bash
git clone https://github.com/goodfoot-io/git-span.git
cd git-span
yarn install
yarn build
yarn validate
```

Use Yarn for all JavaScript package management. Per-package validation should
run from the package directory that contains the changed files:

```bash
cd packages/git-span
yarn lint
yarn typecheck
yarn test

cd ../extension
yarn lint
yarn typecheck
yarn test
```

Run `yarn validate` from the workspace root before finalizing code or
configuration changes.

### Manpage

The CLI ships a `git-span(1)` manpage generated from the clap definitions. To
browse it without installing:

```bash
MANPATH=packages/git-span/man man git-span
```

Regenerate after changing CLI flags or descriptions:

```bash
cd packages/git-span
yarn build:man
```

The regression test in `tests/manpage.rs` fails if the checked-in artifact
drifts from what the generator produces.

## Releases

Releases are tag-driven from `goodfoot-io/git-span`. CLI and extension release
assets use `git-span` names, including `git-span-v*` tags and
`git-span-cli-checksums.json`.

## License

MIT - Copyright (c) 2026 Goodfoot Media LLC. See [LICENSE](./LICENSE).
