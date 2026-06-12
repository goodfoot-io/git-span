#!/bin/bash
# Wrapper for cc (gcc) that always selects mold as the linker via
# -fuse-ld=mold. Used as the linker in .cargo/config.toml to achieve
# RUSTFLAGS immunity: the [target.*].linker config key is a separate
# key from rustflags, so environment-level RUSTFLAGS cannot override
# the linker selection.
#
# When rustc calls cc directly as the linker driver (rather than going
# through -C link-arg=-fuse-ld=mold in rustflags), cc correctly handles:
# - GCC-style -Wl, argument prefixes
# - Library search paths for GCC runtime libraries (libgcc_s, etc.)
# - Target-specific flags and specs
exec /usr/bin/cc -fuse-ld=mold "$@"
