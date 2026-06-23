/**
 * Fork-dispatch: hand the assembled mesh-review work to a forked, headless
 * `claude` instead of blocking the stop and asking the live agent to act.
 *
 * The Stop hook calls {@link ForkDispatcher} with the session id, repo root, and
 * a self-contained prompt. The default dispatcher resolves the very `claude`
 * executable that launched this hook — by walking up the process chain to the
 * first non-shell ancestor — and spawns it detached as:
 *
 *   <claude> -p --resume <session_id> --fork-session "<prompt>"
 *
 * Nothing else is passed. `--resume … --fork-session` makes the child a
 * configuration-identical copy of the parent (same model, system prompt, tool
 * set, permission mode, project settings), so the parent's prompt-cache prefix
 * is reused on the fork's first request. Adding `--model`, `--agent`,
 * `--permission-mode`, `--allowedTools`, or `--system-prompt` would diverge that
 * prefix and defeat the point, so we never do.
 *
 * Resolving the executable from the process chain — rather than an env var or a
 * bare PATH guess — pins the fork to the same binary that is already running.
 * On this platform `/proc/<pid>/exe` can read `… (deleted)` (the installer swaps
 * the binary out from under a running process), so resolution falls back through
 * the process's argv and finally a PATH lookup.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForkDispatchParams {
  /** The parent session to fork (`--resume <sessionId> --fork-session`). */
  sessionId: string;
  /** Working directory for the child — the session's project dir (`--resume`
   * lookup is scoped to it) and part of "same configuration". */
  repoRoot: string;
  /** The self-contained `-p` prompt (new turn appended after the cached prefix). */
  prompt: string;
}

/**
 * Dispatch the mesh review to a forked `claude`. Throws on failure (the Stop
 * hook logs and proceeds, fail-closed — no dispatch rather than a wrong one).
 */
export type ForkDispatcher = (params: ForkDispatchParams) => void;

export interface ResolvedExecutable {
  /** The binary to spawn — a standalone `claude`, or the `node` that runs it. */
  command: string;
  /** Args that must precede our flags. Empty for a standalone binary; the
   * `cli.js` entry script when {@link command} is `node`. */
  baseArgs: string[];
}

/**
 * Reads the slices of `/proc` the resolver needs. Injectable so the chain walk
 * is unit-testable against a simulated process tree — no real `/proc`, no spawn.
 */
export interface ProcReader {
  /** Parent pid from `/proc/<pid>/status` (`PPid:`), or null. */
  ppidOf(pid: number): number | null;
  /** Process name from `/proc/<pid>/comm` (basename, ≤15 chars), or null. */
  commOf(pid: number): string | null;
  /** `readlink(/proc/<pid>/exe)` — may end in `" (deleted)"` — or null. */
  exeOf(pid: number): string | null;
  /** argv from `/proc/<pid>/cmdline` (NUL-separated), or null. */
  cmdlineOf(pid: number): string[] | null;
  /** `PATH` from `/proc/<pid>/environ`, or null. */
  pathEnvOf(pid: number): string | null;
  /** Whether a path exists on disk. */
  exists(path: string): boolean;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Shells skipped while walking up to the launching `claude`. */
const SHELL_NAMES: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ash',
  'ksh',
  'csh',
  'tcsh',
  'fish',
  'busybox'
]);

/** Process names that mean "a Node runtime running a script" (the `node <cli.js>`
 * shape), where the claude entry point is argv[1] rather than the binary. */
const NODE_NAMES: ReadonlySet<string> = new Set(['node', 'nodejs']);

const DELETED_SUFFIX = ' (deleted)';
const MAX_WALK_DEPTH = 20;

function stripDeleted(p: string): string {
  return p.endsWith(DELETED_SUFFIX) ? p.slice(0, -DELETED_SUFFIX.length) : p;
}

function basename(p: string): string {
  return nodePath.posix.basename(p.replace(/\\/g, '/'));
}

function isNodeName(p: string): boolean {
  return NODE_NAMES.has(basename(p).toLowerCase());
}

/** Resolve a bare command name against a PATH string; first existing hit wins. */
function whichOn(name: string, pathEnv: string | null, exists: (p: string) => boolean): string | null {
  if (!pathEnv) return null;
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue;
    const candidate = `${dir}/${name}`;
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Sanity gate: a resolved invocation must plausibly be claude — either the
 * binary's basename mentions `claude`, or (the `node <cli.js>` shape) the entry
 * script looks like a claude/cli entry point. Keeps an unexpected non-shell
 * ancestor from being mistaken for the launcher.
 */
function looksLikeClaude(r: ResolvedExecutable): boolean {
  if (basename(r.command).toLowerCase().includes('claude')) return true;
  const entry = r.baseArgs[0];
  if (!entry) return false;
  const e = basename(entry).toLowerCase();
  return e.includes('claude') || e.includes('cli');
}

/** Resolve how to run the claude living at `pid`, or null if it cannot be pinned. */
function resolveFromProcess(pid: number, reader: ProcReader): ResolvedExecutable | null {
  const argv = reader.cmdlineOf(pid) ?? [];
  const argv0 = argv[0];
  const argv1 = argv[1];

  const accept = (cand: ResolvedExecutable | null): ResolvedExecutable | null =>
    cand && looksLikeClaude(cand) ? cand : null;

  // 1) /proc/<pid>/exe — the most precise handle when it points at a live file.
  const rawExe = reader.exeOf(pid);
  if (rawExe) {
    const exe = stripDeleted(rawExe);
    if (reader.exists(exe)) {
      if (isNodeName(exe)) {
        if (argv1) {
          const cand = accept({ command: exe, baseArgs: [argv1] });
          if (cand) return cand;
        }
      } else {
        const cand = accept({ command: exe, baseArgs: [] });
        if (cand) return cand;
      }
    }
  }

  // 2) argv[0] — the install path even when /proc/<pid>/exe is "(deleted)".
  if (argv0) {
    if (isNodeName(argv0) && argv1) {
      const node =
        nodePath.isAbsolute(argv0) && reader.exists(argv0)
          ? argv0
          : whichOn(basename(argv0), reader.pathEnvOf(pid), reader.exists);
      if (node) {
        const cand = accept({ command: node, baseArgs: [argv1] });
        if (cand) return cand;
      }
    } else if (nodePath.isAbsolute(argv0) && reader.exists(argv0)) {
      const cand = accept({ command: argv0, baseArgs: [] });
      if (cand) return cand;
    } else {
      const onPath = whichOn(basename(argv0), reader.pathEnvOf(pid), reader.exists);
      if (onPath) {
        const cand = accept({ command: onPath, baseArgs: [] });
        if (cand) return cand;
      }
    }
  }

  // 3) Last resort: `claude` on this process's PATH.
  const onPath = whichOn('claude', reader.pathEnvOf(pid), reader.exists);
  if (onPath) return { command: onPath, baseArgs: [] };

  return null;
}

/**
 * Walk up from `startPid` to the first non-shell ancestor — the launching
 * `claude` — and resolve how to run it. A non-shell ancestor that cannot be
 * pinned to a claude-like binary is stepped over in case an outer ancestor is
 * the real one. Returns null when none can be resolved.
 */
export function resolveClaudeExecutable(
  startPid: number,
  reader: ProcReader,
  maxDepth: number = MAX_WALK_DEPTH
): ResolvedExecutable | null {
  let pid: number | null = startPid;
  for (let depth = 0; depth < maxDepth && pid !== null && pid > 1; depth++) {
    const comm = reader.commOf(pid);
    if (comm && !SHELL_NAMES.has(comm)) {
      const resolved = resolveFromProcess(pid, reader);
      if (resolved) return resolved;
    }
    pid = reader.ppidOf(pid);
  }
  return null;
}

/** Build the spawn command + argv for the configuration-identical fork. */
export function buildForkInvocation(
  resolved: ResolvedExecutable,
  sessionId: string,
  prompt: string
): { command: string; args: string[] } {
  return {
    command: resolved.command,
    args: [...resolved.baseArgs, '-p', '--resume', sessionId, '--fork-session', prompt]
  };
}

// ---------------------------------------------------------------------------
// Default /proc reader
// ---------------------------------------------------------------------------

export function createProcReader(): ProcReader {
  return {
    ppidOf(pid) {
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const m = status.match(/^PPid:\s*(\d+)/m);
        return m ? parseInt(m[1], 10) : null;
      } catch {
        return null;
      }
    },
    commOf(pid) {
      try {
        const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        return comm.length > 0 ? comm : null;
      } catch {
        return null;
      }
    },
    exeOf(pid) {
      try {
        return fs.readlinkSync(`/proc/${pid}/exe`);
      } catch {
        return null;
      }
    },
    cmdlineOf(pid) {
      try {
        const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const parts = raw.split('\0').filter((s) => s.length > 0);
        return parts.length > 0 ? parts : null;
      } catch {
        return null;
      }
    },
    pathEnvOf(pid) {
      try {
        const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        for (const kv of raw.split('\0')) {
          if (kv.startsWith('PATH=')) return kv.slice('PATH='.length);
        }
        return null;
      } catch {
        return null;
      }
    },
    exists(p) {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Default dispatcher
// ---------------------------------------------------------------------------

/**
 * Build the production dispatcher: resolve the launching `claude` from the
 * process chain and spawn it detached, fire-and-forget. The reader and start pid
 * are injectable for tests; production uses the real `/proc` reader rooted at
 * the hook's parent.
 */
export function createDefaultForkDispatcher(
  reader: ProcReader = createProcReader(),
  startPid: number = process.ppid
): ForkDispatcher {
  return ({ sessionId, repoRoot, prompt }) => {
    const resolved = resolveClaudeExecutable(startPid, reader);
    if (!resolved) {
      throw new Error('could not resolve the claude executable from the process chain');
    }
    const { command, args } = buildForkInvocation(resolved, sessionId, prompt);
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      detached: true,
      stdio: 'ignore'
    });
    // The hook exits immediately after this; swallow a late spawn 'error' event
    // so it cannot crash the (already-returned) process, and unref so the fork
    // outlives us.
    child.on('error', () => {});
    child.unref();
  };
}
