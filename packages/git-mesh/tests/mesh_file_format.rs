//! Integration tests for mesh file format: parse and serialize.
//!
//! All tests are `#[ignore]`d during the bootstrap phase.
//! Remove `#[ignore]` when the implementation is ready.

use git_mesh::mesh_file::{AnchorRecord, MeshFile};

#[test]
fn parse_valid_file() {
    let input = "\
packages/extension/src/foo.ts#L10-L35 sha256:0123456789abcdef
packages/extension/src/bar.ts sha256:abcdef0123456789
packages/extension/src/baz.ts#L80-L80 sha256:fedcba9876543210

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.
";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    assert_eq!(mesh.anchors.len(), 3);

    assert_eq!(mesh.anchors[0].path, "packages/extension/src/foo.ts");
    assert_eq!(mesh.anchors[0].start_line, 10);
    assert_eq!(mesh.anchors[0].end_line, 35);
    assert_eq!(mesh.anchors[0].algorithm, "sha256");
    assert_eq!(mesh.anchors[0].content_hash, "0123456789abcdef");

    assert_eq!(mesh.anchors[1].path, "packages/extension/src/bar.ts");
    assert_eq!(mesh.anchors[1].start_line, 0);
    assert_eq!(mesh.anchors[1].end_line, 0);

    assert_eq!(mesh.anchors[2].path, "packages/extension/src/baz.ts");
    assert_eq!(mesh.anchors[2].start_line, 80);
    assert_eq!(mesh.anchors[2].end_line, 80);

    assert!(mesh.why.contains("Checkout request flow"));
    assert!(mesh.why.contains("Stripe-backed server"));
}

#[test]
fn parse_empty_anchors_no_why() {
    let input = "\n\n";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    assert_eq!(mesh.anchors.len(), 0);
    assert_eq!(mesh.why, "");
}

#[test]
fn parse_anchors_without_why() {
    let input = "a.txt sha256:111\nb.txt sha256:222\n";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    assert_eq!(mesh.anchors.len(), 2);
    assert_eq!(mesh.why, "");
}

#[test]
fn parse_why_without_anchors() {
    let input = "\n\nJust a why with no anchors.";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    assert_eq!(mesh.anchors.len(), 0);
    assert_eq!(mesh.why, "Just a why with no anchors.");
}

#[test]
fn reject_missing_space_in_anchor_line() {
    let result = MeshFile::parse("bad-lined-without-space\n", ".mesh");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("no space"), "got: {err}");
}

#[test]
fn reject_missing_colon_in_hash_part() {
    let result = MeshFile::parse("file.txt sha256badhash\n", ".mesh");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("expected") || err.contains("colon"),
        "got: {err}"
    );
}

#[test]
fn reject_invalid_start_line() {
    let result = MeshFile::parse("file.txt#L0-L10 sha256:abc\n", ".mesh");
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("start line"), "got: {err}");
}

#[test]
fn reject_end_before_start() {
    let result = MeshFile::parse("file.txt#L10-L5 sha256:abc\n", ".mesh");
    assert!(result.is_err());
}

#[test]
fn reject_missing_line_range_separator() {
    let result = MeshFile::parse("file.txt#L10 sha256:abc\n", ".mesh");
    assert!(result.is_err());
}

#[test]
fn anchor_record_display_whole_file() {
    let r = AnchorRecord {
        path: "src/main.rs".into(),
        start_line: 0,
        end_line: 0,
        algorithm: "sha256".into(),
        content_hash: "deadbeef".into(),
    };
    assert_eq!(r.to_string(), "src/main.rs sha256:deadbeef");
}

#[test]
fn anchor_record_display_line_range() {
    let r = AnchorRecord {
        path: "src/lib.rs".into(),
        start_line: 42,
        end_line: 99,
        algorithm: "sha256".into(),
        content_hash: "cafebabe".into(),
    };
    assert_eq!(r.to_string(), "src/lib.rs#L42-L99 sha256:cafebabe");
}

#[test]
fn serialize_roundtrip() {
    let input = "\
a.txt sha256:111
b.rs#L1-L5 sha256:222

Some why text.
";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    let serialized = mesh.serialize();
    let reparsed = MeshFile::parse(&serialized, ".mesh").unwrap();
    assert_eq!(mesh, reparsed);
}

#[test]
fn serialize_no_why() {
    let input = "a.txt sha256:111\nb.rs#L1-L5 sha256:222\n";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    let output = mesh.serialize();
    // Should contain anchors and a trailing blank line
    assert!(output.contains("a.txt sha256:111"));
    assert!(output.contains("b.rs#L1-L5 sha256:222"));
    // Can re-parse
    let reparsed = MeshFile::parse(&output, ".mesh").unwrap();
    assert_eq!(mesh, reparsed);
}

#[test]
fn reject_empty_anchor_address() {
    let result = MeshFile::parse(" sha256:abc\n", ".mesh");
    assert!(result.is_err());
}

#[test]
fn reject_empty_hash() {
    let result = MeshFile::parse("file.txt \n", ".mesh");
    assert!(result.is_err());
}

#[test]
fn multiple_blank_lines_in_anchor_section() {
    // The first blank line separates anchors from why.
    // Content after the first blank line is part of the why block.
    let input = "a.txt sha256:111\n\n\nb.txt sha256:222\n\nwhy\n";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    assert_eq!(mesh.anchors.len(), 1);
    assert_eq!(mesh.anchors[0].path, "a.txt");
    // The why contains the remaining content after the first blank line.
    assert!(mesh.why.contains("b.txt sha256:222"));
    assert!(mesh.why.contains("why"));
}

#[test]
fn why_multiple_lines() {
    let input = "a.txt sha256:111\n\nLine 1\nLine 2\nLine 3\n";
    let mesh = MeshFile::parse(input, ".mesh").unwrap();
    assert_eq!(mesh.anchors.len(), 1);
    assert_eq!(mesh.why, "Line 1\nLine 2\nLine 3");
}
