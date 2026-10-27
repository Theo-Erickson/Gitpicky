import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { findRepoRoot } from '../core/git';
import { readCommitFiles, readSnapshot } from '../core/history';
import { executePlan, planChange, type Operation } from '../core/operations';
import type { RepoSnapshot } from '../core/types';
import type { Result } from './api';
import { Bridge } from './bridge';
import { ProposalQueue } from './proposals';
import { SettingsStore } from './settings';
import { RepoWatcher } from './watcher';

const ROOT = join(__dirname, '..', '..');
/** Swap this once the final icon is chosen (see assets/icons). */
const APP_ICON = join(ROOT, 'assets', 'icons', 'gitpicky-pick-256.png');
const HISTORY_LIMIT = 400;

let win: BrowserWindow | null = null;
let currentRepo: string | null = null;
const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
const watcher = new RepoWatcher(() => win?.webContents.send('repo:changed'));
const proposals = new ProposalQueue();
const bridge = new Bridge(proposals, {
  version: app.getVersion(),
  currentRepo: () => currentRepo,
  showRepo: async (repo) => {
    if (repo !== currentRepo) {
      const opened = await openRepo(repo);
      if (!opened.ok) throw new Error(opened.error);
      win?.webContents.send('repo:changed');
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  },
});

proposals.on('changed', (proposal) => {
  win?.webContents.send('proposals:changed');
  if (proposal.status === 'pending') win?.flashFrame(true);
});

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Opens a folder as the current repository. Exposed so other parts of the app can switch repos. */
export async function openRepo(path: string): Promise<Result<RepoSnapshot>> {
  const root = await findRepoRoot(path);
  if (!root) {
    return { ok: false, error: `"${path}" isn't inside a git repository. Pick a folder that has been set up with git (it contains a hidden .git folder).` };
  }
  const result = await wrap(() => readSnapshot(root, HISTORY_LIMIT));
  if (result.ok) {
    currentRepo = root;
    settings.rememberRepo(root);
    watcher.start(root);
    win?.setTitle(`${result.value.name} · Gitpicky`);
  }
  return result;
}

export function getCurrentRepo(): string | null {
  return currentRepo;
}

export function getWindow(): BrowserWindow | null {
  return win;
}

function requireRepo(): string {
  if (!currentRepo) throw new Error('Open a repository first.');
  return currentRepo;
}

/** Where the bundled MCP server lives, so the Assistant tab can show a ready-to-paste config. */
function mcpServerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'mcp', 'gitpicky-mcp.js')
    : join(ROOT, 'dist', 'mcp', 'gitpicky-mcp.js');
}

function registerIpc(): void {
  ipcMain.handle('mcp:server-path', () => mcpServerPath());
  ipcMain.handle('repo:pick', async () => {
    if (!win) return null;
    const choice = await dialog.showOpenDialog(win, {
      title: 'Open a git repository',
      properties: ['openDirectory'],
    });
    if (choice.canceled || choice.filePaths.length === 0) return null;
    return openRepo(choice.filePaths[0]);
  });
  ipcMain.handle('repo:open', (_e, path: string) => openRepo(path));
  ipcMain.handle('repo:refresh', async () => (currentRepo ? wrap(() => readSnapshot(requireRepo(), HISTORY_LIMIT)) : null));
  ipcMain.handle('repo:recent', () => settings.recentRepos);
  ipcMain.handle('repo:commit-files', (_e, hash: string) => wrap(() => readCommitFiles(requireRepo(), hash)));
  ipcMain.handle('change:plan', (_e, op: Operation) => wrap(() => planChange(requireRepo(), op)));
  ipcMain.handle('change:run', (_e, op: Operation) =>
    wrap(async () => {
      const result = await executePlan(requireRepo(), op);
      return { ok: result.ok, error: result.error, log: result.log, plan: result.plan };
    }),
  );
  ipcMain.handle('proposals:list', () => proposals.list());
  ipcMain.handle('proposals:approve', (_e, id: string) =>
    wrap(async () => {
      win?.flashFrame(false);
      return proposals.approve(id);
    }),
  );
  ipcMain.handle('proposals:reject', (_e, id: string, note?: string) =>
    wrap(async () => {
      win?.flashFrame(false);
      return proposals.reject(id, note);
    }),
  );
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
}

function startupRepo(): string | null {
  const flag = process.argv.indexOf('--repo');
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
  return process.env.GITPICKY_REPO ?? settings.recentRepos[0] ?? null;
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 560,
    title: 'Gitpicky',
    icon: APP_ICON,
    backgroundColor: '#1d1f27',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.on('focus', () => win?.webContents.send('repo:changed'));
  win.on('closed', () => {
    win = null;
    watcher.stop();
  });
  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const initial = startupRepo();
  if (initial) await openRepo(initial).catch(() => undefined);
  await win.loadFile(join(ROOT, 'dist', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  try {
    await bridge.start();
  } catch (error) {
    // The app still works without it; only the assistant connection is unavailable.
    console.error('Could not start the assistant bridge:', error);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('will-quit', () => bridge.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
