---
title: Cleaning up worktrees and build caches
summary: How to reclaim disk by removing worktrees that are fully merged into local main along with their branches, and by deleting cargo build output that has accumulated outside the canonical shared target root — plus the cache-shaped locations that must not be deleted.
aliases: [disk cleanup, worktree cleanup, build cache cleanup, reclaim disk, prune worktrees, sweep cargo target, stale caches, cargo home]
tags: [cleanup, build]
---

# Cleaning up worktrees and build caches

Two independent jobs: retire worktrees that are fully merged into local `main`, and delete cargo build output sitting outside the canonical shared root. Both are destructive; the git commands below fail closed, so treat a refusal as information and never escalate to `--force`/`-D`.

## Establish what is live before deleting anything

Never infer staleness from a path's name. Confirm each fact below first — several are traps that make live trees look dead.

| Fact | Check |
|---|---|
| `~/.cards/worktrees` is a **symlink** into the volume root — one tree, not two | `ls -ld ~/.cards/worktrees` |
| `/workspace` is on the **same filesystem as `/home/node`** (virtiofs), not the container overlay | `df -h /workspace` |
| Card worktrees symlink `packages/git-span/target-cache` **back to the primary checkout** | `ls -l <worktree>/packages/git-span/target-cache` |
| The canonical cargo root is writable and populated | `du -sh $GIT_SPAN_CARGO_TARGET_ROOT/*` |
| No other worktree is mid-build | `ls $GIT_SPAN_CARGO_TARGET_ROOT/.target.lock` |

`df /` misreports the space a cleanup will free: `/workspace` lives on virtiofs, so read `df -h /workspace` for the number that matters.

## Retire merged worktrees

A worktree qualifies only when it is **clean** and **fully merged**:

- clean — `git -C <path> status --porcelain` prints nothing
- merged — its branch appears in `git branch --merged main`, or, for a detached `HEAD`, its commit satisfies `git merge-base --is-ancestor <head> main`

For each qualifying path:

```bash
git worktree remove <path>      # no --force
git branch -d <branch>          # no -D; detached worktrees have no branch to delete
git worktree prune
```

`git worktree remove` refuses a dirty worktree and `git branch -d` refuses an unmerged branch, so a refusal means the worktree did not meet the predicate — investigate it, do not escalate to `--force`.

**Two failure modes to expect:**

1. **The worktree is gone but stays registered.** `git worktree list` shows `prunable`, and removal failed with `failed to delete '.git/worktrees/<id>': Directory not empty`. Git deletes only files it knows about inside the admin dir, and git-span leaves its own state there (`.git/worktrees/<id>/span/`, `validate-output.log`). Clear the leftover admin dir, then prune:

   ```bash
   rm -rf .git/worktrees/<id>
   git worktree prune
   ```

   The worktree directory is already deleted at this point, so only the registration is outstanding.

2. **A rebase- or squash-merged branch reports as unmerged.** `git branch --merged main` is a pure *ancestry* test. A branch whose commits landed on `main` under different SHAs (rebase, squash, or a rewritten history) is reported as not-merged even though its content is in. Those are skipped, which is the safe direction — confirm by hand with `git cherry main <branch>` (lines prefixed `-` are already in `main`) before deciding.

## Delete stale build caches

Cargo output belongs in exactly one place: the shared root at `$GIT_SPAN_CARGO_TARGET_ROOT` (default `/var/cache/git-span/cargo-target`), organized `<crate>/<group>` — `check` for rmeta (`cargo check`/`clippy`), `build` for rlib (`cargo test`/`build`/`run`), plus `udeps`. Keep the two groups apart; mixing them causes `can't find crate` link failures. See [cargo-build-system.md](../../packages/git-span/scripts/cargo-build-system.md) for the full layout and lock protocol.

For routine pruning **inside** the canonical root, use the in-tree sweeper rather than deleting directories: it removes only aged compilation-unit artifacts and prunes directories that empty out. It is a dry run unless you pass `--apply`:

```bash
node scripts/sweep-cargo-target.mjs                      # report
node scripts/sweep-cargo-target.mjs --apply              # delete
node scripts/sweep-cargo-target.mjs --max-age-days 7 --apply
```

The sweeper ignores root-level dotfiles: `.tripwire.*` captures left by killed lock wrappers accumulate (retention prunes only `.fingerprint-tripwire/`) — delete them when no build is running.

To find target dirs outside the root, sweep for cargo's marker rather than guessing paths — every target dir root carries `.rustc_info.json`:

```bash
find /workspace /home/node /var/lib/coaxial -maxdepth 12 -name .rustc_info.json 2>/dev/null | grep -v /node_modules/
```

`CACHEDIR.TAG` marks caches too, but uv, fontconfig, huggingface, and pytest write it as well — a hit is a hint, not proof. Before deleting one: nothing references it, no process holds it open (`lsof +D <path>`), newest artifact is months old.

Outside that root, delete a location only after confirming nothing reads it. Locations that were confirmed dead and removed:

| Location | Why it is dead |
|---|---|
| `packages/git-span/target-cache/` | Raw-`cargo` fallback; stale contents cleared, directory itself kept (see caveats) |
| `~/.cache/git-mesh/` | Pre-rebrand name; the rebrand deliberately started a fresh tree at `~/.cache/git-span` |
| `~/.cache/git-span/cargo-target/` | Pre-volume cargo root, replaced by the mounted `/var/cache/git-span/cargo-target` |
| `~/.cache/git-span-card-targets/` | Abandoned per-card target experiment, referenced nowhere |
| `~/.cards/worktrees.pre-volume/` | Pre-relocation worktree root, registered in no git worktree list |
| `<root>/{main-301,node,spike-alloc-probe}` | Strays in the canonical root that do not match the `<crate>/<group>` layout |

**Caveats — each of these has bitten a real cleanup:**

- **Keep `packages/git-span/target-cache/` as an empty directory.** Worktrees symlink *into* it, so removing the directory leaves dangling links. Empty the contents instead: `find /workspace/packages/git-span/target-cache -mindepth 1 -maxdepth 1 -exec rm -rf {} +`
- **Never delete `~/.cache/git-span/session`.** That is the live hook journal, written on every session. Only the sibling `cargo-target` directory is build output. Check the newest entry with `find ~/.cache/git-span/session -maxdepth 1 -printf '%TY-%Tm-%Td %p\n' | sort -r | head`.
- **Never delete `~/.cargo.pre-volume/`.** It is the pre-volume *cargo home*, not build output: `~/.cargo` now resolves to the `cargo-data` volume, whose `bin/` holds only rustup shims. The only copies of `cargo-nextest`, `cargo-udeps`, and `cargo-zigbuild` live in its `bin/` — `cargo nextest --version` already fails, and `yarn test` in `packages/git-span` needs it. Migrate those binaries into the mounted cargo home first; only its `registry/` (~700M) is redundant.
- **Worktree-owned caches: an old name is not evidence of death.** `packages/git-mesh/` in a pre-rebrand worktree is a full checkout, and its `target`/`target-cache` are that crate's real build cache — ad-hoc `cargo` only, since its scripts pin `CARGO_TARGET_DIR` to `~/.cache/git-mesh/cargo-target` and recreate that deleted root cold. Some are instead symlinks into `/workspace/packages/git-mesh/…`, which no longer exists, and dangle. Never delete a cache belonging to a worktree you are keeping — removal only slows resuming it.
- **Do not delete the volume root.** `~/.cards/worktrees` resolves into it; it holds every live worktree.
- `bench:context` defaults `GIT_SPAN_CONTEXT_BINARY` to `target-cache/release/git-span`. After emptying `target-cache`, point it at the canonical build instead: `GIT_SPAN_CONTEXT_BINARY=$GIT_SPAN_CARGO_TARGET_ROOT/git-span/build/release/git-span`.

## Verify

```bash
git worktree list                                  # only intended worktrees, no "prunable"
git status --porcelain                             # primary checkout clean
ls -ld /workspace/packages/git-span/target-cache   # still exists, empty
find ~/.cache/git-span/session -type d | head       # live journal intact
cd packages/git-span && yarn build                  # cargo still resolves the shared root
```

Then compare `df -h /workspace` against the same reading taken before the cleanup.

## Related

- [Cargo build system](../../packages/git-span/scripts/cargo-build-system.md) — the target-root layout, group split, and lock protocol in full
- [Profiling git span drift](./profiling-git-span-drift.md) — the `cache-path` counters that report which cache path a `git span` run took
