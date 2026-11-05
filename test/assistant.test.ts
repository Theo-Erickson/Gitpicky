import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssistantEvent } from '../src/core/assistant-protocol';
import { launchFromShim } from '../src/app/assistant/cli';
import { clientStatuses, connectClient, disconnectClient, removeTomlServer, upsertTomlServer, type Places } from '../src/app/assistant/connect';
import { McpStdioClient } from '../src/app/assistant/mcp-stdio';
import { PROVIDERS, buildPrompt, ollamaUrlFromEnv, parseClaudeLine, parseCodexLine, toolModels } from '../src/app/assistant/providers';
import { SettingsStore } from '../src/app/settings';
import { makeRepo } from './helpers';

const SERVER = resolve('dist/mcp/gitpicky-mcp.js');
const mcpLaunch = { command: process.execPath, args: [SERVER] };

beforeAll(() => {
  execFileSync(process.execPath, [join('scripts', 'build-mcp.mjs')], { stdio: 'inherit' });
}, 60_000);

function collect(): { events: AssistantEvent[]; emit: (e: AssistantEvent) => void } {
  const events: AssistantEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe('finding CLIs', () => {
  it('reads an npm cmd shim and runs its script with node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitpicky-shim-'));
    const script = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    mkdirSync(join(script, '..'), { recursive: true });
    writeFileSync(script, '');
    const shim = '@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
    const launch = launchFromShim(shim, dir, { command: 'node', args: [] });
    expect(launch).toEqual({ command: 'node', args: [script], env: undefined });
  });

  it('gives up on a shim it does not understand', () => {
    expect(launchFromShim('@echo off\r\nsomething.exe %*', tmpdir(), { command: 'node', args: [] })).toBeNull();
  });
});

describe('talking to the CLIs', () => {
  it('builds a prompt with the repo, recent history and the new message', () => {
    const text = buildPrompt('C:\\work\\game', [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ], 'make a branch');
    expect(text).toContain('C:\\work\\game');
    expect(text).toContain('Person: hi\n\nYou: hello');
    expect(text.endsWith('The person now says:\nmake a branch')).toBe(true);
  });

  it('drops the oldest turns when the conversation gets long', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, text: `turn ${i} ${'x'.repeat(100)}` }));
    const text = buildPrompt(null, history, 'now', 1000);
    expect(text).toContain('turn 49');
    expect(text).not.toContain('turn 0 ');
  });

  it('understands Claude Code stream-json', () => {
    const { events, emit } = collect();
    parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init' }), emit);
    parseClaudeLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__gitpicky__get_repo_overview' }, { type: 'text', text: 'You are on main.' }] } }),
      emit,
    );
    parseClaudeLine(JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' }), emit);
    parseClaudeLine('not json', emit);
    expect(events).toEqual([
      { kind: 'tool', name: 'get_repo_overview' },
      { kind: 'text', text: 'You are on main.' },
      { kind: 'error', text: 'Credit balance is too low' },
    ]);
  });

  it('understands Codex exec --json', () => {
    const { events, emit } = collect();
    parseCodexLine(JSON.stringify({ type: 'thread.started', thread_id: 'x' }), emit);
    parseCodexLine(JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'gitpicky', tool: 'preview_change' } }), emit);
    parseCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Here is the plan.' } }), emit);
    parseCodexLine(JSON.stringify({ type: 'turn.failed', error: { message: 'rate limited' } }), emit);
    expect(events).toEqual([
      { kind: 'tool', name: 'preview_change' },
      { kind: 'text', text: 'Here is the plan.' },
      { kind: 'error', text: 'rate limited' },
    ]);
  });
});

describe('Ollama', () => {
  it('reads OLLAMA_HOST in its usual shapes', () => {
    expect(ollamaUrlFromEnv(undefined)).toBe('http://127.0.0.1:11434');
    expect(ollamaUrlFromEnv('0.0.0.0:11434')).toBe('http://127.0.0.1:11434');
    expect(ollamaUrlFromEnv('localhost')).toBe('http://localhost:11434');
    expect(ollamaUrlFromEnv('https://box.local:9000/')).toBe('https://box.local:9000');
  });

  it('lists only models that can use tools', () => {
    expect(toolModels({ models: [{ name: 'a', capabilities: ['completion', 'tools'] }, { name: 'b', capabilities: ['completion'] }, { name: 'c' }] })).toEqual(['a', 'c']);
  });

  describe('with a fake Ollama', () => {
    let server: Server;
    let url = '';
    const requests: { messages: { role: string; content: string; tool_name?: string }[]; tools: { function: { name: string } }[] }[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'tiny', capabilities: ['tools'] }] }));
          if (req.url === '/api/version') return res.end(JSON.stringify({ version: '9.9.9' }));
          const parsed = JSON.parse(body);
          requests.push(parsed);
          const last = parsed.messages[parsed.messages.length - 1];
          if (last.role === 'user') {
            const repo = /open in Gitpicky: (.+)/.exec(parsed.messages[0].content)![1];
            return res.end(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_repo_overview', arguments: { repo_path: repo } } }] } }));
          }
          return res.end(JSON.stringify({ message: { role: 'assistant', content: `Summary: ${last.content.includes('main') ? 'on main' : 'unknown'}` } }));
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(() => server.close());

    it('detects the running server and its models', async () => {
      const status = await PROVIDERS.ollama.detect({ mcp: mcpLaunch, node: null, repo: null, ollamaUrl: url });
      expect(status.available).toBe(true);
      expect(status.models).toEqual(['tiny']);
      expect(status.detail).toContain('9.9.9');
    });

    it('runs the Gitpicky tools the model asks for and returns its answer', async () => {
      const repo = makeRepo();
      repo.commit('first');
      const { events, emit } = collect();
      await PROVIDERS.ollama.run(
        { mcp: mcpLaunch, node: null, repo: repo.dir, ollamaUrl: url },
        { model: 'tiny', history: [], prompt: 'where am I?', signal: new AbortController().signal, emit },
      );
      expect(events).toEqual([
        { kind: 'tool', name: 'get_repo_overview' },
        { kind: 'text', text: 'Summary: on main' },
      ]);
      // The model was offered every Gitpicky tool and got the tool's real output back.
      expect(requests[0].tools.map((t) => t.function.name)).toContain('propose_change');
      const toolReply = requests[1].messages.find((m) => m.role === 'tool')!;
      expect(toolReply.tool_name).toBe('get_repo_overview');
      expect(toolReply.content).toContain('On branch **main**');
    }, 30_000);

    it('reports a stopped Ollama plainly', async () => {
      const status = await PROVIDERS.ollama.detect({ mcp: mcpLaunch, node: null, repo: null, ollamaUrl: 'http://127.0.0.1:9' });
      expect(status.available).toBe(false);
    });
  });
});

describe('MCP client', () => {
  it('starts the bundled server and lists its tools', async () => {
    const client = new McpStdioClient(mcpLaunch);
    await client.start();
    try {
      expect(client.instructions).toContain('Gitpicky');
      expect((await client.listTools()).map((t) => t.name)).toContain('preview_change');
      const r = await client.callTool('explain_git_term', { term: 'HEAD' });
      expect(r.isError).toBe(false);
      expect(r.text.length).toBeGreaterThan(20);
    } finally {
      client.close();
    }
  }, 30_000);
});

describe('connecting other tools', () => {
  const launch = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Apps\\Gitpicky\\gitpicky-mcp.js'] };

  function places(): Places {
    const home = mkdtempSync(join(tmpdir(), 'gitpicky-connect-'));
    return { home, platform: 'win32', appData: join(home, 'AppData', 'Roaming'), env: {} };
  }

  it('adds and removes the TOML table without touching the rest', () => {
    const original = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.gitpicky]\ncommand = "old"\n\n[mcp_servers.gitpicky.env]\nA = "1"\n\n[profiles.fast]\nmodel = "mini"\n';
    const updated = upsertTomlServer(original, { ...launch, env: { GITPICKY_ASSISTANT: 'Codex' } });
    expect(updated).not.toContain('"old"');
    expect(updated).toContain('[mcp_servers.other]');
    expect(updated).toContain('[profiles.fast]');
    expect(updated).toContain('args = ["C:\\\\Apps\\\\Gitpicky\\\\gitpicky-mcp.js"]');
    expect(updated).toContain('env = { GITPICKY_ASSISTANT = "Codex" }');
    const removed = removeTomlServer(updated);
    expect(removed).not.toContain('gitpicky');
    expect(removed).toContain('[profiles.fast]\nmodel = "mini"');
  });

  it('connects each tool, keeping its other settings, and disconnects again', () => {
    const p = places();
    const claudeJson = join(p.home, '.claude.json');
    writeFileSync(claudeJson, JSON.stringify({ numStartups: 3, mcpServers: { other: { command: 'x' } } }));
    for (const s of clientStatuses(launch.args[0], p)) expect(s.connected).toBe(false);

    for (const s of clientStatuses(launch.args[0], p)) connectClient(s.id, launch, p);
    const after = clientStatuses(launch.args[0], p);
    expect(after.every((s) => s.connected && !s.note)).toBe(true);

    const claude = JSON.parse(readFileSync(claudeJson, 'utf8'));
    expect(claude.numStartups).toBe(3);
    expect(claude.mcpServers.other).toEqual({ command: 'x' });
    expect(claude.mcpServers.gitpicky).toEqual({ type: 'stdio', command: launch.command, args: launch.args, env: { GITPICKY_ASSISTANT: 'Claude Code' } });
    expect(readFileSync(`${claudeJson}.gitpicky-backup`, 'utf8')).toContain('numStartups');

    const vscode = JSON.parse(readFileSync(join(p.appData!, 'Code', 'User', 'mcp.json'), 'utf8'));
    expect(vscode.servers.gitpicky.type).toBe('stdio');
    const copilot = JSON.parse(readFileSync(join(p.home, '.copilot', 'mcp-config.json'), 'utf8'));
    expect(copilot.mcpServers.gitpicky.tools).toEqual(['*']);

    for (const s of after) disconnectClient(s.id, p);
    expect(clientStatuses(launch.args[0], p).some((s) => s.connected)).toBe(false);
    expect(JSON.parse(readFileSync(claudeJson, 'utf8')).mcpServers).toEqual({ other: { command: 'x' } });
  });

  it('flags an entry that points at another copy of Gitpicky', () => {
    const p = places();
    connectClient('gemini', { command: 'node', args: ['D:\\old\\gitpicky-mcp.js'] }, p);
    connectClient('codex', { command: 'node', args: ['D:\\old\\gitpicky-mcp.js'] }, p);
    const statuses = clientStatuses(launch.args[0], p);
    expect(statuses.find((s) => s.id === 'gemini')!.note).toMatch(/different copy/);
    expect(statuses.find((s) => s.id === 'codex')!.note).toMatch(/different copy/);
  });

  it("won't rewrite a settings file with comments", () => {
    const p = places();
    const file = join(p.appData!, 'Code', 'User', 'mcp.json');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{\n  // my servers\n  "servers": {}\n}\n');
    const status = clientStatuses(launch.args[0], p).find((s) => s.id === 'vscode')!;
    expect(status.editable).toBe(false);
    expect(() => connectClient('vscode', launch, p)).toThrow(/by hand/);
    expect(readFileSync(file, 'utf8')).toContain('// my servers');
  });
});

describe('assistant settings', () => {
  it('saves the choice and drops invalid values', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gitpicky-settings-')), 'settings.json');
    const store = new SettingsStore(file);
    expect(store.assistant).toEqual({ provider: null, models: {}, ollamaUrl: null });
    store.updateAssistant({ provider: 'ollama', models: { ollama: 'qwen3' } });
    store.updateAssistant({ provider: 'nope' as never, ollamaUrl: 'ftp://x' });
    const again = new SettingsStore(file);
    expect(again.assistant).toEqual({ provider: null, models: { ollama: 'qwen3' }, ollamaUrl: null });
    again.updateAssistant({ provider: 'codex', ollamaUrl: 'http://box:11434/' });
    expect(new SettingsStore(file).assistant).toEqual({ provider: 'codex', models: { ollama: 'qwen3' }, ollamaUrl: 'http://box:11434' });
  });
});
