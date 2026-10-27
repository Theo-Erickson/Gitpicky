import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeRepo } from './helpers';

// Point both the bridge and the MCP server at a private discovery folder.
const home = mkdtempSync(join(tmpdir(), 'gitpicky-home-'));
process.env.GITPICKY_HOME = home;

type Bridge = import('../src/app/bridge').Bridge;
type Queue = import('../src/app/proposals').ProposalQueue;

let client: Client;
let bridge: Bridge | null = null;
let queue: Queue;
let shown: string[] = [];

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
}

beforeAll(async () => {
  // Test the bundled file that installers ship.
  execFileSync(process.execPath, [join('scripts', 'build-mcp.mjs')], { stdio: 'inherit' });
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['dist/mcp/gitpicky-mcp.js'], env: { ...process.env, GITPICKY_HOME: home } as Record<string, string> }),
  );
}, 60_000);

afterAll(async () => {
  bridge?.stop();
  await client?.close();
});

describe('MCP server', () => {
  it('lists its tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_proposal',
      'explain_git_term',
      'get_repo_overview',
      'open_in_gitpicky',
      'preview_change',
      'propose_change',
      'show_history',
    ]);
  });

  it('describes a repository', async () => {
    const repo = makeRepo();
    repo.commit('first');
    repo.write('level.txt', 'new level');
    const { text } = await call('get_repo_overview', { repo_path: repo.dir });
    expect(text).toContain('On branch **main**');
    expect(text).toContain('level.txt (new file, not tracked yet)');
    expect(text).toContain('(HEAD -> main) first');
  });

  it('explains terms', async () => {
    const { text } = await call('explain_git_term', { term: 'detached HEAD' });
    expect(text).toContain('**Detached HEAD**');
  });

  it('previews without changing anything', async () => {
    const repo = makeRepo();
    repo.commit('first');
    const { text } = await call('preview_change', { repo_path: repo.dir, operation: { type: 'create_branch', name: 'levels/forest' } });
    expect(text).toContain('Create branch "levels/forest"');
    expect(text).toContain('git switch -c levels/forest');
    expect(repo.git('branch', '--list', 'levels/forest')).toBe('');
  });

  it('reports a friendly error for folders that are not repos', async () => {
    const { text, isError } = await call('get_repo_overview', { repo_path: mkdtempSync(join(tmpdir(), 'not-a-repo-')) });
    expect(isError).toBe(true);
    expect(text).toContain("isn't inside a git repository");
  });

  it('says the app is needed when it is not running', async () => {
    const repo = makeRepo();
    repo.commit('first');
    const { text, isError } = await call('propose_change', { repo_path: repo.dir, operation: { type: 'stash' }, reason: 'test' });
    expect(isError).toBe(true);
    expect(text).toContain('not running');
  });

  describe('with the app running', () => {
    beforeAll(async () => {
      const { Bridge } = await import('../src/app/bridge');
      const { ProposalQueue } = await import('../src/app/proposals');
      queue = new ProposalQueue();
      bridge = new Bridge(queue, { version: 'test', currentRepo: () => null, showRepo: async (r) => void shown.push(r) });
      await bridge.start();
    });

    it('applies a change once the person approves it', async () => {
      const repo = makeRepo();
      repo.commit('first');
      queue.once('changed', (p) => setTimeout(() => void queue.approve(p.id), 50));
      const { text } = await call('propose_change', {
        repo_path: repo.dir,
        operation: { type: 'create_branch', name: 'feature/save-game' },
        reason: 'Keep save-game work separate from main.',
        wait_seconds: 10,
      });
      expect(text).toContain('approved and done');
      expect(repo.git('branch', '--show-current').trim()).toBe('feature/save-game');
      expect(shown).toContain(repo.dir);
    });

    it('passes along a rejection and changes nothing', async () => {
      const repo = makeRepo();
      repo.commit('first');
      repo.write('notes.txt', 'edit');
      queue.once('changed', (p) => setTimeout(() => queue.reject(p.id, 'not yet'), 50));
      const { text } = await call('propose_change', {
        repo_path: repo.dir,
        operation: { type: 'discard_changes' },
        reason: 'Clean up.',
        wait_seconds: 10,
      });
      expect(text).toContain('rejected');
      expect(text).toContain('not yet');
      expect(repo.git('status', '--porcelain')).toContain('notes.txt');
    });

    it('returns blocked plans right away without asking the person', async () => {
      const repo = makeRepo();
      repo.commit('first');
      const { text } = await call('propose_change', { repo_path: repo.dir, operation: { type: 'push' }, reason: 'Share it.' });
      expect(text).toContain('failed');
      expect(text).toContain('no remote');
    });

    it('can return early and be checked later', async () => {
      const repo = makeRepo();
      repo.commit('first');
      const first = await call('propose_change', { repo_path: repo.dir, operation: { type: 'create_tag', name: 'v0.1' }, reason: 'Mark it.', wait_seconds: 0 });
      const id = /Proposal (\w+)/.exec(first.text)![1];
      expect(first.text).toContain('waiting for the person');
      await queue.approve(id);
      const later = await call('check_proposal', { proposal_id: id, wait_seconds: 1 });
      expect(later.text).toContain('approved and done');
      expect(repo.git('tag').trim()).toBe('v0.1');
    });

    it('rejects requests without the token', async () => {
      const info = JSON.parse(readFileSync(join(home, 'bridge.json'), 'utf8'));
      const res = await fetch(`http://127.0.0.1:${info.port}/status`);
      expect(res.status).toBe(401);
    });
  });
});
