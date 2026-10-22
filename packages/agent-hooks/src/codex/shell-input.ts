/** Recover literal shell invocations without evaluating code-mode JavaScript. */
import { type Node, parse } from 'acorn';
import { isRecord } from '../common/guards.js';
import { extractShellCommand } from './shell-command.js';

export interface ShellExecution {
  readonly command: string;
  readonly workdir: string | null;
  readonly background: boolean;
}

export interface ShellExecutions {
  readonly matched: boolean;
  readonly executions: readonly ShellExecution[];
}

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_EXECUTIONS = 32;
const MAX_AST_NODES = 50_000;

function execution(input: Record<string, unknown>): ShellExecution | null {
  const command = typeof input.cmd === 'string' ? input.cmd : extractShellCommand(input);
  if (!command || command.includes('\0')) return null;
  if (input.environment_id !== undefined && input.environment_id !== null) return null;
  const workdir = input.workdir ?? input.cwd;
  if (workdir !== undefined && workdir !== null && (typeof workdir !== 'string' || workdir.includes('\0'))) return null;
  return {
    command,
    workdir: typeof workdir === 'string' ? workdir : null,
    background: ['run_in_background', 'background', 'delegate', 'delegated', 'worker'].some(
      (key) => input[key] === true
    )
  };
}

function argumentsObject(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  if (typeof input.arguments !== 'string') return input;
  if (Buffer.byteLength(input.arguments) > MAX_SOURCE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(input.arguments);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Decode direct or JSON-wrapped exec_command inputs, including the effective workdir. */
export function narrowExecCommand(toolInput: unknown): { cmd: string; workdir: string | null } | null {
  const args = argumentsObject(toolInput);
  const result = args === null ? null : execution(args);
  return result === null ? null : { cmd: result.command, workdir: result.workdir };
}

function literal(node: unknown): unknown {
  if (!isRecord(node)) return undefined;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0) {
    const first = Array.isArray(node.quasis) ? node.quasis[0] : null;
    return isRecord(first) && isRecord(first.value) ? first.value.cooked : undefined;
  }
  return undefined;
}

function literalArguments(node: unknown): Record<string, unknown> | null {
  if (!isRecord(node) || node.type !== 'ObjectExpression' || !Array.isArray(node.properties)) return null;
  const result: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (!isRecord(property) || property.type !== 'Property' || property.computed || property.method) return null;
    const key = property.key;
    const name = isRecord(key) && key.type === 'Identifier' ? key.name : literal(key);
    if (typeof name !== 'string') return null;
    if (
      [
        'cmd',
        'workdir',
        'cwd',
        'environment_id',
        'run_in_background',
        'background',
        'delegate',
        'delegated',
        'worker'
      ].includes(name)
    ) {
      if (Object.hasOwn(result, name)) return null;
      const value = literal(property.value);
      if (value === undefined) return null;
      result[name] = value;
    }
  }
  return result;
}

/** Collect every literal tools.exec_command call; a dynamic call invalidates the complete envelope. */
export function narrowCodeModeExecutions(
  toolInput: unknown,
  options: { readonly directToolsOnly?: boolean } = {}
): ShellExecutions {
  if (!isRecord(toolInput) || typeof toolInput.input !== 'string') return { matched: false, executions: [] };
  const source = toolInput.input;
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) return { matched: true, executions: [] };
  let ast: Node;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  } catch {
    return { matched: /\bexec_command\b/.test(source), executions: [] };
  }
  let nodes = 0;
  let matched = false;
  let invalid = false;
  const executions: ShellExecution[] = [];
  const directToolObjects = new Set<unknown>();
  const pending: unknown[] = [ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!isRecord(node) || typeof node.type !== 'string') continue;
    if (++nodes > MAX_AST_NODES) return { matched: true, executions: [] };
    if (options.directToolsOnly && node.type === 'Identifier' && node.name === 'tools' && !directToolObjects.has(node))
      invalid = true;
    if (node.type === 'CallExpression' && isRecord(node.callee)) {
      const callee = node.callee;
      if (
        callee.type === 'MemberExpression' &&
        isRecord(callee.object) &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'tools' &&
        isRecord(callee.property) &&
        typeof (callee.computed ? literal(callee.property) : callee.property.name) === 'string'
      ) {
        directToolObjects.add(callee.object);
        if ((callee.computed ? literal(callee.property) : callee.property.name) === 'exec_command') {
          matched = true;
          const args =
            Array.isArray(node.arguments) && node.arguments.length === 1 ? literalArguments(node.arguments[0]) : null;
          const result =
            args === null || (options.directToolsOnly && Object.hasOwn(args, 'cwd')) ? null : execution(args);
          if (result === null || executions.length >= MAX_EXECUTIONS) invalid = true;
          else executions.push(result);
        }
      }
    }
    // Reverse children so execution contexts remain in source order.
    const children = Object.values(node).flatMap((value) => (Array.isArray(value) ? value : [value]));
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
  return { matched, executions: invalid ? [] : executions };
}

/** Single-command narrowing refuses multiple calls instead of silently choosing the first. */
export function narrowCodeModeExec(toolInput: unknown): {
  matched: boolean;
  cmd: string | null;
  workdir: string | null;
} {
  const result = narrowCodeModeExecutions(toolInput);
  const only = result.executions.length === 1 ? result.executions[0] : undefined;
  return { matched: result.matched, cmd: only?.command ?? null, workdir: only?.workdir ?? null };
}

/** Shared pre/post normalization handles direct, wrapped and code-mode host envelopes. */
export function narrowShellExecutions(toolInput: unknown): ShellExecutions {
  const args = argumentsObject(toolInput);
  const direct = args === null ? null : execution(args);
  if (direct !== null) return { matched: true, executions: [direct] };
  return narrowCodeModeExecutions(toolInput);
}
