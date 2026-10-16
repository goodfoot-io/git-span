#!/usr/bin/env bash
# Regenerates man/*.1 (roff, via clap_mangen) and doc/*.html from the CLI definition.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf man doc
bash scripts/cargo.sh build run --quiet --locked --bin gen-manpage -- "$PWD/man" "$PWD/doc"
