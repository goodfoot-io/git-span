# Authoring notes

## The bundler registry

A single JSON registry drives every generated tree. Per plugin it declares:

- `skillsSrc` — the authored template directory; the only editable copy
- `<platform>PluginRoot` — each platform's plugin root
- `targets[]` — `{platform, path}` pairs the renderer writes to. A platform may
  appear more than once when the same dialect is published to a second location
  (for example a shared `AGENTS.md`-convention skills root alongside the plugin's
  own tree)
- `platformDirs[]` — `platform:kind=path` strings templates read to name real
  paths per platform, so prose can cite a host's actual config location
- `lintBaseline` — accepted diagnostics plus a `reason` string

Adding a platform means adding its root, its `targets[]` entries, and its
`platformDirs[]` lines. A target whose platform requires a plugin root but declares
none fails the registry's own validation.

## The variant helper

Templates are Eta. A platform-varying value is declared once at the top and
interpolated in the body:

```
<% const hookEvent = it.variant({
  "claude-code": "PostToolUse",
  codex: "PostToolUse",
  opencode: "tool.execute.after",
  antigravity: null
}); %>
...
<% if (hookEvent !== null) { %>
The hook fires on <%= hookEvent %>.
<% } %>
```

- Mapping a platform to `null` plus a guard is how an inapplicable section drops
  out entirely — never fork the file per platform.
- The helper requires an entry for every known platform; a missing key is an error,
  which is what makes adding a platform surface every place that needs a decision.

## Lint baselines

The skills linter checks template portability — frontmatter key allowlists,
platform-specific naming rules. A baseline entry is an accepted, explained
exception, not a mute button.

Before adding one, establish that the diagnostic is wrong *for this content* and
write the reason down. A baseline whose reason says only "pre-existing" is a defect
waiting to ship.

## Freshness gates

Generated trees and hook bundles are committed. Validation rebuilds both and then
fails if the working tree is dirty, because a committed artifact that no longer
matches its source is output nobody authored.

- **A rebuild dirties a tree**: the regenerated output is correct — commit it.
- **A diff appears in a tree you did not touch**: someone hand-edited the generated
  copy, or a source changed without a rebuild. Fix the source, never the output.

Generated skill trees are normally excluded from documentation linters (a
`.wikiignore` or equivalent), since a fix applied to a rendered tree is discarded
by the next build. That exclusion also means link checkers do not validate the
rendered trees — the templates are the only place errors get caught.

## Not everything under a platform tree is generated

"Never hand-edit a generated tree" is the default, not a universal. Some files
inside `plugins-*/` are authored — OpenCode's `package.json` is both the npm
publishing manifest and a version-bearing surface, and no build step writes it.
Editing it is correct; editing a rendered skill page never is.

Decide by provenance, not by location. Grep the renderer and the packer for writes
to the path: a file no build step writes is authored, and the freshness gate
proves it by staying green when you change it and rebuild. Getting this backwards
in either direction costs real time — reverting a legitimate manifest fix as
"generated output", or hand-patching a rendered page the next build discards.

## Hook binary resolution

A hook that shells out to a companion CLI resolves it through an override
environment variable first, then a search path. Two consequences:

- The hook can appear healthy while bound to a stale binary from an unrelated
  install. Confirm which path resolved before trusting a functional check.
- The override variable is the supported way to pin a specific build in tests.

Surfacing matters as much as behavior: when the binary cannot launch, a
post-write hook cannot block, so it must emit a loud, explicit notice rather than
passing silently. Preserve that surfacing when adapting the hook to a new platform.

## Coupled edits

Generated bundles, rendered trees, and their sources are coupled by build steps
that no compiler enforces. When editing a hook source or template, the matching
generated artifact must be rebuilt in the same change. Repos using a span or
coupling tracker will surface these pairs — heed them; the coupling is real even
where the tool is absent.
