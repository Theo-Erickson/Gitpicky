import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface RunGitOptions {
  /** Text piped to git's stdin. */
  input?: string;
  /** Milliseconds before the git process is killed. */
  timeoutMs?: number;
}

/**
 * Runs `git <args>` in `cwd` and resolves with stdout.
 * Arguments are passed straight to git (never through a shell), so paths and
 * messages with spaces or quotes are safe.
 */
export function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeoutMs ?? 60_000,
        windowsHide: true,
        env: {
          ...process.env,
          // Never block on an editor or a credential prompt we can't show.
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_PAGER: 'cat',
          LC_ALL: 'C',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === 'number' ? error.code : null;
          const detail = (stderr || error.message).trim();
          reject(new GitError(`git ${args[0] ?? ''} failed: ${detail}`, args, stderr, code));
          return;
        }
        resolve(stdout);
      },
    );
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

/** Resolves the top-level folder of the repo containing `path`, or null if it isn't in one. */
export async function findRepoRoot(path: string): Promise<string | null> {
  try {
    const out = (await runGit(path, ['rev-parse', '--show-toplevel'])).trim();
    // Git prints forward slashes on Windows (C:/Users/...); resolve() gives the native form.
    return out ? resolve(out) : null;
  } catch {
    return null;
  }
}

/** Absolute path of the repo's .git directory (handles worktrees and submodules). */
export async function gitDir(repo: string): Promise<string> {
  const out = await runGit(repo, ['rev-parse', '--absolute-git-dir']);
  return out.trim();
}
