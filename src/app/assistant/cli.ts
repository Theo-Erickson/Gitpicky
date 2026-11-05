// Finding and running command-line tools (claude, codex, copilot, node) without a shell,
// so nothing the person types is ever interpreted by cmd.exe or bash.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, resolve } from 'node:path';

export interface Launch {
  command: string;
  /** Arguments that come before the tool's own arguments (e.g. the script a shim points at). */
  args: string[];
  env?: Record<string, string>;
}

const isWindows = process.platform === 'win32';

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Folders tools commonly install into that may not be on the app's PATH (apps started from a shortcut get a short one). */
function extraDirs(): string[] {
  const home = homedir();
  const dirs = [join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, 'bin')];
  if (isWindows) {
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'));
    if (process.env.LOCALAPPDATA) {
      dirs.push(join(process.env.LOCALAPPDATA, 'Programs', 'Ollama'));
      dirs.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    }
    dirs.push('C:\\Program Files\\nodejs');
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');
  }
  return dirs;
}

/** Full path of a program on PATH (or a common install folder), or null. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = [...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), ...extraDirs()];
  const exts = isWindows ? ['.exe', '.cmd', '.bat', '.com'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * How to start a program found on disk without a shell. Windows npm installs are
 * `.cmd` shims, which can only run through cmd.exe, so we read the shim and start
 * the script it points at with Node directly.
 */
export function launchFor(path: string, node: Launch | null): Launch | null {
  const ext = extname(path).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { command: path, args: [] };
  let shim: string;
  try {
    shim = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  return launchFromShim(shim, dirname(path), node);
}

/** Reads an npm cmd-shim and returns how to run its target. Exported for tests. */
export function launchFromShim(shim: string, shimDir: string, node: Launch | null): Launch | null {
  // npm writes e.g.  "%_prog%"  "%dp0%\node_modules\@scope\pkg\cli.js" %*
  const match = /"%~?dp0%?\\([^"]+?\.(?:js|cjs|mjs|exe))"/i.exec(shim);
  if (!match) return null;
  const target = resolve(shimDir, match[1]);
  if (!existsSync(target)) return null;
  if (target.toLowerCase().endsWith('.exe')) return { command: target, args: [] };
  if (!node) return null;
  return { command: node.command, args: [...node.args, target], env: node.env };
}

/**
 * How to run a Node script: the system's `node` if there is one, otherwise the
 * app's own Electron binary in Node mode (so people don't need Node installed).
 */
export function nodeLaunch(electronPath: string | null): Launch | null {
  const node = findOnPath('node');
  if (node) return { command: node, args: [] };
  if (electronPath) return { command: electronPath, args: [], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return null;
}

export interface RunOptions {
  cwd?: string;
  /** Written to the program's input, then closed. */
  stdin?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Called with each line of output as it arrives. */
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function run(launch: Launch, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(launch.command, [...launch.args, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...launch.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;
    const onAbort = () => child.kill();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (!options.onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) options.onLine(line);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (pending && options.onLine) options.onLine(pending);
      resolvePromise({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');
  });
}
