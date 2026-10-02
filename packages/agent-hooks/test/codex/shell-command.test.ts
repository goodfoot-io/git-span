import { describe, expect, it } from 'vitest';
import { extractShellCommand } from '../../src/codex/shell-command.js';

describe('extractShellCommand', () => {
  it('returns a bare command string as-is', () => {
    expect(extractShellCommand({ command: 'git commit -m "wip"' })).toBe('git commit -m "wip"');
  });
  it('extracts the script from a `bash -lc <script>` argv', () => {
    expect(extractShellCommand({ command: ['bash', '-lc', 'git push'] })).toBe('git push');
  });
  it('space-joins a direct argv', () => {
    expect(extractShellCommand({ command: ['git', 'commit', '-m', 'wip'] })).toBe('git commit -m wip');
  });
  it('returns null when no command text is recoverable', () => {
    expect(extractShellCommand({})).toBeNull();
    expect(extractShellCommand(null)).toBeNull();
    expect(extractShellCommand({ command: '' })).toBeNull();
  });
});
