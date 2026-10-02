/**
 * The per-platform vocabulary glossary for the authored skill templates —
 * the single place host-facing terms live, so a rendered tree can never
 * again teach vocabulary that is foreign or false on its own host (the
 * antigravity tree launched speaking Claude: bare `Read` tool names,
 * `git-span:git-span` plugin-namespace dispatch, host-specific file-read guidance).
 *
 * Templates cannot import a module (and the agent-skills CLI's Eta include()
 * cannot pass data on antigravity/opencode targets — the include merge
 * evaluates the pluginRootVar getter, which throws where that helper is
 * unavailable), so consumption is by generated region:
 * sync-skill-vocabulary.mjs writes this table into each template that
 * declares the region markers, and its --check mode keeps the copies honest.
 * The antigravity vocabulary gate
 * (packages/agent-hooks/test/antigravity/skill-tree-vocabulary.test.ts)
 * checks the rendered output for foreign tool vocabulary.
 * @module
 */

/**
 * Per-platform terms. Values are rendered verbatim into prose, so they carry
 * their own formatting (backticks for literal tool names). Claude Code names
 * its tools; the other hosts' file-read tool names are not pinned by any
 * contract we verify, so their entries describe the capability rather than
 * invent a name (see reference/antigravity.md: do not invent host syntax).
 * @type {Record<string, Record<string, string>>}
 */
export const vocabulary = {
  'claude-code': {
    readTool: '`Read`'
  },
  codex: {
    readTool: "your host's file-read tool"
  },
  opencode: {
    readTool: "your host's file-read tool"
  },
  antigravity: {
    readTool: "your host's file-read tool"
  }
};
