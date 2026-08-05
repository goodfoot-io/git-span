/**
 * Shared Bash span → touch translation and the join-gating driver (plan §2,
 * §3 step 2). Both adapters consume this module once their duplicate Bash
 * span loops collapse: it owns the per-command verdict thread — pass A
 * `evaluateWriteGate` sweep, the explanation map, the join filter, and pass B
 * per-surviving-span `runTouchHook` — plus the whole-command `interrupted`
 * gate (plan §4).
 */

import type { ResolvedSpan, SpanMatch } from './parse-command.js';
import { type MemoStore, resolveTouchScope } from './span-surface.js';
import {
  createRealityProbeCache,
  evaluateWriteGate,
  fileExists,
  type RealityProbeCache,
  runTouchHook,
  type TouchExecutors,
  type TouchInput,
  type WriteGateOutcome
} from './touch-core.js';

/**
 * Translate one resolved span into a fully-typed {@link TouchInput} per the
 * plan §2 table, or `null` when the path fails `resolveTouchScope` — cross-
 * repo, gitignored, and span-document paths fail closed.
 *
 * The post-state gate fields the span can determine (`targetState`, and
 * `postState` for appends and deletes) are set here; a literal overwrite body
 * (`span.written` — the flag-less `echo`/`printf` `>` case) rides as the
 * `exact` post-content expectation so the gate verifies the write's effect
 * while the touch itself stays whole-file (plan §3 step 1b). Truncates map
 * the span's statically evaluated absolute `-s N` to the `size` post-content
 * (`-s 0` → `empty`); a truncate without a size gates existence-only. The
 * driver pairs cp/install and mv sources onto the destination touches
 * afterward.
 */
export function bashSpanToTouch(span: ResolvedSpan, sessionId: string, cwd: string): TouchInput | null {
  if (!resolveTouchScope(cwd, span.absolutePath)) return null;
  switch (span.operation) {
    case 'read':
      return {
        kind: 'read',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit:
          span.lineStart !== undefined && span.lineEnd !== undefined ? span.lineEnd - span.lineStart + 1 : undefined
      };
    case 'create-overwrite':
    case 'rename-copy':
      // Whole-file writes: `written: ''` scopes the touch to every covering
      // span — truncating writes destroy anchors beyond the new EOF (the
      // main-200 F2 lesson). A literal body rides as the exact post-content
      // expectation so the gate verifies the write's effect.
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: '',
        targetState: 'exists',
        postState: span.written !== undefined ? { content: { exact: span.written } } : undefined
      };
    case 'truncate':
      // Same whole-file scope; the size gate (plan §2, §3 step 1b) verifies
      // the post-command byte count when the span carries a statically
      // evaluated absolute `-s N` (`-s 0` → empty); without one the gate is
      // existence-only.
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: '',
        targetState: 'exists',
        postState:
          span.size === 0
            ? { content: { empty: true } }
            : span.size !== undefined
              ? { content: { size: span.size } }
              : undefined
      };
    case 'append':
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: span.written ?? '',
        targetState: 'exists',
        postState: span.written !== undefined ? { content: { suffix: span.written } } : undefined
      };
    case 'modify':
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: '',
        targetState: 'exists',
        range: span.lineStart !== undefined ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : undefined
      };
    case 'delete':
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: '',
        targetState: 'absent',
        postState: { realDelete: true }
      };
  }
}

/**
 * Whether the Bash `tool_response` signals that the command was interrupted
 * (plan §4). The SDK types the response `unknown` on both adapters, so this
 * is a defensive runtime shape-probe: an object carrying a truthy
 * `interrupted` field classifies as interrupted; any other shape (string,
 * null, object without the field) proceeds fail-open, matching today's
 * behavior.
 */
export function bashResponseInterrupted(toolResponse: unknown): boolean {
  if (toolResponse !== null && typeof toolResponse === 'object') {
    return Boolean((toolResponse as Record<string, unknown>).interrupted);
  }
  return false;
}

/**
 * The Bash `tool_response`'s process exit code, when the harness supplies
 * one. The SDK types the response `unknown` on both adapters and Claude's
 * Bash envelopes do not currently carry an `exit_code` field, so this is a
 * defensive shape-probe with the plan §4 fail-open posture: present → the
 * integer code, absent or any other shape → undefined, and the caller
 * proceeds exactly as today. (The hook subprocess's own exit status — the
 * SDK's `SDKHookResponseMessage.exit_code` — is a different channel and is
 * never read here.)
 *
 * Granularity edge (documented residue): the code is the whole compound
 * command's, not one simple command's — a masked failure (`git apply
 * p.diff || echo ok` exiting 0) suppresses nothing, and a trailing failure
 * (`sed -i s/a/b/ f; false` exiting 1) suppresses the earlier real write.
 * And the "failed, so the write did not happen" premise behind the
 * suppression holds for atomic failures (`git apply` without `--reject`,
 * prettier on a syntax error) but over-suppresses the non-atomic writers
 * that modify before failing — GNU `patch` applying earlier hunks, `git
 * apply --reject` writing the applicable hunks plus `.rej` files, and
 * formatters (`eslint --fix`, `rubocop -a`) writing their fixes before
 * exiting nonzero on remaining violations. That wrote-but-nonzero corner is
 * accepted and pinned by the gate's tests rather than carved out.
 */
export function bashResponseExitCode(toolResponse: unknown): number | undefined {
  if (toolResponse !== null && typeof toolResponse === 'object') {
    const code = (toolResponse as Record<string, unknown>).exit_code;
    if (typeof code === 'number' && Number.isInteger(code)) return code;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The per-command verdict driver (plan §3 step 2)
// ---------------------------------------------------------------------------

type ResolvedMatch = Extract<SpanMatch, { status: 'resolved' }>;
type GuardMatch = Extract<SpanMatch, { status: 'builtin-guard' }>;

type Verdict = 'failed' | 'succeeded' | 'unknown';

/** One pass-A evaluation: the span, its touch, and the (post-resolution) gate outcome. */
interface SpanEval {
  match: ResolvedMatch;
  /** The translated touch, or `null` when the span failed `resolveTouchScope`. */
  touch: TouchInput | null;
  /** The pass-A gate outcome, post-resolution for `'pending'` and explained fails. */
  outcome: WriteGateOutcome;
  /** A decisiveFail downgraded by a later same-path decisivePass (plan §3 step 2). */
  explained: boolean;
  commandIndex: number;
  /** The span's own path — the explanation key for decisive fails. */
  path: string;
  /** cp destinations: the paired source path — the explanation key for pendings. */
  sourceKey: string | null;
}

/**
 * Evaluate one span's gate. Reads have no gate → `'inconclusive'`, with one
 * exception: cp/install source reads gate on the source existing post-command
 * (plan §2) — a failed copy never read anything. The read verdict flips only
 * the command's join verdict, never the same command's dest write.
 */
function evalSpanGate(match: ResolvedMatch, touch: TouchInput | null, probeCache: RealityProbeCache): WriteGateOutcome {
  if (touch === null) return 'inconclusive';
  if (touch.kind === 'read') {
    if ((match.idiom === 'cp-write' || match.idiom === 'install-write') && match.span.operation === 'read') {
      return fileExists(match.span.absolutePath) ? 'inconclusive' : 'decisiveFail';
    }
    return 'inconclusive';
  }
  return evaluateWriteGate(touch, probeCache);
}

/** The operator preceding a command, from its first span (all spans of one command share it) — or from its guard match when the command has no spans. */
function joinOfCommand(
  idx: number,
  groups: Map<number, ResolvedMatch[]>,
  guardByIndex: Map<number, GuardMatch>
): '&&' | '||' | undefined {
  const spans = groups.get(idx);
  if (spans !== undefined) {
    for (const m of spans) {
      if (m.span.join !== undefined) return m.span.join;
    }
    return undefined;
  }
  return guardByIndex.get(idx)?.join;
}

/**
 * Shared Bash driver (plan §3 step 2): owns the per-command verdict thread —
 * pass A `evaluateWriteGate` sweep (every span, before any join decision),
 * the explanation map, per-command verdicts, the join filter with chained
 * skips, and pass B per-surviving-span `runTouchHook` — plus the whole-command
 * `interrupted` and exit-code gates (plan §4) and the span-less-guard
 * commands (`false`/`true`/`:` join verdicts with no spans of their own).
 * Returns the non-null `additionalContext` blocks for the adapter to join;
 * the session memo dedups repeated targets.
 */
export async function runBashTouches(
  matches: SpanMatch[],
  sessionId: string,
  cwd: string,
  toolResponse: unknown,
  executors: TouchExecutors,
  memo: MemoStore,
  warn: (message: string) => void = console.warn
): Promise<string[]> {
  // A command that did not complete produces no touches, whatever its spans.
  if (bashResponseInterrupted(toolResponse)) return [];
  const exitCode = bashResponseExitCode(toolResponse);
  const resolved = matches.filter((m): m is ResolvedMatch => m.status === 'resolved');
  const guards = matches.filter((m): m is GuardMatch => m.status === 'builtin-guard');
  if (resolved.length === 0) return [];

  // Seed the per-command probe cache (plan §3 step 1c) with every absent
  // target and cp/install source of the compound; the first gate that needs
  // it runs one ls-files + one span-list batch for all of them.
  const probePaths: string[] = [];
  for (const m of resolved) {
    if (m.span.operation === 'delete') probePaths.push(m.span.absolutePath);
    else if ((m.idiom === 'cp-write' || m.idiom === 'install-write') && m.span.operation === 'read') {
      probePaths.push(m.span.absolutePath);
    }
  }
  const probeCache = createRealityProbeCache(probePaths);

  // Group by simple command in walker order. Span-less guard commands
  // (`false`/`true`/`:`) join the order with no group: their deterministic
  // exit status drives the join filter, and they never touch anything.
  const groups = new Map<number, ResolvedMatch[]>();
  const guardByIndex = new Map<number, GuardMatch>();
  const commandOrder: number[] = [];
  for (const m of resolved) {
    const idx = m.span.simpleCommandIndex;
    const list = groups.get(idx);
    if (list !== undefined) {
      list.push(m);
    } else {
      groups.set(idx, [m]);
      commandOrder.push(idx);
    }
  }
  for (const g of guards) {
    if (groups.has(g.simpleCommandIndex) || guardByIndex.has(g.simpleCommandIndex)) continue;
    guardByIndex.set(g.simpleCommandIndex, g);
    commandOrder.push(g.simpleCommandIndex);
  }
  commandOrder.sort((a, b) => a - b);

  // Pass A: translate every span once and evaluate its gate, pairing
  // cp/install sources with destinations and mv deletes with rename-copies by
  // declaration order (the parser emits sources before destinations).
  const evals = new Map<number, SpanEval[]>();
  for (const idx of commandOrder) {
    const spans = groups.get(idx);
    if (spans === undefined) continue; // guard-only command — nothing to evaluate
    const readPaths = spans
      .filter((m) => (m.idiom === 'cp-write' || m.idiom === 'install-write') && m.span.operation === 'read')
      .map((m) => m.span.absolutePath);
    const deletePaths = spans.filter((m) => m.span.operation === 'delete').map((m) => m.span.absolutePath);
    let readCursor = 0;
    let deleteCursor = 0;
    const list: SpanEval[] = [];
    for (const m of spans) {
      const touch = bashSpanToTouch(m.span, sessionId, cwd);
      const entry: SpanEval = {
        match: m,
        touch,
        outcome: 'inconclusive',
        explained: false,
        commandIndex: idx,
        path: m.span.absolutePath,
        sourceKey: null
      };
      if (touch !== null && touch.kind === 'write') {
        if (m.span.operation === 'create-overwrite' && (m.idiom === 'cp-write' || m.idiom === 'install-write')) {
          const source = readPaths[readCursor];
          if (source !== undefined) {
            readCursor += 1;
            // `install -s`/`--strip` is deliberately never paired: stripped
            // output never equals the source, so install dests gate
            // existence-only (plan §3 step 1b).
            if (m.idiom === 'cp-write') {
              touch.sourcePath = source;
              entry.sourceKey = source;
            }
          }
        } else if (m.span.operation === 'rename-copy') {
          const source = deletePaths[deleteCursor];
          if (source !== undefined) {
            deleteCursor += 1;
            touch.renameSourcePath = source;
          }
        }
      }
      entry.outcome = evalSpanGate(m, touch, probeCache);
      list.push(entry);
    }
    evals.set(idx, list);
  }

  // The explanation map (plan §3 step 2): the highest simpleCommandIndex with
  // a decisivePass on each path.
  const passByPath = new Map<string, number>();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === undefined) continue;
    for (const e of list) {
      if (e.outcome === 'decisivePass') {
        const prev = passByPath.get(e.path);
        if (prev === undefined || idx > prev) passByPath.set(e.path, idx);
      }
    }
  }

  // Resolve the absent-source holds against the now-complete map, and
  // downgrade explained fails: a decisiveFail on a path a later command
  // demonstrably rewrote or deleted is the overwrite, not the earlier command
  // failing (plan §3 step 2).
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === undefined) continue;
    for (const e of list) {
      if (e.outcome === 'pending') {
        const passIdx = e.sourceKey !== null ? passByPath.get(e.sourceKey) : undefined;
        e.outcome = passIdx !== undefined && passIdx > e.commandIndex ? 'decisivePass' : 'decisiveFail';
      } else if (e.outcome === 'decisiveFail') {
        const passIdx = passByPath.get(e.path);
        if (passIdx !== undefined && passIdx > e.commandIndex) e.explained = true;
      }
    }
  }

  // Per-command verdicts: 'failed' on any unexplained decisiveFail, else
  // 'succeeded' on at least one decisive outcome, else 'unknown'. A
  // guard-only command's deterministic exit status IS its verdict (plan §3
  // step 2's span-less-guard rule).
  const computed = new Map<number, Verdict>();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === undefined) {
      const guard = guardByIndex.get(idx);
      computed.set(idx, guard !== undefined ? (guard.exitStatus === 0 ? 'succeeded' : 'failed') : 'unknown');
      continue;
    }
    let failed = false;
    let passed = false;
    for (const e of list) {
      if (e.outcome === 'decisiveFail' && !e.explained) failed = true;
      if (e.outcome === 'decisivePass') passed = true;
    }
    computed.set(idx, failed ? 'failed' : passed ? 'succeeded' : 'unknown');
  }

  // The join filter (plan §3 step 2): a skipped command's chained verdict is
  // the guard that skipped it — 'failed' after an &&-skip, 'succeeded' after
  // an ||-skip — matching the shell short-circuit (a || b || c stops after
  // the first success). 'unknown' fails open.
  const effective = new Map<number, Verdict>();
  const skipped = new Set<number>();
  let prevIndex: number | null = null;
  for (const idx of commandOrder) {
    const join = joinOfCommand(idx, groups, guardByIndex);
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : undefined;
    if (prevVerdict !== undefined && join !== undefined) {
      if ((join === '&&' && prevVerdict === 'failed') || (join === '||' && prevVerdict === 'succeeded')) {
        effective.set(idx, join === '&&' ? 'failed' : 'succeeded');
        skipped.add(idx);
        prevIndex = idx;
        continue;
      }
    }
    effective.set(idx, computed.get(idx)!);
    prevIndex = idx;
  }

  // Pass B: run the touch hook for surviving spans only — decisivePass, or
  // inconclusive with an 'exists' target (the advisory residual class:
  // existence-gated families fire and heal/surface; phantom deletes never
  // fire). A harness-supplied non-zero exit code suppresses the advisory
  // class too, bounded by two documented-residue faces (see
  // bashResponseExitCode): the code is the compound's, so a masked failure
  // (`git apply p.diff || echo ok` exiting 0) suppresses nothing and a
  // trailing failure (`sed -i s/a/b/ f; false`) suppresses an earlier real
  // write — and a nonzero code does not prove the write did not happen for
  // the non-atomic writers that modify before failing (patch applying
  // earlier hunks, `git apply --reject`, formatters writing fixes then
  // exiting nonzero). A zero or absent code proceeds, and content-verified
  // decisive passes fire regardless (fail-open, plan §4). Guard-only
  // commands have no touches. Explained fails and decisive fails never
  // reach an executor.
  const blocks: string[] = [];
  for (const idx of commandOrder) {
    if (skipped.has(idx)) continue;
    const list = evals.get(idx);
    if (list === undefined) continue;
    let touches = 0;
    for (const e of list) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === 'decisiveFail') continue;
      if (e.outcome === 'inconclusive' && e.touch.kind === 'write' && e.touch.targetState === 'absent') continue;
      if (e.outcome === 'inconclusive' && e.touch.kind === 'write' && exitCode !== undefined && exitCode !== 0)
        continue;
      if (touches >= 32) {
        // Hard per-command volume cap (plan §3 step 2): drop the surplus with
        // a warning rather than blow the hook timeout on a 50-copy chain.
        warn(`Bash touch cap (32) reached for simple command ${idx}; dropping the remaining touches`);
        break;
      }
      touches += 1;
      const output = await runTouchHook(e.touch, executors, memo, probeCache);
      if (output.additionalContext) blocks.push(output.additionalContext);
    }
  }
  return blocks;
}
