// A minimal MCP client over stdio, so the app can use its own bundled MCP server
// for models (like Ollama's) that don't speak MCP themselves. Every assistant
// therefore gets exactly the same tools, and changes still go through approval.

import { spawn, type ChildProcess } from 'node:child_process';
import type { Launch } from './cli';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class McpStdioClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = '';
  /** The server's guidance for the model, from initialize. */
  instructions = '';

  constructor(private readonly launch: Launch) {}

  async start(): Promise<void> {
    const child = spawn(this.launch.command, this.launch.args, {
      env: { ...process.env, ...this.launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.onData(chunk));
    child.stderr!.on('data', () => undefined);
    const fail = (error: Error) => {
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
    child.on('error', fail);
    child.on('exit', () => fail(new Error('The Gitpicky MCP server stopped.')));
    const init = (await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'gitpicky-app', version: '0.1.0' },
    })) as { instructions?: string };
    this.instructions = init?.instructions ?? '';
    this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.request('tools/list', {})) as { tools: McpTool[] };
    return result.tools;
  }

  /** Calls a tool and returns its text output. Tool errors come back as text, not exceptions, so the model can react. */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: !!result.isError };
  }

  close(): void {
    this.child?.kill();
    this.child = null;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin) {
        reject(new Error('The Gitpicky MCP server is not running.'));
        return;
      }
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: { id?: number; result?: unknown; error?: { message: string } };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const p = this.pending.get(message.id);
      if (!p) continue;
      this.pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error.message));
      else p.resolve(message.result);
    }
  }
}
