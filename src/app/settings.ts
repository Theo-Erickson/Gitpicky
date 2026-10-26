import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Settings {
  recentRepos: string[];
}

const DEFAULTS: Settings = { recentRepos: [] };

export class SettingsStore {
  private data: Settings;

  constructor(private readonly file: string) {
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      this.data = { ...DEFAULTS };
    }
  }

  get recentRepos(): string[] {
    return this.data.recentRepos.slice();
  }

  rememberRepo(path: string): void {
    this.data.recentRepos = [path, ...this.data.recentRepos.filter((p) => p !== path)].slice(0, 10);
    this.save();
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
