#!/bin/bash
# Wrapper for cc (gcc) that always selects mold as the linker. Used as the
# linker in .cargo/config.toml to achieve RUSTFLAGS immunity: the
# [target.*].linker config key is a separate key from rustflags, so
# environment-level RUSTFLAGS cannot override the linker selection.
#
# Mold is selected via `-B/usr/libexec/mold`, NOT `-fuse-ld=mold`. The Debian/
# Ubuntu mold package ships a `ld` symlink at /usr/libexec/mold/ld pointing at
# the mold binary; `-B<dir>` prepends <dir> to cc's search path for the `ld`
# executable, so cc invokes mold as its linker. This mechanism works with ANY
# gcc version. `-fuse-ld=mold` only works with gcc >= 12.1.0 — older gcc (e.g.
# on the GitHub Actions runner) rejects it with "unrecognized command line
# option '-fuse-ld=mold'; did you mean '-fuse-ld=gold'?", which is what broke
# CI even though mold was installed.
#
# When rustc calls cc directly as the linker driver, cc correctly handles:
# - GCC-style -Wl, argument prefixes
# - Library search paths for GCC runtime libraries (libgcc_s, etc.)
# - Target-specific flags and specs
exec /usr/bin/cc -B/usr/libexec/mold "$@"
