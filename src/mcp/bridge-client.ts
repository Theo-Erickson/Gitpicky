import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { BRIDGE_FILE } from '../core/bridge-paths';
import type { BridgeInfo } from '../core/bridge-protocol';

export class AppNotRunningError extends Error {
  constructor() {
    super(
      'The Gitpicky app is not running, so there is nobody to approve the change. Ask the person to open Gitpicky, then try again. (Read-only tools still work without the app.)',
    );
    this.name = 'AppNotRunningError';
  }
}

function readInfo(): BridgeInfo {
  let info: BridgeInfo;
  try {
    info = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8')) as BridgeInfo;
  } catch {
    throw new AppNotRunningError();
  }
  try {
    process.kill(info.pid, 0);
  } catch (error) {
    // EPERM means the process exists but belongs to someone else; anything else means it's gone.
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw new AppNotRunningError();
  }
  return info;
}

/** Calls the running app's local bridge. */
export function callApp<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const info = readInfo();
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        method,
        path,
        timeout: timeoutMs,
        headers: {
          authorization: `Bearer ${info.token}`,
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let data: unknown;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            reject(new Error('Gitpicky sent an unreadable reply.'));
            return;
          }
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error((data as { error?: string }).error ?? `Gitpicky replied with ${res.statusCode}.`));
          } else {
            resolve(data as T);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out waiting for Gitpicky.')));
    req.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ECONNREFUSED' ? new AppNotRunningError() : error);
    });
    if (payload) req.write(payload);
    req.end();
  });
}
