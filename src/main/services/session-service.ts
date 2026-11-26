import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SessionSnapshot, Settings, SnapshotTab } from '../../shared/types';
import { defaultSettings } from '../../shared/defaults';
import { sessionSchema, settingsSchema } from '../../shared/schemas';
import { atomicWrite } from './file-service';

export class SessionService {
  settings: Settings = structuredClone(defaultSettings);
  recent: string[] = [];
  session: SessionSnapshot | null = null;
  private queue = Promise.resolve();
  constructor(private directory: string) {}
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try {
      this.settings = settingsSchema.parse(
        JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8')),
      );
    } catch {
      /* defaults */
    }
    try {
      const recent: unknown = JSON.parse(
        await readFile(path.join(this.directory, 'recent.json'), 'utf8'),
      );
      if (Array.isArray(recent))
        this.recent = recent
          .filter((p): p is string => typeof p === 'string' && path.isAbsolute(p))
          .slice(0, 20);
    } catch {
      /* first launch */
    }
    try {
      this.session = sessionSchema.parse(
        JSON.parse(await readFile(path.join(this.directory, 'session.json'), 'utf8')),
      );
    } catch {
      /* no session */
    }
  }
  private persist(name: string, data: unknown): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(data));
    const next = this.queue
      .catch(() => undefined)
      .then(() => atomicWrite(path.join(this.directory, name), bytes));
    this.queue = next;
    return next;
  }
  async setSettings(settings: Settings): Promise<Settings> {
    await this.persist('settings.json', settings);
    this.settings = settings;
    return settings;
  }
  async addRecent(filename: string): Promise<void> {
    this.recent = [filename, ...this.recent.filter((p) => p !== filename)].slice(0, 20);
    await this.persist('recent.json', this.recent);
  }
  async save(session: SessionSnapshot): Promise<void> {
    const copy = structuredClone(session);
    let budget = 200 * 1024 * 1024;
    for (const tab of [...copy.tabs].reverse()) {
      if (tab.text !== undefined) {
        budget -= Buffer.byteLength(tab.text);
        if (budget < 0) delete tab.text;
      }
    }
    await this.persist('session.json', copy);
    this.session = copy;
  }
  async recovery(): Promise<SnapshotTab[]> {
    const tabs: SnapshotTab[] = [];
    for (const tab of this.session?.tabs ?? []) {
      if (tab.text === undefined) continue;
      if (tab.path && tab.meta) {
        const info = await stat(tab.path).catch(() => null);
        // Keep divergent snapshots as untitled copies; never destroy recoverable work.
        if (!info || info.mtimeMs !== tab.meta.mtimeMs) {
          tabs.push({ ...tab, path: null, meta: null, name: `${tab.name} (恢复副本)` });
          continue;
        }
      }
      tabs.push(tab);
    }
    return tabs;
  }
  async clearRecovery(): Promise<void> {
    if (this.session)
      await this.save({
        ...this.session,
        tabs: this.session.tabs.map(({ text: _text, ...tab }) => tab),
      });
  }
}
