/**
 * The responsive two-column/one-column layout options every embedded diff
 * editor is created with.
 *
 * The span viewer's diffs behave like VS Code's multi-diff editor: side by side
 * when the editor is wide enough, inline when it is not. Monaco decides that
 * itself from three options -- there is no layout code here, only the
 * configuration that turns the built-in behaviour on.
 *
 * The values are VS Code's own defaults, restated explicitly rather than left
 * to Monaco's fallbacks. Restating them is the point: a Monaco upgrade that
 * changed a default would otherwise silently change how every diff on the page
 * renders, and {@link diffLayout.test} pins them so that drift fails a test
 * instead.
 *
 * Monaco's decision, from `diffEditorOptions.ts`, is
 * `renderSideBySide && !(useInlineViewWhenSpaceIsLimited && width <=
 * renderSideBySideInlineBreakpoint && !screenReaderMode)`. The width compared
 * is the diff editor's *own* root element, not the window's -- so a diff inside
 * a narrow panel goes inline even on a wide monitor, and each card decides
 * independently.
 *
 * Kept free of value imports so it runs in the extension host, where the test
 * suite executes and no DOM exists; the Monaco reference is type-only.
 *
 * @summary Diff-editor options selecting side-by-side or inline by width.
 * @module spanViewer/webview/diffLayout
 */

import type * as monaco from 'monaco-editor';

/**
 * Editor width in px at or below which the inline view replaces side by side.
 *
 * VS Code's `diffEditorDefaultOptions.renderSideBySideInlineBreakpoint`.
 */
export const SIDE_BY_SIDE_INLINE_BREAKPOINT = 900;

/**
 * Layout options shared by every diff editor the span viewer creates.
 *
 * `useInlineViewWhenSpaceIsLimited` is only consulted while `renderSideBySide`
 * is true -- turning side by side off would leave it set but inert -- so the
 * two are declared together here rather than at the call site.
 */
export const RESPONSIVE_DIFF_LAYOUT_OPTIONS = {
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: true,
  renderSideBySideInlineBreakpoint: SIDE_BY_SIDE_INLINE_BREAKPOINT
} as const satisfies monaco.editor.IDiffEditorBaseOptions;
