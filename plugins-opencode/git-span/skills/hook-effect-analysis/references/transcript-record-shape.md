<!-- Generated from skills-src/git-span/hook-effect-analysis/references/transcript-record-shape.md by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

# Transcript record shape

The shape [`collect.mjs`](../scripts/collect.mjs) parses. Undocumented anywhere else in this repo; rediscovered by inspection and confirmed against this repo's own local `~/.claude/projects` transcripts.

Transcripts are JSONL at `~/.claude/projects/**/*.jsonl` (or the equivalent path on a remote host — see `collect.mjs --host`), one record per line. Ordinal position in the file is the only ordering signal available — there is no reliable timestamp ordering across sidechains (subagent transcripts live in a separate `subagents/*.jsonl` file per agent, each with its own ordinal sequence).

Every record carries a top-level `cwd` field — the workspace root the session ran in. `collect.mjs` uses the most recent `cwd` seen at or before a given record to resolve that record's tool-call paths to repo-relative, and records it as `project` on both the emissions intermediate and the activity index (so `baseline.mjs` can group sessions into a project's touched-file universe without re-deriving it).

A **hook emission** is a record with:

```
type: "attachment"
attachment.hookName: "PostToolUse:Read" | "PreToolUse:Edit" | ...
attachment.toolUseID: <tool_use id>
attachment.stdout: <JSON string>
```

`attachment.stdout` parses to `{ systemMessage, hookSpecificOutput: { additionalContext } }`. `additionalContext` is the payload extractors operate on; `systemMessage` usually duplicates it, so counting both double-counts. `stdout` is sometimes empty even when the hook fired — an empty emission is not the same as no emission. `collect.mjs` preserves this distinction: a present-but-empty `stdout` is recorded as `""`, an absent one as `null`; [`outcomes.mjs`](../scripts/outcomes.mjs) skips entity extraction for either without treating it as an error.

A **tool call** lives in `message.content[]` entries with `type: "tool_use"`, carrying `id`, `name`, and `input`. `collect.mjs` joins `attachment.toolUseID` to `tool_use.id` for the originating call. Scanning backwards N lines for the nearest `Read` instead of joining on the id misattributes `offset`/`limit` on a meaningful fraction of records — don't do that.

Subagent records carry `agentId` (the field is `agentId`, not `agentName` — see the correction note in `measurement-pitfalls.md`); sidechain records carry `isSidechain`. Subagent emissions are a substantial share of the local population and behave differently, so `collect.mjs` surfaces both fields on every emission rather than flattening them away.

De-duplicate on `(session, toolUseID, hookName)`. The same emission can appear more than once per transcript; counting raw records inflates totals — in the original analysis, roughly 2x (a reported population of 230 where the true figure was 116). `collect.mjs` performs this de-dup once, at collection time, so nothing downstream can forget to.

## Activity tool set

`collect.mjs` builds its activity index from `Read`, `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` tool calls whose `input.file_path` (or `input.notebook_path` for `NotebookEdit`) is a string, resolved to repo-relative against the record's `cwd`. `outcomes.mjs` treats `Read` as a "touch" and the other four as a "write"; a "touch" outcome is true whenever any of the five occurred after the emission.
