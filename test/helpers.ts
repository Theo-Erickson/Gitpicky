import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A throwaway repository for tests, with a fixed identity and deterministic dates. */
export function makeRepo(): { dir: string; git: (...args: string[]) => string; write: (file: string, text: string) => void; commit: (msg: string, file?: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'gitpicky-test-'));
  let tick = 0;
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_AUTHOR_DATE: `2026-01-01T00:00:${String(tick).padStart(2, '0')}Z`,
        GIT_COMMITTER_DATE: `2026-01-01T00:00:${String(tick).padStart(2, '0')}Z`,
      },
    });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  // Keep line endings exactly as written, whatever the machine's global git settings are.
  git('config', 'core.autocrlf', 'false');
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const commit = (msg: string, file = 'notes.txt') => {
    tick++;
    write(file, `${msg}\n`);
    git('add', file);
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD').trim();
  };
  return { dir, git, write, commit };
}
