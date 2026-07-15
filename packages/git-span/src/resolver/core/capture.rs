//! Live capture and pre-publish revalidation of a [`StateToken`] (card
//! main-157 Phase 3, sub-scope 3B).
//!
//! Phase 1 froze the *shape* of [`StateToken`] (`super::token`); this module
//! is the first code that builds a real one from an actual `git span stale`
//! invocation's live git/filesystem/option state, and the companion
//! [`revalidate`] that re-reads every mutable component after computation and
//! reports whether the snapshot still holds. Together they implement the
//! `notes/correctness-contract.md` "Snapshot Rules":
//!
//! 1. state observation yields exact immutable identities or a typed
//!    ineligibility reason (never a wall-clock or other non-deterministic
//!    fallback — every "I couldn't read this" is [`PathState::Unreadable`]);
//! 3. before publish, HEAD / span state / relevant config / index / relevant
//!    worktree identities / availability proofs are re-read;
//! 4. if any token field changed, the caller discards the candidate.
//!
//! This module deliberately does **no** storage, no env switch, and no wiring
//! into [`stale_spans_retaining_source_layers`](crate::resolver::engine)
//! — that is sibling task 3C, which calls [`capture_state_token`] before
//! resolution and [`revalidate`] before publication. Every git read reuses the
//! existing plumbing layer ([`crate::git`], [`crate::span_file_reader`],
//! [`crate::resolver::walker::rename_budget`]) rather than reinventing it.
//!
//! ## Filter dependency identity (real, proven)
//!
//! Every configured `filter.<driver>` in git config becomes a
//! [`FilterDependency`] whose `executable_digest`/`env_digest` are proven when
//! resolvable: the driver's `clean`/`smudge`/`process` command lines are parsed
//! for their concrete program, resolved through the same `PATH`/relative-to-
//! worktree rules a spawned filter child obeys (see
//! [`crate::resolver::layers::filter_process`]), and the resolved executable's
//! bytes are BLAKE3-digested.
//!
//! The environment digest is computed by driver *class*, because a driver's
//! *total* environment dependency can be proven complete only for the known,
//! dedicated LFS driver — never for an arbitrary `sh -c` driver:
//!
//! - **The known LFS driver** (`filter.lfs`, `crate::types::is_core_filter`)
//!   runs through the dedicated `git-lfs filter-process` spawn
//!   (`spawn_lfs_process`): a fixed-argument, content-addressed transform whose
//!   output for a given blob is the stored LFS object, not a function of ambient
//!   variables. Its env digest covers only the variables its command lines
//!   *declare* via shell substitution (`$VAR`/`${VAR}`); git-lfs references
//!   none, so this is the fixed empty-set digest, identical across every working
//!   directory, terminal, and sibling worktree. That is what restores warm-hit
//!   and cross-worktree reuse on every git-lfs-configured machine — folding the
//!   whole `vars_os()` environment in defeated it, since `git lfs install`
//!   writes a global `filter.lfs.*` driver whose identity then absorbed every
//!   `PWD`/session change.
//! - **Arbitrary custom drivers** run through `sh -c <cmd>`
//!   (`spawn_custom_filter_process`) with NO `env_clear`, so the child inherits
//!   the FULL process environment and can read any variable internally via
//!   `getenv` — `envsubst` substituting `$VAR` into file CONTENT, a
//!   `decrypt --key-env SECRET_KEY` binary reading `$SECRET_KEY`. A command-line
//!   `$VAR` scan is a sound lower bound on *referenced* names but not a proof of
//!   *total* dependency, so keying only referenced names would be fail-OPEN: a
//!   changed variable the scan cannot see would serve a stale exact hit. These
//!   drivers therefore key the WHOLE process environment (fail-closed): any env
//!   change fragments the key rather than risk a false hit (CLAUDE.md
//!   `<fail-closed>`). The over-broad whole-`vars_os()` digest this restores for
//!   custom drivers was never *wrong*; the Phase 6 narrowing traded its
//!   correctness for a false-hit risk, which holds only for the LFS driver whose
//!   spawn path is dedicated and known.
//!
//! When any
//! command's program cannot be resolved to a concrete executable file — command
//! not found, not executable, unparseable, or a bare repository with no worktree
//! — `executable_digest` stays `None` and
//! [`FilterDependency::has_complete_identity`] reports `false`, so
//! [`StateToken::persistence_eligible`] fails closed for that input rather than
//! trusting command text alone (`notes/investigation-question-log.md` Step 6).
//!
//! ## Deliberate scope boundaries (documented gaps for later phases)
//!
//! - **Per-path availability proofs are empty.** [`AvailabilityProof::paths`]
//!   is left empty: the resolver computes only the three global
//!   sparse/promisor/LFS booleans today (the "Availability Aliasing" gap the
//!   token anticipates but no existing subsystem fills). `lfs_installed` here
//!   means "HEAD's root `.gitattributes` declares `filter=lfs`" — a real,
//!   deterministic, non-forking signal — rather than probing `git lfs
//!   version` (which forks and does not belong in a snapshot capture).
//! - **Worktree content identity is a digest of raw bytes**, matching the
//!   existing `cache_v2::file_content_identity` behavior, not filter-normalized
//!   bytes. Any content mutation still changes the digest (which is all
//!   revalidation needs); normalized-content identity is a key-precision
//!   refinement for a later phase.

use super::token::{
    AvailabilityProof, FilterDependency, PathState, PathStateEntry, SpanBlobIdentity, StateToken,
};
use crate::span_file_reader::SpanFileReader;
use crate::Result;
use crate::types::{CopyDetection, EngineOptions, Span};
use blake3::Hasher;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

/// Namespace/version discriminator for the whole token shape. Bump on any
/// `StateToken` field addition/removal (mirrors `cache_v2`'s `KEY_SALT`).
pub(crate) const SEMANTIC_EPOCH: u32 = 1;

/// Hex of the empty git tree object id (`4b825dc...`). Used as `span_subtree`
/// when the span root is absent at `HEAD`, so "no span files committed" is a
/// distinct, deterministic identity rather than a read failure.
const EMPTY_TREE_HEX: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Build a complete [`StateToken`] from the live invocation state.
///
/// Reads HEAD, the source/span trees, the committed span set (for ordered
/// span/blob identities and the effective copy-detection mode), the index and
/// worktree identities for every relevant path, output-affecting config
/// (rename budget, copy detection, replace refs, filters, normalization,
/// attributes), and the availability proofs — all through the resolver's
/// existing git access layer. Every "couldn't read" case is a typed
/// [`PathState::Unreadable`], never a wall-clock or other non-deterministic
/// proxy.
///
/// `options` is the caller's [`EngineOptions`]; `span_root` is the already
/// precedence-resolved span root (as `stale_spans_cached` receives it).
pub(crate) fn capture_state_token(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<StateToken> {
    let committed = load_committed(repo, span_root)?;

    // Uncommitted (worktree-only) span files participate in the resolved output —
    // `list_span_names` is a 3-layer (worktree ∪ index ∪ HEAD) view and
    // `capture_resolution_core` resolves that effective set — yet they are absent
    // from `span_blobs`, which keys the HEAD corpus only. Capturing them as
    // first-class keyed inputs (their file path and anchored source paths join the
    // `relevant` set below, so their worktree/index identities enter the canonical
    // key; their config folds into the effective copy-detection) is what lets one
    // untracked/gitignored span be *observed* rather than *unobservable*. That
    // closes the card main-157 F6 scope regression: an uncommitted span no longer
    // has to disable the whole store — the committed corpus keeps its exact/
    // dirty-tier reuse and only the uncommitted span's own state forces fresh work
    // (it is absent at HEAD, so its span file always reads dirty and the dirty
    // tier always re-resolves just that span).
    let uncommitted = load_uncommitted(repo, span_root, &committed)?;

    // Relevant path set: every committed span file, every uncommitted span file,
    // plus every anchored source path across BOTH corpora. These are the paths
    // whose index and worktree identities can affect this invocation's output.
    let mut relevant: BTreeSet<String> = BTreeSet::new();
    let mut anchored: BTreeSet<String> = BTreeSet::new();
    for b in &committed.blobs {
        relevant.insert(b.path.clone());
    }
    for s in &committed.spans {
        for (_, a) in &s.anchors {
            anchored.insert(a.path.clone());
            relevant.insert(a.path.clone());
        }
    }
    for path in &uncommitted.file_paths {
        relevant.insert(path.clone());
    }
    for path in &uncommitted.anchored {
        anchored.insert(path.clone());
        relevant.insert(path.clone());
    }

    // Effective copy-detection mode: the most-permissive across the FULL effective
    // span set (committed + uncommitted), exactly as `ResolveSession` derives
    // `max_copy` from the resolved effective spans. An uncommitted span declaring
    // a more-permissive mode widens EVERY span's reverse walk, so it must move the
    // token's copy-detection (and thus `config_fingerprint`); otherwise a reuse
    // tier could serve committed cores resolved under a narrower mode.
    let copy_detection = committed
        .spans
        .iter()
        .map(|s| s.config.copy_detection)
        .max()
        .unwrap_or(CopyDetection::Off)
        .max(uncommitted.copy_detection);

    // Load the index once; both the whole-index identity and the per-path
    // staged states derive from this one snapshot. An unreadable index makes
    // both fail closed (`Unreadable`).
    let index = crate::git::index_entries(repo);
    let index_entries: Option<&[crate::git::IndexEntrySnapshot]> =
        index.as_ref().ok().map(Vec::as_slice);

    Ok(StateToken {
        semantic_epoch: SEMANTIC_EPOCH,
        layers: options.layers.into(),
        ignore_unavailable: options.ignore_unavailable,
        needs_all_layers: options.needs_all_layers,
        fuzzy_threshold_bps: fuzzy_threshold_bps(options.fuzzy_threshold),
        since: options.since.map(|o| o.to_string()),
        head: crate::git::head_oid(repo)?,
        source_tree: source_tree_oid(repo)?,
        span_root: span_root.to_string(),
        span_subtree: span_subtree_oid(repo, span_root)?,
        span_blobs: committed.blobs,
        rename_budget: rename_budget_u32(),
        copy_detection,
        replace_refs: replace_refs(repo),
        filters: filters(repo),
        attributes_digest: attributes_digest(repo, &anchored),
        normalization_digest: normalization_digest(repo),
        index_identity: index_identity(index_entries),
        staged_state: staged_states(index_entries, &relevant),
        worktree_state: worktree_states(repo, &relevant)?,
        availability: availability(repo),
    })
}

/// Result of a pre-publish revalidation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Revalidation {
    /// Every mutable (and immutable) component matches the originally captured
    /// token; the candidate may be published.
    Unchanged,
    /// A component changed between capture and re-read. `field` names the
    /// first differing [`StateToken`] field; the caller must discard the
    /// candidate (one bounded retry may re-capture, per Snapshot Rule 4).
    Changed { field: &'static str },
}

/// Re-read the live state and compare it against `original`.
///
/// Called after computation, before publication. A fresh [`StateToken`] is
/// captured from the same inputs and diffed field-by-field; the first differing
/// field is reported. HEAD is compared even though it is excluded from
/// [`StateToken::canonical_key_digest`] — a HEAD move invalidates the
/// incremental-parent derivation hint even when the exact key is unchanged, so
/// revalidation must still surface it (`notes/correctness-contract.md`
/// "Explicit Decisions").
pub(crate) fn revalidate(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    original: &StateToken,
) -> Result<Revalidation> {
    let fresh = capture_state_token(repo, span_root, options)?;
    Ok(diff_tokens(original, &fresh))
}

/// Field-by-field diff, in a fixed priority order. HEAD is checked first so a
/// pure HEAD move is reported as `head` rather than shadowed by a coincident
/// content field.
fn diff_tokens(a: &StateToken, b: &StateToken) -> Revalidation {
    macro_rules! check {
        ($field:ident) => {
            if a.$field != b.$field {
                return Revalidation::Changed {
                    field: stringify!($field),
                };
            }
        };
    }
    check!(head);
    check!(source_tree);
    check!(span_root);
    check!(span_subtree);
    check!(span_blobs);
    check!(index_identity);
    check!(staged_state);
    check!(worktree_state);
    check!(availability);
    check!(filters);
    check!(attributes_digest);
    check!(normalization_digest);
    check!(rename_budget);
    check!(copy_detection);
    check!(replace_refs);
    check!(layers);
    check!(ignore_unavailable);
    check!(needs_all_layers);
    check!(fuzzy_threshold_bps);
    check!(since);
    check!(semantic_epoch);
    Revalidation::Unchanged
}

// ---------------------------------------------------------------------------
// Committed span enumeration
// ---------------------------------------------------------------------------

/// The committed-at-HEAD span corpus: ordered `(span-file-path, blob)`
/// identities plus the parsed [`Span`]s (for config + anchored paths).
struct CommittedSpans {
    /// Sorted by span-file path (`committed_span_names` yields sorted names).
    blobs: Vec<SpanBlobIdentity>,
    spans: Vec<Span>,
}

fn load_committed(repo: &gix::Repository, span_root: &str) -> Result<CommittedSpans> {
    let reader = SpanFileReader::new(repo, span_root.to_string());
    // One HEAD `.span`-subtree decode yields every committed span's mode and
    // object id. Previously this loop called `tree_entry_at` once per span for
    // the blob identity AND `read_head` (a second `tree_entry_at`) once per
    // span for the parse — each re-peeling HEAD and re-decoding the whole span
    // subtree, i.e. O(N²) over N spans. Now each span is an O(log N) map lookup
    // plus a direct blob read via `read_head_blob` with the resolved id.
    let entries = reader.committed_span_entries()?;
    let mut blobs = Vec::with_capacity(entries.len());
    let mut spans = Vec::with_capacity(entries.len());
    for (name, (mode, oid)) in &entries {
        if mode.is_blob() {
            blobs.push(SpanBlobIdentity {
                path: format!("{span_root}/{name}"),
                blob: oid.to_string(),
            });
        }
        let file = reader.read_head_blob(*oid)?;
        spans.push(crate::types::span_from_file(name, &file));
    }
    Ok(CommittedSpans { blobs, spans })
}

/// The uncommitted (worktree-only) span corpus: span files present on the
/// worktree filesystem under the span root but absent at `HEAD`
/// (untracked/gitignored authoring state), with the anchored source paths and
/// effective copy-detection they contribute.
///
/// These spans are part of the resolved output — `list_span_names` /
/// `capture_resolution_core` read the 3-layer effective view — but invisible to
/// `span_blobs` (HEAD-only). [`capture_state_token`] folds them into the token's
/// relevant paths and copy-detection so they become keyed inputs (card main-157
/// F6), rather than an all-or-nothing store bypass.
struct UncommittedSpans {
    /// Repo-relative `<span_root>/<name>` path of every uncommitted span file.
    file_paths: Vec<String>,
    /// Anchored source paths across the uncommitted corpus.
    anchored: BTreeSet<String>,
    /// Most-permissive copy-detection across the uncommitted corpus
    /// ([`CopyDetection::Off`] when there are none).
    copy_detection: CopyDetection,
}

/// Enumerate the worktree span files absent at `HEAD` and read each effectively
/// (worktree over index over HEAD) to discover its anchored paths and config.
///
/// The committed set is taken from `committed` (the same HEAD-tree walk
/// `committed_span_names` performs), so a worktree name present at HEAD is
/// skipped here — its identity is already carried by `span_blobs` and, when
/// dirtied, by the committed relevant path's worktree state. A conflicted or
/// unreadable uncommitted span contributes no anchors (the authoritative
/// resolver still surfaces the conflict, and the span file's raw-byte identity
/// is still keyed via the worktree-state entry the relevant set produces): never
/// a hard error.
fn load_uncommitted(
    repo: &gix::Repository,
    span_root: &str,
    committed: &CommittedSpans,
) -> Result<UncommittedSpans> {
    let reader = SpanFileReader::new(repo, span_root.to_string());
    let committed_names: BTreeSet<&str> =
        committed.spans.iter().map(|s| s.name.as_str()).collect();
    let mut file_paths = Vec::new();
    let mut anchored: BTreeSet<String> = BTreeSet::new();
    let mut copy_detection = CopyDetection::Off;
    for name in reader.worktree_span_names()? {
        if committed_names.contains(name.as_str()) {
            continue;
        }
        file_paths.push(format!("{span_root}/{name}"));
        if let Ok(Some(file)) = reader.read_effective(&name) {
            let span = crate::types::span_from_file(&name, &file);
            for (_, a) in &span.anchors {
                anchored.insert(a.path.clone());
            }
            copy_detection = copy_detection.max(span.config.copy_detection);
        }
    }
    Ok(UncommittedSpans {
        file_paths,
        anchored,
        copy_detection,
    })
}

// ---------------------------------------------------------------------------
// Tree / HEAD identities
// ---------------------------------------------------------------------------

/// Tree object id of the `HEAD` commit — the source tree content identity.
fn source_tree_oid(repo: &gix::Repository) -> Result<String> {
    let head = repo
        .head_commit()
        .map_err(|e| crate::Error::Git(format!("capture head commit: {e}")))?;
    let tree = head
        .tree_id()
        .map_err(|e| crate::Error::Git(format!("capture head tree: {e}")))?;
    Ok(tree.detach().to_string())
}

/// Tree object id of the span root at `HEAD`, or the empty-tree sentinel when
/// the span root is absent at `HEAD`.
fn span_subtree_oid(repo: &gix::Repository, span_root: &str) -> Result<String> {
    match crate::git::tree_entry_at(repo, "HEAD", Path::new(span_root))? {
        Some((mode, oid)) if mode.is_tree() => Ok(oid.to_string()),
        _ => Ok(EMPTY_TREE_HEX.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/// `fuzzy_threshold` (0.0..=1.0 float) → basis points (0..=10000 integer), so
/// no float participates in key derivation or equality.
fn fuzzy_threshold_bps(t: f64) -> u32 {
    (t.clamp(0.0, 1.0) * 10_000.0).round() as u32
}

fn rename_budget_u32() -> u32 {
    u32::try_from(crate::resolver::walker::rename_budget()).unwrap_or(u32::MAX)
}

// ---------------------------------------------------------------------------
// Config-derived identities: replace refs, filters, attributes, normalization
// ---------------------------------------------------------------------------

/// Sorted `"<original-oid>:<replacement-oid>"` pairs from every `refs/replace/`
/// ref. Empty when none are configured. Reuses the same `repo.references()`
/// entry point the copy-pool walk uses.
fn replace_refs(repo: &gix::Repository) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let Ok(platform) = repo.references() else {
        return out;
    };
    let Ok(all) = platform.all() else {
        return out;
    };
    for r in all.flatten() {
        let mut r = r;
        let name = r.name().as_bstr().to_string();
        let Some(original) = name.strip_prefix("refs/replace/") else {
            continue;
        };
        let original = original.to_string();
        let Ok(id) = r.peel_to_id() else {
            continue;
        };
        out.push(format!("{original}:{}", id.detach()));
    }
    out.sort();
    out
}

/// The `filter.<driver>.*` value names that name an executable command line
/// (as opposed to `required`, a boolean). Fixed order so the executable digest
/// is deterministic.
const FILTER_COMMAND_KEYS: [&str; 3] = ["clean", "process", "smudge"];

/// Every configured `filter.<driver>` as a [`FilterDependency`] with real,
/// proven executable and environment identity when resolvable (see module docs).
/// Mirrors the config inputs of `cache_v2::schema::filter_config_hash`, promoted
/// to structured entries whose persistence eligibility is gated on proof.
fn filters(repo: &gix::Repository) -> Vec<FilterDependency> {
    let snap = repo.config_snapshot();
    let file = snap.plumbing();
    // driver -> (value-name -> value)
    let mut by_driver: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    if let Some(sections) = file.sections_by_name("filter") {
        for section in sections {
            let sub = section
                .header()
                .subsection_name()
                .map(|b| b.to_string())
                .unwrap_or_default();
            let body = section.body();
            let mut names: BTreeSet<String> = BTreeSet::new();
            for name in body.value_names() {
                names.insert(name.as_ref().to_string());
            }
            let entry = by_driver.entry(sub).or_default();
            for name in names {
                for v in body.values(&name) {
                    entry.insert(name.clone(), v.to_string());
                }
            }
        }
    }

    // A child filter spawned by the resolver resolves relative program paths
    // against the worktree — the same for every driver — so reuse the
    // executable-content cache across drivers (the common case — git-lfs
    // `clean`/`smudge`/`process` — is one 11 MiB binary shared by three
    // commands, digested once). The environment digest is per-driver AND
    // per-class: the known LFS driver binds only its referenced variables (none,
    // so an unrelated ambient variable never fragments it), while an arbitrary
    // custom `sh -c` driver binds the whole environment fail-closed (see
    // `filter_env_digest`), since its internal `getenv` reads cannot be proven.
    let workdir = crate::git::work_dir(repo).ok().map(Path::to_path_buf);
    let mut content_cache: HashMap<PathBuf, Option<[u8; 32]>> = HashMap::new();

    by_driver
        .into_iter()
        .map(|(driver, kv)| {
            let command = kv
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("\n");
            let executable_digest = workdir
                .as_deref()
                .and_then(|wd| filter_executable_digest(&kv, wd, &mut content_cache));
            let env_digest = Some(filter_env_digest(&driver, &kv));
            FilterDependency {
                driver,
                command,
                executable_digest,
                env_digest,
            }
        })
        .collect()
}

/// BLAKE3 digest binding every executable-invoking command of one filter driver
/// to its resolved executable's content. `None` (fail-closed ineligibility) when
/// the driver declares no executable command, or any declared command cannot be
/// parsed and resolved to a concrete, readable executable file.
fn filter_executable_digest(
    kv: &BTreeMap<String, String>,
    workdir: &Path,
    content_cache: &mut HashMap<PathBuf, Option<[u8; 32]>>,
) -> Option<[u8; 32]> {
    let mut h = Hasher::new();
    h.update(b"gm.core.filter-exe\0");
    let mut any_command = false;
    for cmd_key in FILTER_COMMAND_KEYS {
        let Some(cmdline) = kv.get(cmd_key) else {
            continue;
        };
        if cmdline.trim().is_empty() {
            continue;
        }
        any_command = true;
        // Parse the first shell token as the program; resolve it exactly as a
        // spawned filter child would; digest the resolved file's bytes. Any
        // failure here fails the whole dependency closed.
        let program = first_program(cmdline)?;
        let resolved = resolve_executable(&program, workdir)?;
        let content = executable_content_digest(&resolved, content_cache)?;
        write_prefixed(&mut h, cmd_key.as_bytes());
        h.update(&content);
    }
    if !any_command {
        return None;
    }
    Some(*h.finalize().as_bytes())
}

/// The concrete program of a filter command line: its first shell word. `None`
/// when the command line is unparseable (e.g. unbalanced quotes) or empty.
fn first_program(cmdline: &str) -> Option<String> {
    let words = shell_words::split(cmdline).ok()?;
    words.into_iter().find(|w| !w.is_empty())
}

/// Resolve a program name to a concrete executable file path, obeying the same
/// rules a spawned filter child does: a program containing a path separator is a
/// path (absolute, or relative to the worktree the child runs in); a bare name
/// is searched on `PATH`. `None` when no matching executable file exists.
fn resolve_executable(program: &str, workdir: &Path) -> Option<PathBuf> {
    if program.contains('/') || (cfg!(windows) && program.contains('\\')) {
        let p = Path::new(program);
        let candidate = if p.is_absolute() {
            p.to_path_buf()
        } else {
            workdir.join(p)
        };
        return is_executable_file(&candidate).then_some(candidate);
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(program);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Whether `p` is a regular file that is executable. Follows symlinks (a spawned
/// child would execute the link target), so the content digest is taken over the
/// real binary. On non-Unix, the executable bit is not modeled — any regular
/// file qualifies.
fn is_executable_file(p: &Path) -> bool {
    let Ok(md) = std::fs::metadata(p) else {
        return false;
    };
    if !md.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        md.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// BLAKE3 digest of a resolved executable's bytes, memoized by resolved path so
/// a binary shared by several commands (git-lfs `clean`/`smudge`/`process`) is
/// read and hashed once. `None` when the file cannot be read.
fn executable_content_digest(
    resolved: &Path,
    content_cache: &mut HashMap<PathBuf, Option<[u8; 32]>>,
) -> Option<[u8; 32]> {
    if let Some(cached) = content_cache.get(resolved) {
        return *cached;
    }
    let digest = std::fs::read(resolved)
        .ok()
        .map(|bytes| *blake3::hash(&bytes).as_bytes());
    content_cache.insert(resolved.to_path_buf(), digest);
    digest
}

/// Environment digest for one filter driver, computed by driver *class* so a
/// driver's env dependency is keyed exactly as completely as it can be proven.
///
/// * The **known LFS driver** (`crate::types::is_core_filter`) runs through the
///   dedicated `git-lfs filter-process` spawn (`spawn_lfs_process`), a
///   fixed-argument content-addressed transform. Its dependency is provably the
///   variables its own command lines reference (none, for git-lfs), so it takes
///   the narrow [`declared_env_digest`] — the fixed empty-set digest, identical
///   across every working directory, terminal, and sibling worktree.
/// * Every **arbitrary custom driver** runs through `sh -c <cmd>`
///   (`spawn_custom_filter_process`) with no `env_clear` and can read any
///   variable internally (`getenv`), which a command-line `$VAR` scan cannot
///   detect. It therefore takes the fail-closed [`whole_env_digest`]: the whole
///   process environment, so any env change fragments the key rather than
///   risking a stale exact hit (CLAUDE.md `<fail-closed>`).
fn filter_env_digest(driver: &str, kv: &BTreeMap<String, String>) -> [u8; 32] {
    if crate::types::is_core_filter(driver) {
        declared_env_digest(kv)
    } else {
        whole_env_digest()
    }
}

/// BLAKE3 digest of the environment variables a filter driver *declares* it
/// depends on: those its `clean`/`smudge`/`process` command lines reference via
/// shell substitution (`$VAR`/`${VAR}`), which `sh -c` expands at spawn time
/// (`spawn_custom_filter_process`). Each referenced name is digested with its
/// current value — or a distinct "declared but unset" marker — sorted so the
/// digest is deterministic, keys and values length-prefixed so no boundary can
/// be forged by adjacent variables. A driver referencing no variables (the
/// git-lfs case) yields the fixed empty-set digest, identical across every
/// working directory, terminal, and sibling worktree.
///
/// Sound ONLY for a driver whose *total* env dependency is known bounded — the
/// dedicated LFS driver. For arbitrary `sh -c` drivers this is a lower bound on
/// referenced names, not a proof of total dependency, so [`filter_env_digest`]
/// routes those to [`whole_env_digest`] instead.
fn declared_env_digest(kv: &BTreeMap<String, String>) -> [u8; 32] {
    let names = referenced_env_var_names(kv);
    let mut h = Hasher::new();
    h.update(b"gm.core.filter-env\0");
    h.update(&(names.len() as u64).to_le_bytes());
    for name in &names {
        write_prefixed(&mut h, name.as_bytes());
        match std::env::var_os(name) {
            Some(v) => {
                h.update(&[1u8]);
                write_prefixed(&mut h, os_str_bytes(&v).as_ref());
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
    *h.finalize().as_bytes()
}

/// Fail-closed environment digest for an arbitrary custom `sh -c` filter driver:
/// a BLAKE3 digest over the ENTIRE process environment as sorted, length-prefixed
/// `(name, value)` pairs. `spawn_custom_filter_process` runs the driver via
/// `sh -c <cmd>` with no `env_clear`, so the child inherits every ambient
/// variable and may read any of them internally (`getenv`) — `envsubst`
/// substituting `$VAR` into file CONTENT, a `decrypt --key-env SECRET_KEY` binary
/// reading `$SECRET_KEY`. A command-line `$VAR` scan proves only *referenced*
/// names, not a driver's *total* dependency, so keying only those would be
/// fail-OPEN: a changed variable the scan cannot see would serve a stale exact
/// hit. Keying the whole environment fails closed — any env change fragments the
/// key. The cost (no reuse across ambient env changes for custom-filter repos) is
/// the correct trade for a dependency that cannot be statically proven complete.
fn whole_env_digest() -> [u8; 32] {
    let mut vars: Vec<(std::ffi::OsString, std::ffi::OsString)> =
        std::env::vars_os().collect();
    vars.sort();
    let mut h = Hasher::new();
    h.update(b"gm.core.filter-env-full\0");
    h.update(&(vars.len() as u64).to_le_bytes());
    for (name, value) in &vars {
        write_prefixed(&mut h, os_str_bytes(name).as_ref());
        write_prefixed(&mut h, os_str_bytes(value).as_ref());
    }
    *h.finalize().as_bytes()
}

/// The set of environment-variable names referenced across a driver's
/// executable command lines. Sorted (a `BTreeSet`) so [`filter_env_digest`] is
/// order-stable.
fn referenced_env_var_names(kv: &BTreeMap<String, String>) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for cmd_key in FILTER_COMMAND_KEYS {
        if let Some(cmdline) = kv.get(cmd_key) {
            scan_env_refs(cmdline, &mut names);
        }
    }
    names
}

/// Collect POSIX-shell variable references (`$NAME`, `${NAME}`) from one command
/// line into `out`. A name is `[A-Za-z_][A-Za-z0-9_]*`; a `$` not introducing a
/// valid name (`$1`, `$$`, a trailing `$`) contributes nothing.
///
/// The scan is a conservative superset: it collects every syntactically
/// referenced name regardless of quoting or escaping (a `$VAR` the shell would
/// not actually expand inside `'single quotes'` is still keyed). Over-specifying
/// identity this way is fail-closed — it can only reject a legitimate reuse, not
/// serve a stale one — whereas under-scanning would risk a false cache hit.
fn scan_env_refs(s: &str, out: &mut BTreeSet<String>) {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'$' {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        if j < b.len() && b[j] == b'{' {
            j += 1;
        }
        let start = j;
        while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
            j += 1;
        }
        if j > start && !b[start].is_ascii_digit() {
            // The matched run is ASCII `[A-Za-z0-9_]`, so this never fails.
            if let Ok(name) = std::str::from_utf8(&b[start..j]) {
                out.insert(name.to_string());
            }
        }
        // `j >= i + 1` always, so this makes progress past the `$`.
        i = j;
    }
}

/// Raw bytes of an `OsStr` for digesting. On Unix this is the exact byte
/// content; elsewhere the lossless-enough UTF-8 view (env vars are effectively
/// text on those platforms).
fn os_str_bytes(s: &std::ffi::OsStr) -> std::borrow::Cow<'_, [u8]> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        std::borrow::Cow::Borrowed(s.as_bytes())
    }
    #[cfg(not(unix))]
    {
        match s.to_string_lossy() {
            std::borrow::Cow::Borrowed(t) => std::borrow::Cow::Borrowed(t.as_bytes()),
            std::borrow::Cow::Owned(t) => std::borrow::Cow::Owned(t.into_bytes()),
        }
    }
}

/// Digest over the sorted `(path, blob-oid?)` identity of every `.gitattributes`
/// committed at `HEAD` that can govern an anchored path: the repo root plus
/// each ancestor directory of an anchored path. A `None` records "probed,
/// absent" so a later addition of a `.gitattributes` changes the digest.
fn attributes_digest(repo: &gix::Repository, anchored: &BTreeSet<String>) -> [u8; 32] {
    let mut attrs: BTreeMap<String, Option<String>> = BTreeMap::new();
    collect_gitattributes(repo, Path::new(".gitattributes"), &mut attrs);
    for p in anchored {
        let mut dir = Path::new(p).parent();
        while let Some(d) = dir {
            collect_gitattributes(repo, &d.join(".gitattributes"), &mut attrs);
            dir = d.parent();
        }
    }
    let mut h = Hasher::new();
    h.update(b"gm.core.attributes\0");
    h.update(&(attrs.len() as u64).to_le_bytes());
    for (path, oid) in &attrs {
        write_prefixed(&mut h, path.as_bytes());
        match oid {
            Some(o) => {
                h.update(&[1u8]);
                write_prefixed(&mut h, o.as_bytes());
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
    *h.finalize().as_bytes()
}

fn collect_gitattributes(
    repo: &gix::Repository,
    path: &Path,
    out: &mut BTreeMap<String, Option<String>>,
) {
    let key = path.to_string_lossy().replace('\\', "/");
    if out.contains_key(&key) {
        return;
    }
    let oid = match crate::git::tree_entry_at(repo, "HEAD", path) {
        Ok(Some((mode, oid))) if mode.is_blob() => Some(oid.to_string()),
        _ => None,
    };
    out.insert(key, oid);
}

/// Digest of `core.autocrlf`/`core.eol`/`core.safecrlf` (missing distinguished
/// from empty). Mirrors the normalization inputs of `filter_config_hash`.
fn normalization_digest(repo: &gix::Repository) -> [u8; 32] {
    let snap = repo.config_snapshot();
    let mut h = Hasher::new();
    h.update(b"gm.core.normalization\0");
    for key in ["core.autocrlf", "core.eol", "core.safecrlf"] {
        write_prefixed(&mut h, key.as_bytes());
        match snap.string(key) {
            Some(v) => {
                h.update(&[1u8]);
                write_prefixed(&mut h, v.to_string().as_bytes());
            }
            None => {
                h.update(&[0u8]);
            }
        }
    }
    *h.finalize().as_bytes()
}

// ---------------------------------------------------------------------------
// Index / staged / worktree identities
// ---------------------------------------------------------------------------

/// Content-based whole-index identity: a digest over every index entry's
/// `(stage, mode, path, blob-oid)`, sorted by path/stage, with per-entry stat
/// fields (ctime/mtime/ino/dev/size) deliberately excluded. `Unreadable` when
/// the index could not be loaded (fail closed) — never a wall-clock fallback,
/// the defect `cache_v2::keys::index_checksum_bytes` embodied.
///
/// The former implementation digested `.git/index`'s last-20-byte trailer
/// checksum — a SHA over the *entire* index file INCLUDING every entry's stat
/// data. Two linked worktrees keep separate index files (`.git/index` vs
/// `.git/worktrees/<name>/index`), each written with its own checkout-time
/// stat, so their trailers never matched even at byte-identical staged content;
/// the differing `index_identity` forced a differing `canonical_key_digest`,
/// making a cross-worktree exact hit structurally impossible even on a clean
/// tree at the identical commit (card main-157). Keying off content identity
/// alone (mode + path + blob OID) makes the digest identical across worktrees
/// with the same staged content while still detecting any real staged change —
/// a mode flip or a blob-OID change moves it.
fn index_identity(entries: Option<&[crate::git::IndexEntrySnapshot]>) -> PathState {
    let Some(entries) = entries else {
        return PathState::Unreadable;
    };
    // Sort by (path, stage) so index-entry order — which is not semantic and can
    // differ across worktrees — cannot perturb the digest.
    let mut items: Vec<(&str, u8, u8, String)> = entries
        .iter()
        .map(|e| {
            (
                e.path.as_str(),
                stage_byte(e.stage),
                index_mode_byte(e.mode),
                e.oid.to_string(),
            )
        })
        .collect();
    items.sort();

    let mut h = Hasher::new();
    h.update(b"gm.core.index-identity\0");
    h.update(&(items.len() as u64).to_le_bytes());
    for (path, stage, mode, oid) in &items {
        write_prefixed(&mut h, path.as_bytes());
        h.update(&[*stage, *mode]);
        write_prefixed(&mut h, oid.as_bytes());
    }
    PathState::Tracked {
        blob: hex_bytes(h.finalize().as_bytes()),
    }
}

/// Stable one-byte discriminant for an index entry's conflict stage.
fn stage_byte(stage: gix::index::entry::Stage) -> u8 {
    use gix::index::entry::Stage;
    match stage {
        Stage::Unconflicted => 0,
        Stage::Base => 1,
        Stage::Ours => 2,
        Stage::Theirs => 3,
    }
}

/// Stable one-byte discriminant for an index entry's mode — enough to detect
/// the mode flips git tracks (an exec-bit toggle, blob↔symlink↔gitlink).
fn index_mode_byte(mode: gix::objs::tree::EntryMode) -> u8 {
    use gix::objs::tree::EntryKind;
    match mode.kind() {
        EntryKind::Tree => 0,
        EntryKind::Blob => 1,
        EntryKind::BlobExecutable => 2,
        EntryKind::Link => 3,
        EntryKind::Commit => 4,
    }
}

/// Typed staged identity for every relevant path, from the already-loaded index
/// snapshot. A path with any unmerged (stage 1/2/3) entry is `Conflict`; a
/// normal entry is `Tracked{blob}`; a relevant path absent from the index is
/// `Absent`. An unreadable index (`None`) makes every relevant path
/// `Unreadable` (fail-closed).
fn staged_states(
    entries: Option<&[crate::git::IndexEntrySnapshot]>,
    relevant: &BTreeSet<String>,
) -> Vec<PathStateEntry> {
    let entries = match entries {
        Some(e) => e,
        None => {
            return relevant
                .iter()
                .map(|p| PathStateEntry {
                    path: p.clone(),
                    state: PathState::Unreadable,
                })
                .collect();
        }
    };
    let mut by_path: BTreeMap<&str, PathState> = BTreeMap::new();
    for e in entries {
        let slot = by_path.entry(e.path.as_str()).or_insert(PathState::Absent);
        if e.stage == gix::index::entry::Stage::Unconflicted {
            // A real stage-0 entry, unless a conflict stage already claimed it.
            if !matches!(slot, PathState::Conflict) {
                *slot = PathState::Tracked {
                    blob: e.oid.to_string(),
                };
            }
        } else {
            *slot = PathState::Conflict;
        }
    }
    relevant
        .iter()
        .map(|p| PathStateEntry {
            path: p.clone(),
            state: by_path.get(p.as_str()).cloned().unwrap_or(PathState::Absent),
        })
        .collect()
}

/// Typed worktree identity for every relevant path. Read failures are typed
/// `Unreadable` (a directory where a file is expected, a permission error),
/// never conflated with `Absent` and never seeded with wall-clock time.
fn worktree_states(
    repo: &gix::Repository,
    relevant: &BTreeSet<String>,
) -> Result<Vec<PathStateEntry>> {
    let workdir = crate::git::work_dir(repo)?;
    Ok(relevant
        .iter()
        .map(|p| PathStateEntry {
            path: p.clone(),
            state: worktree_path_state(workdir, p),
        })
        .collect())
}

fn worktree_path_state(workdir: &Path, rel: &str) -> PathState {
    let abs = workdir.join(rel);
    let md = match std::fs::symlink_metadata(&abs) {
        Ok(md) => md,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return PathState::Absent,
        Err(_) => return PathState::Unreadable,
    };
    let ft = md.file_type();
    if ft.is_symlink() {
        match std::fs::read_link(&abs) {
            Ok(target) => PathState::WorktreeContent {
                content_digest: hex_bytes(
                    blake3::hash(target.to_string_lossy().as_bytes()).as_bytes(),
                ),
            },
            Err(_) => PathState::Unreadable,
        }
    } else if ft.is_file() {
        match std::fs::read(&abs) {
            Ok(bytes) => PathState::WorktreeContent {
                content_digest: hex_bytes(blake3::hash(&bytes).as_bytes()),
            },
            Err(_) => PathState::Unreadable,
        }
    } else {
        // A directory, fifo, socket, etc. is not readable file content.
        PathState::Unreadable
    }
}

// ---------------------------------------------------------------------------
// Availability proofs
// ---------------------------------------------------------------------------

/// Global sparse/promisor/LFS availability proofs from the resolver's existing
/// signals. Per-path proofs are not computed by any subsystem today (see module
/// docs) and are left empty.
fn availability(repo: &gix::Repository) -> AvailabilityProof {
    AvailabilityProof {
        lfs_installed: head_root_gitattributes_declares_lfs(repo),
        sparse_active: crate::git::common_dir(repo)
            .join("info")
            .join("sparse-checkout")
            .exists(),
        promisor_active: crate::git::promisor_active(repo),
        paths: Vec::new(),
    }
}

/// Whether HEAD's root `.gitattributes` blob declares `filter=lfs`. A real,
/// deterministic, non-forking signal (unlike a `git lfs version` probe).
fn head_root_gitattributes_declares_lfs(repo: &gix::Repository) -> bool {
    match crate::git::tree_entry_at(repo, "HEAD", Path::new(".gitattributes")) {
        Ok(Some((mode, oid))) if mode.is_blob() => match repo.find_object(oid) {
            Ok(obj) => obj
                .into_blob()
                .detach()
                .data
                .windows(10)
                .any(|w| w == b"filter=lfs"),
            Err(_) => false,
        },
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn write_prefixed(h: &mut Hasher, bytes: &[u8]) {
    h.update(&(bytes.len() as u64).to_le_bytes());
    h.update(bytes);
}

fn hex_bytes(b: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(b.len() * 2);
    for byte in b {
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests;
