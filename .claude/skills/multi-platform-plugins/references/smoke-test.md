# Smoke-test runbook

Proves a user can install the published plugin. Run after the trees are rebuilt,
committed, and published.

## Before starting

Installing writes to real agent state. Prefer a disposable container. Otherwise
isolate per tool and delete the temp dirs afterward — redirecting `HOME` does not
work; each CLI reads its own variable:

| Tool | Isolation variable |
|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` |
| Codex | `CODEX_HOME` |
| OpenCode | `XDG_CONFIG_HOME` + `XDG_CACHE_HOME` |
| Antigravity | none — always writes `~/.gemini/config/plugins/` |

**An isolated config dir holds no credentials**, so every CLI there reports "not
logged in". Exercise install routes in isolation and run behavioral probes against
the install in the real config dir — two installs, planned up front.

**STOP** — Isolation is leaky for project-scoped state. Enabling or disabling a
plugin can write to the *real repository's* agent settings file even with every
config variable redirected, because project scope resolves from the working
directory. Either avoid enable/disable, or `git status` the repo afterward and
revert that file before reporting a clean run.

Discover the CLI paths at runtime — agent CLIs commonly live outside a
non-interactive shell's `PATH`, so `ssh host 'claude --version'` reports the tool
missing when it is installed. Search a global npm prefix, `~/.local/bin`, and
`~/.<tool>/bin`, then prepend what you find.

Confirm what the registry serves before testing the client: if the source is a git
host, the published ref must already contain the version you expect.

## Distribution paths

Routes fail independently. Enumerate them before declaring a platform tested:

| Platform | Routes |
|----------|--------|
| Claude Code | marketplace from a git URL; marketplace from a local path |
| Codex | marketplace from a git URL; marketplace from a local path |
| OpenCode | `opencode plugin <npm-pkg>`; local directory; `plugin[]` config array |
| Antigravity | local directory; git URL with the subdirectory as a path segment |

A defect in one route is invisible from another: a manifest missing its entry-point
declaration rejects the npm install while the local-directory install of the same
bytes succeeds. When time allows only one route, say so rather than reporting the
platform as passing.

### When an installer rejects the package

Do not guess the manifest shape from the error text. Clone the platform's own
source and read its detection logic; the accepted shapes and their precedence are
stated there. Prove the fix by A/B: install the patched and the unpatched published
copy with the *same command form at the same version*, and show the two opposite
outcomes. A patched install that merely succeeds establishes nothing.

## Per-platform round

Substitute the plugin name and marketplace id. Each block ends with the only check
that counts: the *installed* version.

### Claude Code

```
claude plugin marketplace add <owner/repo|path|url>   # first time only
claude plugin marketplace update <marketplace>
claude plugin update <plugin>@<marketplace>
claude plugin list
```

- **Already installed**: `plugin install` is a no-op that prints success and leaves
  the old version pinned; `plugin update` is the only command that moves it.
- **The marketplace name is already declared in settings with a different source**:
  adding it from a second source is refused. Run that route under an isolated
  `CLAUDE_CONFIG_DIR` rather than rewriting settings.
- **A local-path marketplace serves the plugin in place**, from the source tree
  rather than the cache copy — behavioral evidence there proves the working tree,
  not what a remote user receives. Only the git-URL route covers the cache copy.
- **Verify**: `claude plugin list`, or the `version` field in
  `~/.claude/plugins/installed_plugins.json`. The presence of a newer directory
  under `~/.claude/plugins/cache/<marketplace>/<plugin>/` proves only that it was
  fetched, never that it is the active install.

### Codex

```
codex plugin marketplace add <source>                 # first time only
codex plugin marketplace upgrade <marketplace>        # git marketplaces only
codex plugin add <plugin>@<marketplace>
codex plugin list
```

- **Git marketplace**: `marketplace upgrade` moves the installed version; no
  separate update command is needed.
- **Local marketplace**: `marketplace upgrade` refuses — "not configured as a Git
  marketplace" — and `plugin add` is the only command that moves it.
- **Verify**: the plugin's row in `codex plugin list` reads `installed, enabled`
  at the expected version. Its VERSION column comes from the install cache while
  PATH shows the live source, so an old version beside a current path is the
  stale-install tell — silent unless you read both columns.

### OpenCode

```
opencode plugin <npm-package>        # config-writing installer
opencode debug skill                 # verification
```

- **Scope**: `opencode plugin` writes `<cwd>/.opencode/opencode.json`, not the
  global config — verify from the directory you ran it in.
- **Installer rejects the package**: `opencode plugin` requires a plugin entrypoint
  — `exports["./tui"]`, `exports["./server"]`, or a top-level `main`. A package
  exposing only `exports["."]` fails with "No plugin targets found" and installs
  nothing. Only the package can fix it; there is no client-side workaround.
- **The config-array route**: naming the package in `opencode.json`'s `plugin[]`
  works, and OpenCode auto-installs it into
  `~/.cache/opencode/packages/<pkg>@latest/`. That cache is **sticky** — despite
  `@latest` it stays pinned to the first version fetched. Delete the directory and
  re-run any OpenCode command to force the current version.
- **Skills need a second step**: npm plugins cannot contribute skills, so the
  package ships an installer binary that copies its skill tree into OpenCode's
  skills directory. Refreshing the plugin does not refresh the skill — re-run the
  installer (it takes an `install` subcommand; bare invocation only prints usage),
  then `diff -r` the deployed tree against the source.
- **Verify**: `opencode debug skill` lists the skill with its resolved path. Its
  output is large; redirect it to a file and filter there — piping through `head`
  truncates the JSON mid-string and reports a present skill as missing.

### Antigravity

```
agy plugin validate <path-to-plugins-antigravity/<name>>
agy plugin install  <path-to-plugins-antigravity/<name>>
agy plugin install  https://github.com/<org>/<repo>.git/plugins-antigravity/<name>
agy plugin list
```

- The remote form appends the in-repo subdirectory to the `.git` URL as a path
  segment; the `#subdir` fragment form other tools accept fails to resolve.
- **Verify**: `agy plugin list` shows the import with its components, and files
  land under `~/.gemini/config/plugins/<name>/`. Hash installed against source
  (`find . -type f | sort | xargs md5sum | md5sum`) to prove byte-identity rather
  than mere presence. `agy plugin list` reports no version — read the installed
  `plugin.json`.
- **Auth is per-host**: `agy -p` returns `authentication required` wherever the
  login did not land, and login needs a controlling terminal, so it cannot be
  scripted over SSH. Confirm with a throwaway `agy -p "Reply with exactly: PONG"`
  first, and install on whichever host holds the session.

## Functional check

Installing proves delivery; it does not prove the plugin runs. Two complementary
checks:

**Hook check** — feed the installed bundle a synthetic event payload and confirm it
returns the expected diagnostic rather than a crash. Each host has its own payload
shape (stdin JSON for a CLI-invoked hook, a direct module import and call for an
in-process one), so write one per platform. Where hosts share a core, their outputs
should match byte-for-byte modulo line numbers — a divergence is a finding.

Build the fixture to satisfy the hook's gating predicate, or it returns empty and
the run looks like a silent pass. Two gates are easy to miss:

- **The file must qualify as a subject.** A predicate keyed on frontmatter fields
  rejects a fixture carrying only some of them; an empty return is a rejection, not
  a pass.
- **The companion binary may need repository context.** A tool that resolves paths
  through git history errors out under a bare temp directory: `git init` the
  fixture directory and commit the files.

**Sentinel check** — plant a fixture skill carrying a unique random sentinel, then
ask the CLI non-interactively to load that skill and print it verbatim. Exact-matching
the sentinel in stdout proves discovery *and* behavioral loading end to end, which a
discovery listing alone does not.

When testing the *real* skill, choose the probe fact carefully: ask for something
recorded only in a deep reference file the skill links to — a diagnostic
identifier, an exit-code meaning — never anything inferable from general knowledge
or the skill's name. A correct answer then proves discovery, progressive disclosure
into the linked file, and use. Require the CLI to cite its source: a cited path
under the *installed* skill directory proves the answer came from the deployed copy
rather than the repository checkout.

- **The CLI cannot read the installed file** (sandbox, or a working-directory
  restriction): it does not fail — it answers from general knowledge, and the
  fabrication is plausible: a well-formed identifier that does not exist, cited to
  a path that does not exist. Always confirm the cited path resolves under the
  installed tree. Grant read access and re-run (`claude -p --add-dir <dir>`,
  `codex exec --dangerously-bypass-approvals-and-sandbox`); a probe that searched
  the web instead of reading disk is not evidence.
- **The CLI is unauthenticated**: the sentinel check cannot run. Classify the
  result explicitly as *unauthenticated* — distinct from CLI-unavailable or
  skill-resolution-failure — and fall back to discovery evidence. Do not report a
  behavioral pass that never executed.
- **The platform offers only static validation** (no session concept): a validate
  subcommand is the whole check; it needs no config or credentials.

If the hook shells out to a companion binary, resolve where that binary came from
and compare its `--version` against the release under test. A resolver that falls
back through several locations can silently bind to a stale copy — a local dev
build on `PATH`, or one bundled by an editor extension — so the hook "passes"
while exercising the wrong version. Pin the intended binary through the resolver's
override environment variable, using one unpacked from the published per-platform
package rather than whatever `PATH` offers.

## The companion binary's platform packages

When the hook shells out to a CLI published as per-platform npm packages, the smoke
round covers only the host's own architecture. Verify the rest structurally:

```
npm pack <pkg>@<version> && tar xzf *.tgz
file package/bin/*
```

- Confirm each package's declared `os`/`cpu` matches the architecture `file` reports
  for the binary inside it, and that the Windows package carries the `.exe` name.
  A wrong-architecture binary is silent until a user on that platform installs.
- Foreign-architecture binaries of the *same OS* often run under emulation (linux-x64
  on aarch64 via binfmt), so try `--version` on each and record which executed.
- Binaries for another OS cannot run. Structural verification is the ceiling; report
  it as such rather than implying execution.

## Reporting

Report per platform: the version installed, the command that moved it, the routes
exercised, and any manual step required. A platform needing an undocumented step is
a finding even when the install succeeded.

Label each result by the strength of its evidence; never let a weaker one borrow
the word "pass" from a stronger one:

- **Behavioral** — the hook fired, or the CLI loaded the skill and used it. The
  only result that proves the plugin works.
- **Structural** — the right bytes are in the right place (a hash against the
  source, a matching architecture). Proves delivery, not function.
- **Blocked** — a precondition failed: unauthenticated CLI, unavailable
  architecture, missing host. Name the precondition; never fold it into a pass or
  omit it. Keep blocked items in the report — they are what to re-check when the
  precondition clears.
