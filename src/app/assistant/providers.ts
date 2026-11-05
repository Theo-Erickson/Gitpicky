// The in-app assistant's "brains". Each provider gets the same Gitpicky MCP tools:
// Ollama through the app's own MCP client, and the agent CLIs (Claude Code, Codex,
// Copilot) by being told to start the bundled MCP server themselves. Either way a
// change only happens through propose_change, which the person approves in the app.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssistantEvent, ChatMessage, ProviderId, ProviderStatus } from '../../core/assistant-protocol';
import { findOnPath, launchFor, run, type Launch } from './cli';
import { McpStdioClient } from './mcp-stdio';

export interface ProviderContext {
  /** How to start the bundled MCP server. */
  mcp: Launch;
  /** How to run a Node script (for npm-installed CLIs on Windows). */
  node: Launch | null;
  /** The repository open in the window, if any. */
  repo: string | null;
  ollamaUrl: string;
}

export interface RunRequest {
  model?: string;
  history: ChatMessage[];
  prompt: string;
  signal: AbortSignal;
  emit: (event: AssistantEvent) => void;
}

interface Provider {
  id: ProviderId;
  label: string;
  installUrl: string;
  detect(ctx: ProviderContext): Promise<ProviderStatus>;
  run(ctx: ProviderContext, request: RunRequest): Promise<void>;
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** OLLAMA_HOST may be "0.0.0.0:11434", "localhost", or a full URL. */
export function ollamaUrlFromEnv(host = process.env.OLLAMA_HOST): string {
  if (!host) return DEFAULT_OLLAMA_URL;
  let url = /^https?:\/\//.test(host) ? host : `http://${host}`;
  url = url.replace('://0.0.0.0', '://127.0.0.1').replace(/\/+$/, '');
  return /:\d+$/.test(url) ? url : `${url}:11434`;
}

/** Orientation for the model: which repo is open and how to behave inside Gitpicky. */
export function contextNote(repo: string | null): string {
  const where = repo
    ? `The person has this repository open in Gitpicky: ${repo}\nPass that path as repo_path to the gitpicky tools.`
    : 'No repository is open in Gitpicky right now. If the person asks about one, ask them to open it first.';
  return [
    'You are the assistant inside Gitpicky, an app that helps people who are new to git.',
    where,
    'Use only the gitpicky tools. Do not edit files or run shell commands. To change the repository, use preview_change and then propose_change, so the person can approve it in Gitpicky.',
    'Keep answers short and in plain language.',
  ].join('\n');
}

/** For the CLIs, which take one prompt per run: the context, the conversation so far, and the new message. */
export function buildPrompt(repo: string | null, history: ChatMessage[], prompt: string, maxChars = 24_000): string {
  const turns = history.map((m) => `${m.role === 'user' ? 'Person' : 'You'}: ${m.text}`);
  // Keep the most recent turns that fit.
  const kept: string[] = [];
  let size = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    size += turns[i].length;
    if (size > maxChars) break;
    kept.unshift(turns[i]);
  }
  const parts = [contextNote(repo)];
  if (kept.length) parts.push(`Conversation so far:\n${kept.join('\n\n')}`);
  parts.push(`The person now says:\n${prompt}`);
  return parts.join('\n\n');
}

function mcpServerEntry(ctx: ProviderContext, assistant: string): { command: string; args: string[]; env: Record<string, string> } {
  return { command: ctx.mcp.command, args: ctx.mcp.args, env: { ...ctx.mcp.env, GITPICKY_ASSISTANT: assistant } };
}

/** Writes a one-run MCP config file and returns its path plus a cleanup function. */
function tempConfig(name: string, body: unknown): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gitpicky-assistant-'));
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(body, null, 2));
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? '';
}

/** Last few lines of a CLI's error output, for the message shown to the person. */
function tail(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-4).join('\n');
}

// ---------------------------------------------------------------- CLI providers

interface CliSpec {
  id: ProviderId;
  label: string;
  binary: string;
  installUrl: string;
  /** Builds the arguments and input for one run. */
  invocation(ctx: ProviderContext, request: RunRequest, configFile: (name: string, body: unknown) => string): { args: string[]; stdin?: string; env?: Record<string, string> };
  /** Turns one line of output into events. */
  parse(line: string, emit: (event: AssistantEvent) => void): void;
  /** True if parse() understood any output at all (otherwise raw output is shown). */
  structured: boolean;
}

function cliLaunch(ctx: ProviderContext, binary: string): Launch | null {
  const path = findOnPath(binary);
  return path ? launchFor(path, ctx.node) : null;
}

function cliProvider(spec: CliSpec): Provider {
  return {
    id: spec.id,
    label: spec.label,
    installUrl: spec.installUrl,
    async detect(ctx) {
      const base = { id: spec.id, label: spec.label, installUrl: spec.installUrl, models: [] };
      const launch = cliLaunch(ctx, spec.binary);
      if (!launch) return { ...base, available: false, detail: `Not found. Install the ${spec.binary} command, then click Check again.` };
      try {
        const r = await run(launch, ['--version'], { timeoutMs: 20_000 });
        if (r.code !== 0) return { ...base, available: false, detail: `Found, but "${spec.binary} --version" failed: ${firstLine(r.stderr) || `exit code ${r.code}`}` };
        return { ...base, available: true, detail: firstLine(r.stdout) || 'Ready' };
      } catch (error) {
        return { ...base, available: false, detail: `Found, but it wouldn't start: ${(error as Error).message}` };
      }
    },
    async run(ctx, request) {
      const launch = cliLaunch(ctx, spec.binary);
      if (!launch) throw new Error(`Can't find the ${spec.binary} command anymore.`);
      const cleanups: (() => void)[] = [];
      const configFile = (name: string, body: unknown) => {
        const t = tempConfig(name, body);
        cleanups.push(t.cleanup);
        return t.file;
      };
      try {
        const { args, stdin, env } = spec.invocation(ctx, request, configFile);
        let understood = false;
        const emit = (event: AssistantEvent) => {
          understood = true;
          request.emit(event);
        };
        const result = await run(launch, args, {
          cwd: ctx.repo ?? undefined,
          stdin,
          env,
          signal: request.signal,
          onLine: (line) => {
            if (!line.trim()) return;
            if (spec.structured) spec.parse(line, emit);
            else request.emit({ kind: 'text', text: `${line}\n` });
          },
        });
        if (request.signal.aborted) return;
        if (result.code !== 0) {
          throw new Error(`${spec.label} stopped with an error${result.stderr.trim() ? `:\n${tail(result.stderr)}` : ` (exit code ${result.code}).`}`);
        }
        if (spec.structured && !understood && result.stdout.trim()) request.emit({ kind: 'text', text: result.stdout.trim() });
      } finally {
        for (const c of cleanups) c();
      }
    },
  };
}

/** Claude Code `-p --output-format stream-json` lines. Exported for tests. */
export function parseClaudeLine(line: string, emit: (event: AssistantEvent) => void): void {
  let event: { type?: string; message?: { content?: { type: string; text?: string; name?: string }[] }; is_error?: boolean; result?: string };
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (event.type === 'assistant') {
    for (const block of event.message?.content ?? []) {
      if (block.type === 'text' && block.text) emit({ kind: 'text', text: block.text });
      if (block.type === 'tool_use' && block.name) emit({ kind: 'tool', name: block.name.replace(/^mcp__gitpicky__/, '') });
    }
  } else if (event.type === 'result' && event.is_error) {
    emit({ kind: 'error', text: event.result || 'Claude Code reported an error.' });
  }
}

/** Codex `exec --json` lines. Exported for tests. */
export function parseCodexLine(line: string, emit: (event: AssistantEvent) => void): void {
  let event: { type?: string; message?: string; error?: { message?: string }; item?: { type?: string; text?: string; tool?: string } };
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const item = event.item;
  if (event.type === 'item.started' && item?.type === 'mcp_tool_call' && item.tool) emit({ kind: 'tool', name: item.tool });
  else if (event.type === 'item.completed' && (item?.type === 'agent_message' || item?.type === 'assistant_message') && item.text) emit({ kind: 'text', text: item.text });
  else if (event.type === 'turn.failed') emit({ kind: 'error', text: event.error?.message ?? 'Codex reported an error.' });
  else if (event.type === 'error' && event.message) emit({ kind: 'error', text: event.message });
}

/** TOML for a flat string table, e.g. {A="1"}. JSON string escaping is valid TOML. */
function tomlInlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(',')}}`;
}

const claude = cliProvider({
  id: 'claude',
  label: 'Claude Code',
  binary: 'claude',
  installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  structured: true,
  invocation(ctx, request, configFile) {
    const file = configFile('mcp.json', { mcpServers: { gitpicky: mcpServerEntry(ctx, 'Claude Code') } });
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', file, '--strict-mcp-config'];
    if (request.model) args.push('--model', request.model);
    args.push('--allowedTools', 'mcp__gitpicky', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch');
    // propose_change waits for the person to decide, so give MCP tools time.
    return { args, stdin: buildPrompt(ctx.repo, request.history, request.prompt), env: { MCP_TOOL_TIMEOUT: '130000' } };
  },
  parse: parseClaudeLine,
});

const codex = cliProvider({
  id: 'codex',
  label: 'Codex',
  binary: 'codex',
  installUrl: 'https://developers.openai.com/codex/cli',
  structured: true,
  invocation(ctx, request) {
    const server = mcpServerEntry(ctx, 'Codex');
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '-c',
      `mcp_servers.gitpicky.command=${JSON.stringify(server.command)}`,
      '-c',
      `mcp_servers.gitpicky.args=${JSON.stringify(server.args)}`,
      '-c',
      `mcp_servers.gitpicky.env=${tomlInlineTable(server.env)}`,
      '-c',
      'mcp_servers.gitpicky.tool_timeout_sec=130',
    ];
    if (ctx.repo) args.push('-C', ctx.repo);
    if (request.model) args.push('--model', request.model);
    args.push('-');
    return { args, stdin: buildPrompt(ctx.repo, request.history, request.prompt) };
  },
  parse: parseCodexLine,
});

const copilot = cliProvider({
  id: 'copilot',
  label: 'GitHub Copilot',
  binary: 'copilot',
  installUrl: 'https://docs.github.com/copilot/how-tos/set-up/install-copilot-cli',
  structured: false,
  invocation(ctx, request, configFile) {
    const server = { type: 'local', ...mcpServerEntry(ctx, 'GitHub Copilot'), tools: ['*'] };
    const file = configFile('mcp-config.json', { mcpServers: { gitpicky: server } });
    const args = ['-p', buildPrompt(ctx.repo, request.history, request.prompt, 12_000), '--additional-mcp-config', `@${file}`, '--allow-tool', 'gitpicky', '--deny-tool', 'shell', '--deny-tool', 'write'];
    if (request.model) args.push('--model', request.model);
    return { args };
  },
  parse: () => undefined,
});

// ---------------------------------------------------------------- Ollama

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  tool_name?: string;
}

async function ollamaFetch<T>(url: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // not JSON
    }
    throw new Error(`Ollama said: ${message || response.statusText}`);
  }
  return (await response.json()) as T;
}

/** Models that can use tools. Older Ollama versions don't report capabilities, so then every model is listed. */
export function toolModels(tags: { models?: { name: string; capabilities?: string[] }[] }): string[] {
  return (tags.models ?? []).filter((m) => !m.capabilities || m.capabilities.includes('tools')).map((m) => m.name);
}

const MAX_TOOL_ROUNDS = 16;

const ollama: Provider = {
  id: 'ollama',
  label: 'Ollama',
  installUrl: 'https://ollama.com/download',
  async detect(ctx) {
    const base = { id: 'ollama' as const, label: 'Ollama', installUrl: 'https://ollama.com/download' };
    try {
      const signal = AbortSignal.timeout(4000);
      const [version, tags] = await Promise.all([
        ollamaFetch<{ version?: string }>(ctx.ollamaUrl, '/api/version', undefined, signal).catch(() => ({ version: undefined })),
        ollamaFetch<{ models?: { name: string; capabilities?: string[] }[] }>(ctx.ollamaUrl, '/api/tags', undefined, signal),
      ]);
      const models = toolModels(tags);
      if (models.length === 0) {
        return { ...base, available: false, models, detail: 'Running, but no installed model can use tools. Try "ollama pull qwen3" (or another model with tool support).' };
      }
      return { ...base, available: true, models, detail: `Running${version.version ? ` (version ${version.version})` : ''} at ${ctx.ollamaUrl}` };
    } catch {
      const installed = findOnPath('ollama');
      return {
        ...base,
        available: false,
        models: [],
        detail: installed ? `Installed, but not running at ${ctx.ollamaUrl}. Start Ollama, then click Check again.` : 'Not found. Install Ollama and pull a model, then click Check again.',
      };
    }
  },
  async run(ctx, request) {
    if (!request.model) throw new Error('Pick an Ollama model first.');
    const client = new McpStdioClient({ ...ctx.mcp, env: { ...ctx.mcp.env, GITPICKY_ASSISTANT: `Ollama (${request.model})` } });
    const stop = () => client.close();
    request.signal.addEventListener('abort', stop, { once: true });
    try {
      await client.start();
      const tools = (await client.listTools()).map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
      }));
      const messages: OllamaMessage[] = [
        { role: 'system', content: `${client.instructions}\n\n${contextNote(ctx.repo)}` },
        ...request.history.map((m) => ({ role: m.role, content: m.text }) as OllamaMessage),
        { role: 'user', content: request.prompt },
      ];
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const reply = await ollamaFetch<{ message: OllamaMessage }>(ctx.ollamaUrl, '/api/chat', { model: request.model, messages, tools, stream: false }, request.signal);
        const message = reply.message;
        messages.push(message);
        if (message.content?.trim()) request.emit({ kind: 'text', text: message.content.trim() });
        const calls = message.tool_calls ?? [];
        if (calls.length === 0) return;
        for (const call of calls) {
          const name = call.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments ?? {};
          } catch {
            // Leave empty; the tool will say what's missing.
          }
          request.emit({ kind: 'tool', name });
          const result = await client.callTool(name, args).catch((error: Error) => ({ text: error.message, isError: true }));
          messages.push({ role: 'tool', tool_name: name, content: result.isError ? `Error: ${result.text}` : result.text });
        }
      }
      request.emit({ kind: 'text', text: '(Stopped after many tool calls in a row. Ask again to continue.)' });
    } finally {
      request.signal.removeEventListener('abort', stop);
      client.close();
    }
  },
};

export const PROVIDERS: Record<ProviderId, Provider> = { ollama, claude, codex, copilot };
