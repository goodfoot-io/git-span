"""Cross-language parity between the hooks' skill-ref protocol and this bridge.

The hooks' closing skill guidance travels as a machine-readable placeholder
line plus a structured ``hookSpecificOutput.skillRef`` field (main-332); this
bridge substitutes the line with its own environment-appropriate instruction
and never string-matches English prose. Nothing in the wire protocol itself
ties the TypeScript emitter to this Python consumer, so these tests read
``packages/agent-hooks/src/common/advisor-core.ts`` as fixture data — the
repo's established source-as-fixture approach (cf.
packages/discover/test/signals/sourceText.test.ts) — and drive the parsed
literals through :class:`HookBridge`. A format or ref change on either side
alone now fails loudly here instead of silently leaving mini-swe-agent
sessions with instructions for a skill their host does not have.
"""

import re
from pathlib import Path

from minisweagent_gitspan.bridge import SKILL_REF_FIELD, HookBridge

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
ADVISOR_CORE = WORKSPACE_ROOT / "packages" / "agent-hooks" / "src" / "common" / "advisor-core.ts"
CLAUDE_ADVISOR = WORKSPACE_ROOT / "packages" / "agent-hooks" / "src" / "claude" / "advisor.ts"

SKILL_FILE = "/opt/git-span/skills/git-span/SKILL.md"


def ts_string_const(source_name: Path, name: str) -> str:
    """Extract a single-quoted ``export const NAME[: T] = '...';`` literal."""
    source = source_name.read_text(encoding="utf-8")
    match = re.search(rf"export const {name}(?:\s*:\s*[\w<>| ]+)?\s*=\s*'(?P<value>(?:[^'\\]|\\.)*)';", source)
    assert match is not None, f"{source_name.name} no longer declares export const {name}"
    return match.group("value")


def test_bridge_substitutes_exactly_the_token_the_hooks_emit():
    start = ts_string_const(ADVISOR_CORE, "SKILL_REF_TOKEN_START")
    end = ts_string_const(ADVISOR_CORE, "SKILL_REF_TOKEN_END")
    ref = ts_string_const(ADVISOR_CORE, "GIT_SPAN_SKILL_REF")

    # The bridge must resolve the very ref the TS side emits...
    bridge = HookBridge(session_id="parity", skill_file=SKILL_FILE)
    assert bridge._instruction_for_ref(ref) is not None

    # ...inside the exact token shape the TS side renders.
    payload = f"<git-span>\n## linked-files\n- src/a.py#L1-L2\n\n{start}{ref}{end}\n</git-span>"
    rewritten = bridge._rewrite_context(payload, skill_ref=ref)

    assert rewritten is not None
    assert f"Read `{SKILL_FILE}` with `sed` before acting on this report;" in rewritten
    assert f"read any referenced file relative to `{Path(SKILL_FILE).parent}`." in rewritten
    assert "{{skill-ref:" not in rewritten
    # Everything around the placeholder line survives untouched.
    assert rewritten.startswith("<git-span>\n## linked-files\n- src/a.py#L1-L2\n\n")
    assert rewritten.endswith("\n</git-span>")


def test_absent_structured_field_means_no_substitution_is_attempted():
    start = ts_string_const(ADVISOR_CORE, "SKILL_REF_TOKEN_START")
    end = ts_string_const(ADVISOR_CORE, "SKILL_REF_TOKEN_END")
    ref = ts_string_const(ADVISOR_CORE, "GIT_SPAN_SKILL_REF")

    bridge = HookBridge(session_id="parity", skill_file=SKILL_FILE)
    payload = f"<git-span>\n{start}{ref}{end}\n</git-span>"

    # No hookSpecificOutput.skillRef → the bridge returns the payload
    # verbatim; prose matching is gone entirely (fail-closed).
    assert bridge._rewrite_context(payload) == payload


def test_emitted_field_name_matches_the_python_gate():
    source = CLAUDE_ADVISOR.read_text(encoding="utf-8")
    # The adapter attaches the structured field by its literal wire name;
    # SKILL_REF_FIELD below must keep spelling it identically.
    assert re.search(r"\bskillRef:\s*result\.skillRef\b", source), (
        "claude/advisor.ts no longer emits hookSpecificOutput.{skillRef: result.skillRef}"
    )
    assert SKILL_REF_FIELD == "skillRef"


def test_mswea_harness_is_the_only_token_emitter():
    source = ADVISOR_CORE.read_text(encoding="utf-8")
    emissions = re.findall(r"skillRefToken\(GIT_SPAN_SKILL_REF\)", source)
    assert len(emissions) == 1, "the mswea placeholder must be emitted from exactly one render site"
    # And the renderer that owns it gates both the token and the structured
    # ref on the mswea harness alone.
    assert re.search(r"harness === 'mswea'", source)
