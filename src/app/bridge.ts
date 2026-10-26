import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BRIDGE_DIR, BRIDGE_FILE } from '../core/bridge-paths';
import type { BridgeInfo, CreateProposalRequest } from '../core/bridge-protocol';
import { findRepoRoot } from '../core/git';
import type { ProposalQueue } from './proposals';

export interface BridgeHooks {
  version: string;
  currentRepo(): string | null;
  /** Show this repository in the window (switching if needed) and bring the window forward. */
  showRepo(repo: string): Promise<void>;
}

const MAX_BODY = 256 * 1024;
const MAX_WAIT_MS = 110_000;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The local HTTP endpoint the MCP server uses to reach the running app. */
export class Bridge {
  private server: Server | null = null;
  private readonly token = randomBytes(24).toString('hex');

  constructor(
    private readonly proposals: ProposalQueue,
    private readonly hooks: BridgeHooks,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => send(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    const info: BridgeInfo = { port, token: this.token, pid: process.pid, version: this.hooks.version };
    mkdirSync(BRIDGE_DIR, { recursive: true });
    writeFileSync(BRIDGE_FILE, JSON.stringify(info, null, 2), { mode: 0o600 });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    // Only remove the discovery file if it is still ours (another instance may have replaced it).
    try {
      const info = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8')) as BridgeInfo;
      if (info.pid === process.pid) rmSync(BRIDGE_FILE, { force: true });
    } catch {
      // Already gone.
    }
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.replace(/^Bearer /, ''));
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Browsers send an Origin header; the MCP server doesn't. Refusing them blocks web pages from poking the app.
    if (req.headers.origin || !this.authorized(req)) {
      send(res, 401, { error: 'Not authorized.' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/status') {
      send(res, 200, { app: 'gitpicky', version: this.hooks.version, repo: this.hooks.currentRepo() });
      return;
    }

    if (req.method === 'POST' && path === '/open') {
      const body = (await readBody(req)) as { repo?: string };
      const root = body.repo ? await findRepoRoot(body.repo) : null;
      if (!root) {
        send(res, 400, { error: `"${body.repo}" isn't a git repository.` });
        return;
      }
      await this.hooks.showRepo(root);
      send(res, 200, { repo: root });
      return;
    }

    if (req.method === 'POST' && path === '/proposals') {
      const body = (await readBody(req)) as Partial<CreateProposalRequest>;
      if (!body.repo || !body.operation || typeof body.operation !== 'object') {
        send(res, 400, { error: 'repo and operation are required.' });
        return;
      }
      const root = await findRepoRoot(body.repo);
      if (!root) {
        send(res, 400, { error: `"${body.repo}" isn't a git repository.` });
        return;
      }
      await this.hooks.showRepo(root);
      const proposal = await this.proposals.create({
        repo: root,
        operation: body.operation,
        reason: String(body.reason ?? ''),
        requestedBy: body.requestedBy,
      });
      send(res, 201, proposal);
      return;
    }

    const match = /^\/proposals\/([\w-]+)$/.exec(path);
    if (req.method === 'GET' && match) {
      const proposal = this.proposals.get(match[1]);
      if (!proposal) {
        send(res, 404, { error: 'No such proposal (the app may have been restarted).' });
        return;
      }
      const wait = Math.min(Number(url.searchParams.get('wait') ?? 0) * 1000, MAX_WAIT_MS);
      send(res, 200, wait > 0 ? await this.proposals.waitForDecision(proposal.id, wait) : proposal);
      return;
    }

    send(res, 404, { error: 'Unknown endpoint.' });
  }
}
