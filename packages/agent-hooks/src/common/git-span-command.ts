/** Select the PATH CLI directly, before Git can prepend its private exec path. */

import { dirname, resolve } from 'node:path';
import { executableOnPath } from './commit-native-io.js';

export interface GitSpanCommand {
  executable: string;
  argv: string[];
}

/** Resolve for each invocation so a long-lived hook observes PATH changes. */
export function resolveGitSpanCommand(
  argv: readonly string[],
  cwd = process.cwd(),
  gitExecutable = 'git',
  platform: NodeJS.Platform = process.platform
): GitSpanCommand {
  if (platform === 'win32') {
    const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    for (const directory of (process.env.PATH ?? '').split(';')) {
      for (const extension of extensions) {
        const candidate = resolve(cwd, directory, `git-span${extension.toLowerCase()}`);
        try {
          const executable = executableOnPath(candidate, cwd);
          if (extension.toLowerCase() === '.exe' || extension.toLowerCase() === '.com')
            return { executable, argv: [...argv] };
          // Git already supports Windows package-manager shims. Pin its exec
          // directory to the selected PATH entry to preserve that selection
          // without handing source addresses to a command shell ourselves.
          return { executable: gitExecutable, argv: [`--exec-path=${dirname(candidate)}`, 'span', ...argv] };
        } catch {}
      }
    }
    return { executable: gitExecutable, argv: ['span', ...argv] };
  }
  try {
    return {
      executable: executableOnPath('git-span', cwd),
      argv: [...argv]
    };
  } catch {
    // Git can still provide a subcommand installed solely in its exec path.
    return { executable: gitExecutable, argv: ['span', ...argv] };
  }
}
