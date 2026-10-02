/**
 * Narrow Codex's `unknown` shell `tool_input` into the command string the core
 * parses. Handles a bare `command` string, a shell-wrapper argv
 * (`["bash","-lc","<script>"]` → the script after `-c`/`-lc`), and a direct argv
 * (`["git","commit",…]` → space-joined). Returns `null` when no command text is
 * recoverable.
 */
export function extractShellCommand(toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== 'object' || !('command' in toolInput)) return null;
  const command = (toolInput as { command: unknown }).command;
  if (typeof command === 'string') return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p): p is string => typeof p === 'string');
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === '-c' || p === '-lc' || p === '-ic');
    if (flagIdx >= 0 && parts[flagIdx + 1] !== undefined) return parts[flagIdx + 1];
    return parts.join(' ');
  }
  return null;
}
