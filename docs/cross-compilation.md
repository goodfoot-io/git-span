# Cross-Compilation Guide

`git-span` publishes a small npm meta-package plus platform-specific optional
packages that contain native Rust binaries. The release workflow builds those
binaries and copies each one into the matching package under `npm/`.

## Release Targets

| Platform | Architecture | Rust Target Triple | NPM Package |
| --- | --- | --- | --- |
| Linux | x64 | `x86_64-unknown-linux-musl` | `git-span-linux-x64` |
| Linux | arm64 | `aarch64-unknown-linux-musl` | `git-span-linux-arm64` |
| macOS | x64 | `x86_64-apple-darwin` | `git-span-darwin-x64` |
| macOS | arm64 | `aarch64-apple-darwin` | `git-span-darwin-arm64` |
| Windows | x64 | `x86_64-pc-windows-msvc` | `git-span-win32-x64` |

Linux release binaries use musl targets so they do not depend on the target
system's glibc version. The npm package names intentionally stay generic
(`linux-x64`, `linux-arm64`) because npm selects them by OS and CPU, while the
binary inside each package is built for musl.

## Install Flow

`git-span` declares the platform packages as optional dependencies.
During install, `packages/git-span/scripts/postinstall.js` maps
`process.platform` and `process.arch` to the matching package, then links or
copies that package's native binary to `packages/git-span/bin/git-span`.

The installed CLI entrypoint is the native Rust executable. Node is used only
for the package `postinstall` step.

The postinstall script fails closed:

- unsupported platforms or architectures exit non-zero;
- missing platform packages exit non-zero;
- missing platform binaries exit non-zero;
- filesystem failures while replacing or copying the binary exit non-zero.

## Release Workflow

`.github/workflows/release-git-span.yml` is the source of truth for published
artifacts. It uses `houseabsolute/actions-rust-cross` to build every target:

```yaml
strategy:
  matrix:
    include:
      - os: ubuntu-latest
        target: x86_64-unknown-linux-musl
        npm-pkg: git-span-linux-x64
        binary: git-span
      - os: ubuntu-latest
        target: aarch64-unknown-linux-musl
        npm-pkg: git-span-linux-arm64
        binary: git-span
      - os: macos-latest
        target: x86_64-apple-darwin
        npm-pkg: git-span-darwin-x64
        binary: git-span
      - os: macos-latest
        target: aarch64-apple-darwin
        npm-pkg: git-span-darwin-arm64
        binary: git-span
      - os: windows-latest
        target: x86_64-pc-windows-msvc
        npm-pkg: git-span-win32-x64
        binary: git-span.exe
```

The release workflow copies from:

```text
packages/git-span/target-cache/<target>/release/<binary>
```

to the npm package:

```text
npm/<npm-pkg>/bin/
```

(The developer shared default is `$HOME/.cache/git-span/cargo-target/git-span/build/`
for scripted builds. The `target-cache/` path above is specific to the release workflow
which runs bare `cargo` and uses the `.cargo/config.toml` fallback.)

The publish job uploads the platform packages first, then publishes the
`git-span` meta-package.

## Local Builds

`yarn build` in `packages/git-span` builds the host default Rust target:

```sh
yarn build
```

On Linux, that local build may be a dynamically linked GNU/glibc binary. Use an
explicit musl target when checking the release-style Linux artifact locally:

```sh
rustup target add x86_64-unknown-linux-musl
cargo build --release --target x86_64-unknown-linux-musl
```

For Linux arm64:

```sh
rustup target add aarch64-unknown-linux-musl
cargo build --release --target aarch64-unknown-linux-musl
```

Cross-linking requirements vary by host. The GitHub release workflow uses
`houseabsolute/actions-rust-cross` so the release build has the required target
toolchains available.

## Dependency Notes

`git-span` uses `gix` for Git object and repository operations instead of
linking to `libgit2`. The current dependency set does not include OpenSSL,
`native-tls`, `libgit2`, or other system library crates that would add extra
runtime shared-library requirements to the released Linux musl binaries.
