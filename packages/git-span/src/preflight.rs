//! Explicit staged-only discovery. No index/worktree writes, repair or approval.
mod snapshot;
use anyhow::{Context, Result, ensure};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use snapshot::Entry;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PreflightAnchor {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub present: bool,
    #[schemars(required, schema_with = "crate::schemas::nullable_schema::<String>")]
    pub blob_oid: Option<String>,
    /// Exact stored identity at its declared staged address, not semantic approval.
    pub content_matches: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PreflightSpan {
    pub name: String,
    pub why: String,
    pub evidence_revision: String,
    pub anchors: Vec<PreflightAnchor>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PreflightDocument {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub operation: String,
    /// Git tree object ID calculated in memory; no write-tree/index mutation.
    pub staged_tree: String,
    pub evidence_revision: String,
    pub obligations: Vec<PreflightSpan>,
    pub removed_spans: Vec<PreflightSpan>,
}
fn declarations(
    repo: &gix::Repository,
    entries: &[Entry],
    root: &str,
) -> Result<BTreeMap<String, (String, crate::span_file::SpanFile)>> {
    let prefix = format!("{root}/");
    let mut result = BTreeMap::new();
    let mut total = 0;
    for entry in entries {
        let Some(name) = entry.path.strip_prefix(&prefix) else {
            continue;
        };
        if name.split('/').any(|s| s.starts_with('.')) {
            continue;
        }
        ensure!(
            entry.mode == "100644" || entry.mode == "100755",
            "staged span definition is not a regular file: {}",
            entry.path
        );
        let bytes = snapshot::blob(repo, entry)?;
        total += bytes.len();
        ensure!(
            total <= snapshot::MAX_BYTES,
            "staged span declarations exceed 16 MiB"
        );
        let text = std::str::from_utf8(&bytes)?;
        let span = crate::span_file::SpanFile::parse(text)
            .with_context(|| format!("parse staged span {}", entry.path))?;
        ensure!(
            result.len() < 4096,
            "staged preflight exceeds 4096 span definitions"
        );
        result.insert(name.into(), (entry.oid.clone(), span));
    }
    Ok(result)
}
fn render(
    repo: &gix::Repository,
    name: &str,
    definition_oid: &str,
    span: &crate::span_file::SpanFile,
    index: &BTreeMap<&str, &Entry>,
    blobs: &mut BTreeMap<String, git_span_core::LineIndex<'static>>,
    bytes: &mut usize,
) -> Result<PreflightSpan> {
    ensure!(
        span.anchors.len() <= 4096,
        "staged span exceeds 4096 anchors"
    );
    let mut anchors = Vec::new();
    for anchor in &span.anchors {
        snapshot::checked_path(&anchor.path)?;
        let entry = index.get(anchor.path.as_ref());
        let mut matches = false;
        if let Some(entry) = entry {
            // Gitlinks identify commits, not source blobs; do not pretend they were reviewed.
            if entry.mode == "100644" || entry.mode == "100755" || entry.mode == "120000" {
                if !blobs.contains_key(&entry.oid) {
                    let data = snapshot::blob(repo, entry)?;
                    *bytes += data.len();
                    ensure!(
                        *bytes <= 64 * 1024 * 1024,
                        "staged preflight evidence exceeds 64 MiB"
                    );
                    blobs.insert(
                        entry.oid.clone(),
                        git_span_core::LineIndex::build_shared(data.into()),
                    );
                }
                let data = &blobs[&entry.oid];
                let extent = if anchor.start_line == 0 {
                    git_span_core::AnchorExtent::WholeFile
                } else {
                    git_span_core::AnchorExtent::LineRange {
                        start: anchor.start_line,
                        end: anchor.end_line,
                    }
                };
                let in_bounds =
                    anchor.start_line == 0 || data.line_count() >= anchor.end_line as usize;
                matches = in_bounds
                    && anchor.algorithm.as_ref() == git_span_core::RK64_ALGORITHM
                    && git_span_core::rk64_to_hex(git_span_core::cheap_fingerprint_indexed(
                        data, &extent,
                    )) == anchor.content_hash.as_ref();
            }
        }
        anchors.push(PreflightAnchor {
            path: anchor.path.to_string(),
            start_line: anchor.start_line,
            end_line: anchor.end_line,
            present: entry.is_some(),
            blob_oid: entry
                .filter(|e| matches!(e.mode.as_str(), "100644" | "100755" | "120000"))
                .map(|e| e.oid.clone()),
            content_matches: matches,
        });
    }
    let revision = blake3::hash(&serde_json::to_vec(&(
        name,
        definition_oid,
        &span.why,
        &anchors,
    ))?)
    .to_hex()
    .to_string();
    Ok(PreflightSpan {
        name: name.into(),
        why: span.why.clone(),
        evidence_revision: revision,
        anchors,
    })
}
/// Calculate the exact staged tree identity without writing an object or cache-tree extension.
fn tree_hash(repo: &gix::Repository, entries: &[Entry]) -> Result<gix::ObjectId> {
    #[derive(Default)]
    struct Node {
        files: BTreeMap<String, (String, gix::ObjectId)>,
        dirs: BTreeMap<String, Node>,
    }
    fn insert(node: &mut Node, parts: &[&str], entry: &Entry) -> Result<()> {
        if parts.len() == 1 {
            ensure!(
                !node.dirs.contains_key(parts[0]),
                "staged file/directory collision"
            );
            node.files
                .insert(parts[0].into(), (entry.mode.clone(), entry.oid.parse()?));
        } else {
            ensure!(
                !node.files.contains_key(parts[0]),
                "staged file/directory collision"
            );
            insert(
                node.dirs.entry(parts[0].into()).or_default(),
                &parts[1..],
                entry,
            )?;
        }
        Ok(())
    }
    fn hash(node: Node, kind: gix::hash::Kind) -> Result<gix::ObjectId> {
        let mut children = node.files;
        for (name, child) in node.dirs {
            children.insert(name, ("40000".into(), hash(child, kind)?));
        }
        let mut sorted: Vec<_> = children.into_iter().collect();
        sorted.sort_by(|a, b| {
            format!("{}{}", a.0, if a.1.0 == "40000" { "/" } else { "" }).cmp(&format!(
                "{}{}",
                b.0,
                if b.1.0 == "40000" { "/" } else { "" }
            ))
        });
        let mut bytes = Vec::new();
        for (name, (mode, oid)) in sorted {
            bytes.extend_from_slice(format!("{mode} {name}\0").as_bytes());
            bytes.extend_from_slice(oid.as_slice());
        }
        Ok(gix::objs::compute_hash(
            kind,
            gix::objs::Kind::Tree,
            &bytes,
        )?)
    }
    let mut root = Node::default();
    for entry in entries {
        let parts: Vec<_> = entry.path.split('/').collect();
        ensure!(parts.len() <= 128, "staged path exceeds depth bound");
        insert(&mut root, &parts, entry)?;
    }
    hash(root, repo.object_hash())
}
/// Relevant obligations use staged declarations and index blobs, including removed definitions.
pub fn preflight(repo: &gix::Repository) -> Result<PreflightDocument> {
    let root = snapshot::span_root(repo)?;
    let head_identity = snapshot::head_identity(repo)?;
    let index = snapshot::entries(repo)?;
    let head = snapshot::head_entries(repo)?;
    let old = declarations(repo, &head, &root)?;
    let staged = declarations(repo, &index, &root)?;
    let old_paths: BTreeMap<_, _> = head.iter().map(|e| (e.path.as_str(), e)).collect();
    let paths: BTreeMap<_, _> = index.iter().map(|e| (e.path.as_str(), e)).collect();
    let changed: BTreeSet<_> = old_paths
        .keys()
        .chain(paths.keys())
        .filter(|p| old_paths.get(**p) != paths.get(**p))
        .copied()
        .collect();
    let mut obligations = Vec::new();
    let mut removed_spans = Vec::new();
    let mut blobs = BTreeMap::new();
    let mut total = 0;
    for (name, (oid, span)) in &staged {
        let definition_changed = old.get(name).is_none_or(|(previous, _)| previous != oid);
        let source_changed = span
            .anchors
            .iter()
            .any(|a| changed.contains(a.path.as_ref()))
            || old
                .get(name)
                .is_some_and(|(_, s)| s.anchors.iter().any(|a| changed.contains(a.path.as_ref())));
        if definition_changed || source_changed {
            obligations.push(render(
                repo, name, oid, span, &paths, &mut blobs, &mut total,
            )?);
        }
    }
    for (name, (oid, span)) in &old {
        if !staged.contains_key(name) {
            removed_spans.push(render(
                repo, name, oid, span, &paths, &mut blobs, &mut total,
            )?);
        }
    }
    ensure!(
        index == snapshot::entries(repo)?
            && head == snapshot::head_entries(repo)?
            && head_identity == snapshot::head_identity(repo)?,
        "staged artifact changed during preflight; rerun"
    );
    let staged_tree = tree_hash(repo, &index)?.to_string();
    let revision = blake3::hash(&serde_json::to_vec(&(
        &staged_tree,
        &head_identity,
        &head,
        &root,
    ))?)
    .to_hex()
    .to_string();
    let report = PreflightDocument {
        schema_version: 1,
        operation: "preflight".into(),
        staged_tree,
        evidence_revision: revision,
        obligations,
        removed_spans,
    };
    ensure!(
        serde_json::to_vec(&report)?.len() <= 1024 * 1024,
        "staged preflight output exceeds 1 MiB; narrow staged scope"
    );
    Ok(report)
}
