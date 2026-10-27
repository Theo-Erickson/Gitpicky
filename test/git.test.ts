import { mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/core/git';
import { makeRepo } from './helpers';

describe('findRepoRoot', () => {
  it('finds the top folder from inside a subfolder, in the native path style', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo.dir, 'a', 'b'), { recursive: true });
    const root = await findRepoRoot(join(repo.dir, 'a', 'b'));
    expect(root).not.toBeNull();
    // On Windows git answers with forward slashes; Gitpicky converts them.
    if (sep === '\\') expect(root).not.toContain('/');
    expect(root!.endsWith(repo.dir.split(sep).pop()!)).toBe(true);
  });
});
