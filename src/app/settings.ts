import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROVIDER_IDS, type AssistantSettings, type ProviderId } from '../core/assistant-protocol';

export interface RecentEntry {
  path: string;
  /** ISO time it was last opened ('' if unknown). */
  lastOpened: string;
}

export interface Settings {
  recentRepos: RecentEntry[];
  /** Folders the repository browser looks in. null until you change it (suggested folders are used). */
  scanRoots: string[] | null;
  assistant: AssistantSettings;
}

const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v);

function normalizeAssistant(raw: unknown): AssistantSettings {
  const a = (raw ?? {}) as Partial<Record<keyof AssistantSettings, unknown>>;
  const models: AssistantSettings['models'] = {};
  if (a.models && typeof a.models === 'object') {
    for (const [k, v] of Object.entries(a.models as Record<string, unknown>)) {
      if (isProvider(k) && typeof v === 'string' && v) models[k] = v;
    }
  }
  return {
    provider: isProvider(a.provider) ? a.provider : null,
    models,
    ollamaUrl: typeof a.ollamaUrl === 'string' && /^https?:\/\//.test(a.ollamaUrl) ? a.ollamaUrl.replace(/\/+$/, '') : null,
  };
}

export const MAX_RECENT = 12;

/** Windows and macOS paths aren't case sensitive, so C:\Repo and c:\repo are the same folder. */
const sameKey = (path: string) => (process.platform === 'linux' ? path : path.toLowerCase());

/** Accepts both the current shape and the older plain list of paths. */
function normalize(raw: unknown): Settings {
  const list = (raw as { recentRepos?: unknown } | null)?.recentRepos;
  const recentRepos: RecentEntry[] = Array.isArray(list)
    ? list
        .map((e) => (typeof e === 'string' ? { path: e, lastOpened: '' } : (e as RecentEntry)))
        .filter((e) => e && typeof e.path === 'string' && e.path)
        .map((e) => ({ path: e.path, lastOpened: typeof e.lastOpened === 'string' ? e.lastOpened : '' }))
    : [];
  const roots = (raw as { scanRoots?: unknown } | null)?.scanRoots;
  const scanRoots = Array.isArray(roots) ? roots.filter((r): r is string => typeof r === 'string' && r !== '') : null;
  return { recentRepos: recentRepos.slice(0, MAX_RECENT), scanRoots, assistant: normalizeAssistant((raw as { assistant?: unknown } | null)?.assistant) };
}

export class SettingsStore {
  private data: Settings;

  constructor(private readonly file: string) {
    try {
      this.data = normalize(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      this.data = normalize(null);
    }
  }

  /** Most recently opened first. */
  get recentRepos(): RecentEntry[] {
    return this.data.recentRepos.map((e) => ({ ...e }));
  }

  rememberRepo(path: string, when = new Date()): void {
    const key = sameKey(path);
    this.data.recentRepos = [
      { path, lastOpened: when.toISOString() },
      ...this.data.recentRepos.filter((e) => sameKey(e.path) !== key),
    ].slice(0, MAX_RECENT);
    this.save();
  }

  forgetRepo(path: string): void {
    const key = sameKey(path);
    this.data.recentRepos = this.data.recentRepos.filter((e) => sameKey(e.path) !== key);
    this.save();
  }

  /** The folders the browser scans; `fallback` is used until the list has been changed. */
  scanRoots(fallback: string[]): string[] {
    return (this.data.scanRoots ?? fallback).slice();
  }

  addScanRoot(path: string, fallback: string[]): void {
    const roots = this.scanRoots(fallback);
    if (!roots.some((r) => sameKey(r) === sameKey(path))) roots.push(path);
    this.data.scanRoots = roots;
    this.save();
  }

  removeScanRoot(path: string, fallback: string[]): void {
    this.data.scanRoots = this.scanRoots(fallback).filter((r) => sameKey(r) !== sameKey(path));
    this.save();
  }

  get assistant(): AssistantSettings {
    return { ...this.data.assistant, models: { ...this.data.assistant.models } };
  }

  /** Merges in a change to the assistant choices (invalid values are dropped). */
  updateAssistant(change: Partial<AssistantSettings>): AssistantSettings {
    const merged = { ...this.data.assistant, ...change, models: { ...this.data.assistant.models, ...(change.models ?? {}) } };
    this.data.assistant = normalizeAssistant(merged);
    this.save();
    return this.assistant;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      // Settings are a convenience; never crash over them.
    }
  }
}
