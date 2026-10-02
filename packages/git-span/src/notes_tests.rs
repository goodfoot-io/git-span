//! Executable acceptance specification for the durable notes model/store.
use crate::notes::*;
use serde_json::json;

fn parsed(text: &str) -> ParsedDocument {
    parse_input(Some(text), &mut std::io::empty(), true).unwrap()
}
fn sha() -> &'static str {
    "1111111111111111111111111111111111111111"
}

#[test]
#[ignore = "notes bootstrap: input validation"]
fn notes_inputs_accept_scalars_stdin_and_empty_second_source() {
    for text in ["null", "true", "42", "\"hello\"", "[]", "{}"] {
        assert_eq!(
            parsed(text).document,
            serde_json::from_str::<serde_json::Value>(text).unwrap()
        );
        let mut input = text.as_bytes();
        assert_eq!(parse_input(None, &mut input, false).unwrap(), parsed(text));
        assert_eq!(
            parse_input(Some(text), &mut std::io::empty(), false).unwrap(),
            parsed(text)
        );
    }
}

#[test]
#[ignore = "notes bootstrap: input errors"]
fn notes_inputs_reject_conflicts_invalid_empty_terminal_and_limits() {
    assert!(parse_input(None, &mut std::io::empty(), true).is_err());
    assert!(parse_input(None, &mut std::io::empty(), false).is_err());
    assert!(parse_input(Some("{}"), &mut "null".as_bytes(), false).is_err());
    for text in ["", " ", "{", "{} {}", "NaN"] {
        assert!(parse_input(Some(text), &mut std::io::empty(), true).is_err());
    }
    let over = format!("\"{}\"", "x".repeat(MAX_DOCUMENT_BYTES));
    assert!(parse_input(Some(&over), &mut std::io::empty(), true).is_err());
    assert!(parse_input(None, &mut over.as_bytes(), false).is_err());
    let deep = format!("{}0{}", "[".repeat(256), "]".repeat(256));
    assert!(parse_input(Some(&deep), &mut std::io::empty(), true).is_err());
}

#[test]
#[ignore = "notes bootstrap: canonical identity"]
fn notes_identity_sorts_objects_decodes_strings_preserves_arrays_and_numbers() {
    assert_eq!(
        parsed(r#" {"b":{"y":2,"x":1},"a":"\u0061"} "#),
        parsed(r#"{"a":"a","b":{"x":1,"y":2}}"#)
    );
    assert_eq!(parsed(r#"{"a":1,"a":2}"#), parsed(r#"{"a":2}"#));
    assert_ne!(
        parsed("[1,2]").canonical_document,
        parsed("[2,1]").canonical_document
    );
    for (a, b) in [
        ("1", "1.0"),
        ("9007199254740992", "9007199254740993"),
        ("1e9999", "2e9999"),
    ] {
        assert_ne!(parsed(a).canonical_document, parsed(b).canonical_document);
        assert_eq!(parsed(a).document.to_string(), a);
    }
    assert_eq!(
        canonicalize(&json!({"z":1,"a":2})).unwrap(),
        r#"{"a":2,"z":1}"#
    );
}

#[test]
#[ignore = "notes bootstrap: identifier validation"]
fn notes_ids_are_positive_safe_integers() {
    assert_eq!(parse_id("1").unwrap(), NoteId(1));
    assert_eq!(
        parse_id(&MAX_NOTE_ID.to_string()).unwrap(),
        NoteId(MAX_NOTE_ID)
    );
    for invalid in [
        "0",
        "-1",
        "1.0",
        "9007199254740992",
        "18446744073709551616",
        "x",
    ] {
        assert!(parse_id(invalid).is_err());
    }
}

#[test]
#[ignore = "notes bootstrap: durable store"]
fn notes_store_deduplicates_present_associations_and_preserves_monotonic_ids() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("notes.db");
    let store = Store::at(&path);
    assert!(store.list(&Selection::All).unwrap().is_empty());
    assert!(!path.exists());
    let first = store.add(sha(), &parsed(r#"{"b":2,"a":1}"#)).unwrap();
    assert_eq!(first.id, NoteId(1));
    assert_eq!(
        store.add(sha(), &parsed(r#"{"a":1,"b":2}"#)).unwrap(),
        first
    );
    let second = store.add(sha(), &parsed("null")).unwrap();
    assert_eq!(second.id, NoteId(2));
    let other = store
        .add("2222222222222222222222222222222222222222", &parsed("null"))
        .unwrap();
    assert_eq!(other.id, NoteId(3));
    assert_eq!(
        store.list(&Selection::Commits(vec![sha().into()])).unwrap(),
        vec![first.clone(), second.clone()]
    );
    assert!(store.list(&Selection::Commits(vec![])).unwrap().is_empty());
    assert_eq!(store.show(first.id).unwrap(), first);
    assert_eq!(store.remove(other.id).unwrap(), other);
    store.remove(first.id).unwrap();
    store.remove(second.id).unwrap();
    let reopened = Store::at(&path);
    assert_eq!(reopened.add(sha(), &parsed("null")).unwrap().id, NoteId(4));
    assert!(reopened.show(first.id).is_err());
    assert!(reopened.remove(first.id).is_err());
}

#[test]
#[ignore = "notes bootstrap: store fail-closed"]
fn notes_store_rejects_corrupt_foreign_incompatible_and_malformed_storage() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("notes.db");
    std::fs::write(&path, b"not a sqlite database").unwrap();
    let before = std::fs::read(&path).unwrap();
    let store = Store::at(&path);
    assert!(store.list(&Selection::All).is_err());
    assert!(store.add(sha(), &parsed("null")).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
    std::fs::remove_file(&path).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch("CREATE TABLE foreign_data (value TEXT);")
        .unwrap();
    drop(connection);
    let before = std::fs::read(&path).unwrap();
    assert!(store.add(sha(), &parsed("null")).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
    std::fs::remove_file(&path).unwrap();
    store.add(sha(), &parsed("null")).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch("PRAGMA user_version = 999;")
        .unwrap();
    drop(connection);
    assert!(store.list(&Selection::All).is_err());
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch("PRAGMA user_version = 1; UPDATE notes SET document = 'invalid-json';")
        .unwrap();
    drop(connection);
    assert!(store.list(&Selection::All).is_err());
    assert!(store.show(NoteId(1)).is_err());
    assert!(store.remove(NoteId(1)).is_err());
}

#[test]
#[ignore = "notes bootstrap: store exhaustion"]
fn notes_allocation_exhaustion_and_failed_mutations_preserve_records() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("notes.db");
    let store = Store::at(&path);
    let first = store.add(sha(), &parsed("null")).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE sqlite_sequence SET seq = ?1 WHERE name = 'notes'",
            [MAX_NOTE_ID],
        )
        .unwrap();
    drop(connection);
    assert_eq!(store.add(sha(), &parsed("null")).unwrap(), first);
    assert!(store.add(sha(), &parsed("1")).is_err());
    assert_eq!(store.list(&Selection::All).unwrap(), vec![first]);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER refuse_delete BEFORE DELETE ON notes BEGIN SELECT RAISE(ABORT, 'failure'); END;").unwrap();
    drop(connection);
    assert!(store.remove(NoteId(1)).is_err());
    assert_eq!(store.show(NoteId(1)).unwrap().id, NoteId(1));
}

#[test]
#[ignore = "notes bootstrap: locking timeout"]
fn notes_busy_timeout_names_the_durable_storage_without_success() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("notes.db");
    let store = Store::at(&path);
    store.add(sha(), &parsed("null")).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE;").unwrap();
    let start = std::time::Instant::now();
    let error = store.add(sha(), &parsed("1")).unwrap_err();
    assert!(start.elapsed().as_secs() >= 29);
    assert!(start.elapsed().as_secs() < 40);
    assert!(format!("{error:#}").contains(&path.display().to_string()));
}

#[test]
#[ignore = "notes bootstrap: bundled SQLite concurrent first-open"]
fn notes_concurrent_first_open_and_duplicate_allocation_are_atomic() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("notes.db");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                Store::at(&path).add(sha(), &parsed("null")).unwrap().id
            })
        })
        .collect();
    for handle in handles {
        assert_eq!(handle.join().unwrap(), NoteId(1));
    }
    assert_eq!(
        Store::at(&path).add(sha(), &parsed("true")).unwrap().id,
        NoteId(2)
    );
}

#[test]
#[ignore = "notes bootstrap: shared repository storage"]
fn notes_store_paths_use_git_common_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = gix::init(tmp.path()).unwrap();
    assert_eq!(
        Store::for_repo(&repo).path,
        crate::git::common_dir(&repo).join("span/notes.db")
    );
}
