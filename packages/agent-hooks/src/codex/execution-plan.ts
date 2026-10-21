/** Capture Codex's hidden execution directory inside the original shell before it runs. */
import { Logger } from '@goodfoot/agent-hooks';
import { createSessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import { type CommitRuntimeOptions, enrollCommitInvocation } from '../common/commit-runtime.js';
import { isRecord } from '../common/guards.js';

export const EXECUTION_PLAN_FLAG = '--execution-plan';
const MAX_ENCODED_BYTES = 16_384;
const COMMAND_PREFIX = "node -e '/*git-span-execution-plan*/";

export interface ExecutionPlan {
  readonly version: 1;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly transcriptLocator?: string;
  readonly toolInput: Readonly<Record<string, unknown>> & { readonly command: string };
  readonly layoutBase: string;
  readonly options: Pick<CommitRuntimeOptions, 'stateRoot' | 'notesExecutable' | 'lockExecutable'>;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

/** Reject malformed or oversized command-carried plans without evaluating their contents. */
export function decodeExecutionPlan(encoded: string): ExecutionPlan | null {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    return null;
  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) return null;
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !nonempty(value.sessionId) ||
      !nonempty(value.toolUseId) ||
      !nonempty(value.layoutBase) ||
      (value.transcriptLocator !== undefined && !nonempty(value.transcriptLocator)) ||
      !isRecord(value.toolInput) ||
      !nonempty(value.toolInput.command) ||
      !isRecord(value.options) ||
      Object.entries(value.options).some(
        ([key, item]) => !['stateRoot', 'notesExecutable', 'lockExecutable'].includes(key) || !nonempty(item)
      )
    )
      return null;
    return value as unknown as ExecutionPlan;
  } catch {
    return null;
  }
}

/** Identify our exact shell prelude so a missing receipt cannot attribute it against the session cwd. */
export function isExecutionPlanCommand(command: string): boolean {
  return command.startsWith(COMMAND_PREFIX);
}

/** Build a bounded, shell-quoted launch; the user's command stays in its original shell. */
export function executionPlanCommand(plan: ExecutionPlan, bundleUrl: string): string | null {
  const encoded = Buffer.from(JSON.stringify(plan)).toString('base64');
  if (decodeExecutionPlan(encoded) === null || isExecutionPlanCommand(plan.toolInput.command)) return null;
  const module = Buffer.from(bundleUrl).toString('base64');
  // Base64 and backtick literals avoid shell interpolation and PowerShell's legacy double-quote stripping.
  // The helper never reads stdin, emits tool output, or replaces the shell executing the original command.
  const script =
    `process.argv[2]=\`${EXECUTION_PLAN_FLAG}\`;process.argv[3]=\`${encoded}\`;` +
    `import(Buffer.from(\`${module}\`,\`base64\`).toString()).catch(()=>process.exit(0))`;
  return `${COMMAND_PREFIX}${script}'\n${plan.toolInput.command}`;
}

/** Run before the original command in its actual directory; failures only disable attribution. */
export async function runExecutionPlan(encoded: string): Promise<void> {
  const logger = new Logger({ logEnvVar: 'AGENT_HOOKS_LOG_FILE' });
  try {
    const plan = decodeExecutionPlan(encoded);
    if (plan === null) throw new Error('invalid or oversized execution plan');
    const cwd = process.cwd();
    const layout = createSessionLayout(plan.layoutBase);
    planBashTouches(
      plan.toolInput.command,
      cwd,
      plan.sessionId,
      plan.toolUseId,
      logger,
      createDefaultPlannedTouchStore(layout)
    );
    const result = await enrollCommitInvocation(
      {
        host: 'codex',
        sessionId: plan.sessionId,
        toolUseId: plan.toolUseId,
        cwd,
        toolInput: plan.toolInput,
        command: plan.toolInput.command,
        ...(plan.transcriptLocator ? { transcriptLocator: plan.transcriptLocator } : {})
      },
      plan.options,
      logger
    );
    if (result.kind !== 'enrolled')
      logger.warn('git-span execution-directory enrollment unavailable', { reason: result.reason });
  } catch (err) {
    logger.warn('git-span execution-directory planning failed closed for attribution', { err });
  } finally {
    logger.close();
  }
}
