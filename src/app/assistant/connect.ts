// "Connect to…": adds (or removes) Gitpicky's MCP server in other AI tools' settings,
// so Claude Code, Codex, Copilot, VS Code and friends can use Gitpicky themselves.
// Only the "gitpicky" entry is touched; everything else in those files is kept, and
// the previous file is saved next to it as .gitpicky-backup before each write.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ClientId, ClientStatus } from '../../core/assistant-protocol';
import type { Launch } from './cli';

export const SERVER_NAME = 'gitpicky';

export interface Places {
  home: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData?: string;
  env?: NodeJS.ProcessEnv;
}

export function defaultPlaces(): Places {
  return { home: homedir(), platform: process.platform, appData: process.env.APPDATA, env: process.env };
}

type Format = { kind: 'json'; key: 'mcpServers' | 'servers'; entry: (server: ServerSpec) => Record<string, unknown> } | { kind: 'toml' };

interface ClientDef {
  id: ClientId;
  label: string;
  path: (p: Places) => string;
  format: Format;
}

export interface ServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Per-OS application-support folder (Claude Desktop, VS Code). */
function appSupport(p: Places): string {
  if (p.platform === 'win32') return p.appData ?? join(p.home, 'AppData', 'Roaming');
  if (p.platform === 'darwin') return join(p.home, 'Library', 'Application Support');
  return p.env?.XDG_CONFIG_HOME ?? join(p.home, '.config');
}

const plain = (s: ServerSpec) => ({ command: s.command, args: s.args, ...(Object.keys(s.env).length ? { env: s.env } : {}) });

const CLIENTS: ClientDef[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    path: (p) => join(p.env?.CLAUDE_CONFIG_DIR ?? p.home, '.claude.json'),
    format: { kind: 'json', key: 'mcpServers', entry: (s) => ({ type: 'stdio', ...plain(s) }) },
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    path: (p) => join(appSupport(p), 'Claude', 'claude_desktop_config.json'),
    format: { kind: 'json', key: 'mcpServers', entry: plain },
  },
  {
    id: 'codex',
    label: 'Codex',
    path: (p) => join(p.env?.CODEX_HOME ?? join(p.home, '.codex'), 'config.toml'),
    format: { kind: 'toml' },
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    path: (p) => join(p.env?.COPILOT_HOME ?? join(p.home, '.copilot'), 'mcp-config.json'),
    format: { kind: 'json', key: 'mcpServers', entry: (s) => ({ type: 'local', ...plain(s), tools: ['*'] }) },
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot Chat)',
    path: (p) => join(appSupport(p), 'Code', 'User', 'mcp.json'),
    format: { kind: 'json', key: 'servers', entry: (s) => ({ type: 'stdio', ...plain(s) }) },
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    path: (p) => join(p.home, '.gemini', 'settings.json'),
    format: { kind: 'json', key: 'mcpServers', entry: plain },
  },
];

export function serverSpec(launch: Launch, label: string): ServerSpec {
  return { command: launch.command, args: launch.args, env: { ...launch.env, GITPICKY_ASSISTANT: label } };
}

// ---------------------------------------------------------------- JSON files

type JsonRead = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };

function readJson(file: string): JsonRead {
  if (!existsSync(file)) return { ok: true, data: {} };
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return { ok: true, data: {} };
  try {
    const data = JSON.parse(text.replace(/^﻿/, ''));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: "isn't a JSON object" };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: 'has comments or other things Gitpicky can\'t safely rewrite' };
  }
}

// ---------------------------------------------------------------- TOML (Codex)

const tomlHeader = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

/** Removes the [mcp_servers.gitpicky] table (and its sub-tables). Exported for tests. */
export function removeTomlServer(text: string, name = SERVER_NAME): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  const own = (header: string) => {
    const key = header.replace(/\s+/g, '').replace(/"/g, '');
    return key === `mcp_servers.${name}` || key.startsWith(`mcp_servers.${name}.`);
  };
  for (const line of lines) {
    const m = tomlHeader.exec(line);
    if (m) skipping = own(m[1]);
    if (!skipping) out.push(line);
  }
  // Tidy the blank lines left behind.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

/** Adds or replaces the gitpicky table. Exported for tests. */
export function upsertTomlServer(text: string, server: ServerSpec, name = SERVER_NAME): string {
  const rest = removeTomlServer(text, name);
  const block = [
    `[mcp_servers.${name}]`,
    `command = ${JSON.stringify(server.command)}`,
    `args = [${server.args.map((a) => JSON.stringify(a)).join(', ')}]`,
    // propose_change waits for the person to decide.
    'tool_timeout_sec = 130',
  ];
  if (Object.keys(server.env).length) {
    block.push(`env = { ${Object.entries(server.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`);
  }
  return `${rest ? `${rest}\n\n` : ''}${block.join('\n')}\n`;
}

function tomlHasServer(text: string, name = SERVER_NAME): boolean {
  return text.split(/\r?\n/).some((line) => {
    const m = tomlHeader.exec(line);
    return !!m && m[1].replace(/\s+/g, '').replace(/"/g, '') === `mcp_servers.${name}`;
  });
}

// ---------------------------------------------------------------- public

function backupAndWrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.gitpicky-backup`);
  writeFileSync(file, text);
}

function find(id: ClientId): ClientDef {
  const def = CLIENTS.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown tool "${id}".`);
  return def;
}

export function clientStatuses(serverScript: string, places: Places = defaultPlaces()): ClientStatus[] {
  return CLIENTS.map((def) => {
    const configPath = def.path(places);
    const base = { id: def.id, label: def.label, configPath };
    if (def.format.kind === 'toml') {
      const text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      const connected = tomlHasServer(text);
      const stale = connected && !text.includes(JSON.stringify(serverScript).slice(1, -1));
      return { ...base, connected, editable: true, note: stale ? 'Points to a different copy of Gitpicky. Connect again to update it.' : undefined };
    }
    const read = readJson(configPath);
    if (!read.ok) return { ...base, connected: false, editable: false, note: `The settings file ${read.reason}. Copy the config and add it by hand.` };
    const entry = (read.data[def.format.key] as Record<string, { args?: unknown }> | undefined)?.[SERVER_NAME];
    const connected = !!entry;
    const stale = connected && !(Array.isArray(entry.args) && entry.args.includes(serverScript));
    return { ...base, connected, editable: true, note: stale ? 'Points to a different copy of Gitpicky. Connect again to update it.' : undefined };
  });
}

export function connectClient(id: ClientId, launch: Launch, places: Places = defaultPlaces()): void {
  const def = find(id);
  const file = def.path(places);
  const server = serverSpec(launch, def.label);
  if (def.format.kind === 'toml') {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    backupAndWrite(file, upsertTomlServer(text, server));
    return;
  }
  const read = readJson(file);
  if (!read.ok) throw new Error(`${def.label}'s settings file ${read.reason}. Copy the config and add it by hand.`);
  const servers = { ...((read.data[def.format.key] as Record<string, unknown> | undefined) ?? {}) };
  servers[SERVER_NAME] = def.format.entry(server);
  backupAndWrite(file, `${JSON.stringify({ ...read.data, [def.format.key]: servers }, null, 2)}\n`);
}

export function disconnectClient(id: ClientId, places: Places = defaultPlaces()): void {
  const def = find(id);
  const file = def.path(places);
  if (!existsSync(file)) return;
  if (def.format.kind === 'toml') {
    const text = readFileSync(file, 'utf8');
    if (tomlHasServer(text)) backupAndWrite(file, `${removeTomlServer(text)}\n`);
    return;
  }
  const read = readJson(file);
  if (!read.ok) throw new Error(`${def.label}'s settings file ${read.reason}. Remove the "gitpicky" entry by hand.`);
  const servers = read.data[def.format.key] as Record<string, unknown> | undefined;
  if (!servers || !(SERVER_NAME in servers)) return;
  const { [SERVER_NAME]: _removed, ...others } = servers;
  void _removed;
  backupAndWrite(file, `${JSON.stringify({ ...read.data, [def.format.key]: others }, null, 2)}\n`);
}

/** The snippet for tools Gitpicky doesn't know, in the common mcpServers shape. */
export function genericConfig(launch: Launch): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: plain(serverSpec(launch, 'Your assistant')) } }, null, 2);
}
