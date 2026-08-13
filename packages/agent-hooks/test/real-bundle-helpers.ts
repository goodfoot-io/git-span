import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_HOOKS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_ROOT = resolve(AGENT_HOOKS_ROOT, '../..');

export interface BuiltRealHookBundles {
  readonly root: string;
  readonly claudeHooksDir: string;
  readonly codexHooksDir: string;
  cleanup(): void;
}

/** Build the complete emitted Claude and Codex plugin hook trees in scratch space. */
export function buildRealHookBundles(): BuiltRealHookBundles {
  const root = mkdtempSync(join(tmpdir(), 'agent-hooks-real-bundles-'));
  const claudeRoot = join(root, 'claude');
  const codexRoot = join(root, 'codex');
  mkdirSync(claudeRoot);
  mkdirSync(codexRoot);
  try {
    execFileSync(
      'yarn',
      [
        'claude-code-hooks',
        '-i',
        'src/claude/{advisor,static-plan,post-tool-use,post-tool-use-failure,session-end}.ts',
        '-o',
        join(claudeRoot, 'hooks.json'),
        '--no-sourcemap'
      ],
      { cwd: AGENT_HOOKS_ROOT, stdio: 'pipe' }
    );
    execFileSync(
      'yarn',
      [
        'codex-hooks',
        '-i',
        'src/codex/{advisor,static-plan,apply-patch-plan,post-tool-use,stop}.ts',
        '-o',
        join(codexRoot, 'hooks.json'),
        '--plugin-root',
        '--no-sourcemap'
      ],
      { cwd: AGENT_HOOKS_ROOT, stdio: 'pipe' }
    );
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    claudeHooksDir: join(claudeRoot, 'bin'),
    codexHooksDir: codexRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

/** Build and return the workspace Rust binary that installed-artifact tests must put first on PATH. */
export function buildWorkspaceGitSpan(): { binary: string; pathDir: string } {
  const targetRoot = process.env['GIT_SPAN_CARGO_TARGET_ROOT'] ?? '/var/cache/git-span/cargo-target';
  const targetDir = join(targetRoot, 'git-span', 'build');
  const packageRoot = join(WORKSPACE_ROOT, 'packages', 'git-span');
  execFileSync(
    'bash',
    [
      'scripts/with-target-lock.sh',
      'shared',
      'env',
      `CARGO_TARGET_DIR=${targetDir}`,
      'cargo',
      'build',
      '--quiet',
      '--locked',
      '--bin',
      'git-span'
    ],
    { cwd: packageRoot, stdio: 'pipe' }
  );
  const pathDir = join(targetDir, 'debug');
  const binary = join(pathDir, process.platform === 'win32' ? 'git-span.exe' : 'git-span');
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  if (!version.startsWith('git-span ')) throw new Error(`workspace git-span emitted an invalid version: ${version}`);
  return { binary, pathDir };
}

export interface RealBundleRepo {
  readonly root: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  cleanup(): void;
}

/** Create an isolated real repository and HOME for emitted-hook subprocesses. */
export function makeRealBundleRepo(pathDir: string): RealBundleRepo {
  const parent = mkdtempSync(join(tmpdir(), 'agent-hooks-installed-smoke-'));
  const root = join(parent, 'repo');
  const home = join(parent, 'home');
  mkdirSync(root);
  mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${pathDir}:${process.env['PATH'] ?? ''}`,
    GIT_AUTHOR_NAME: 'installed smoke',
    GIT_AUTHOR_EMAIL: 'installed-smoke@example.com',
    GIT_COMMITTER_NAME: 'installed smoke',
    GIT_COMMITTER_EMAIL: 'installed-smoke@example.com'
  };
  execFileSync('git', ['init', '-q'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'installed smoke'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'installed-smoke@example.com'], { cwd: root, env, stdio: 'pipe' });
  return { root, home, env, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

export function writeRepoFile(repo: RealBundleRepo, path: string, content: string, executable = false): void {
  const absolute = join(repo.root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  if (executable) chmodSync(absolute, 0o755);
}

export function commitRepo(repo: RealBundleRepo, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: repo.root, env: repo.env, stdio: 'pipe' });
  execFileSync('git', ['commit', '-qm', message], { cwd: repo.root, env: repo.env, stdio: 'pipe' });
}

export function addLineSpan(
  repo: RealBundleRepo,
  name: string,
  path: string,
  start: number,
  end: number,
  why = `installed smoke ${name}`
): void {
  execFileSync('git', ['span', 'add', name, `${path}#L${start}-L${end}`], {
    cwd: repo.root,
    env: repo.env,
    stdio: 'pipe'
  });
  execFileSync('git', ['span', 'why', name, why], { cwd: repo.root, env: repo.env, stdio: 'pipe' });
}

export interface HookProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly output: Record<string, unknown> | null;
}

/** Invoke one emitted one-shot hook through its real JSON stdin protocol. */
export function invokeRealHook(
  hookPath: string,
  envelope: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): HookProcessResult {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env,
    timeout: 20_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${hookPath} exited ${String(result.status)}: ${result.stderr}`);
  }
  const stdout = result.stdout.trim();
  return {
    stdout,
    stderr: result.stderr,
    output: stdout.length === 0 ? null : (JSON.parse(stdout) as Record<string, unknown>)
  };
}

export function runRealShell(
  repo: RealBundleRepo,
  command: string
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('bash', ['-c', command], {
    cwd: repo.root,
    env: repo.env,
    encoding: 'utf8',
    timeout: 20_000
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? -1 };
}

/** Extract context from either emitted hook runtime's JSON output. */
export function hookContext(output: Record<string, unknown> | null): string {
  if (output === null) return '';
  const specific = output['hookSpecificOutput'];
  if (specific !== null && typeof specific === 'object') {
    const additional = (specific as Record<string, unknown>)['additionalContext'];
    if (typeof additional === 'string') return additional;
  }
  const additional = output['additionalContext'];
  if (typeof additional === 'string') return additional;
  const system = output['systemMessage'];
  return typeof system === 'string' ? system : '';
}

export function emittedBundleNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
}

export function readEmittedBundle(dir: string, name: string): string {
  return readFileSync(join(dir, name), 'utf8');
}
