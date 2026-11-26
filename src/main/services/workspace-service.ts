import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { SearchMatch, TreeNode } from '../../shared/types';
import { AppError } from '../../shared/errors';
import type { PathService } from './path-service';
import { decodeBuffer, detectEncoding } from './file-service';

const ignored = new Set(['.git', 'node_modules', '.DS_Store', 'dist', 'out', '.idea']);
const markdown = /\.(md|markdown|mdown|mkd|txt)$/i;
export class WorkspaceService {
  root: string | null = null;
  private generation = 0;
  private process: ChildProcess | null = null;
  constructor(
    private paths: PathService,
    private rgPath: string | null,
  ) {}
  async list(directory: string): Promise<TreeNode[]> {
    const canonical = await this.paths.check(directory);
    const entries = await readdir(canonical, { withFileTypes: true });
    const nodes: TreeNode[] = [];
    for (const entry of entries.slice(0, 50000)) {
      if (
        ignored.has(entry.name) ||
        entry.isSymbolicLink() ||
        (!entry.isDirectory() && !markdown.test(entry.name))
      )
        continue;
      nodes.push({
        name: entry.name,
        path: path.join(canonical, entry.name),
        directory: entry.isDirectory(),
      });
    }
    return nodes.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
  }
  cancel(): void {
    this.generation++;
    this.process?.kill();
    this.process = null;
  }
  async search(
    query: string,
    caseSensitive: boolean,
  ): Promise<{ matches: SearchMatch[]; truncated: boolean; engine: string }> {
    this.cancel();
    const generation = this.generation;
    if (!this.root) throw new AppError('NO_WORKSPACE', '请先打开文件夹');
    if (!query) return { matches: [], truncated: false, engine: 'node' };
    const root = await this.paths.check(this.root);
    if (this.rgPath) {
      try {
        return await this.ripgrep(root, query, caseSensitive, generation);
      } catch {
        if (generation !== this.generation)
          return { matches: [], truncated: false, engine: 'cancelled' };
      }
    }
    const matches: SearchMatch[] = [];
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const pending = [root];
    let scanned = 0;
    while (
      pending.length &&
      generation === this.generation &&
      matches.length < 500 &&
      scanned < 50000
    ) {
      const directory = pending.pop()!;
      for (const node of await this.list(directory).catch(() => [])) {
        if (generation !== this.generation || matches.length >= 500) break;
        if (node.directory) {
          pending.push(node.path);
          continue;
        }
        scanned++;
        const info = await stat(node.path).catch(() => null);
        if (!info || info.size > 5 * 1024 * 1024) continue;
        const canonical = await this.paths.check(node.path).catch(() => null);
        if (!canonical) continue;
        const bytes = await readFile(canonical).catch(() => null);
        if (!bytes) continue;
        const lines = decodeBuffer(bytes, detectEncoding(bytes).encoding).split(/\r?\n/);
        let count = 0;
        for (let i = 0; i < lines.length && count < 20 && matches.length < 500; i++) {
          if ((caseSensitive ? lines[i] : lines[i].toLocaleLowerCase()).includes(needle)) {
            matches.push({ path: canonical, line: i + 1, text: lines[i].slice(0, 500) });
            count++;
          }
        }
      }
    }
    return {
      matches: generation === this.generation ? matches : [],
      truncated: matches.length >= 500 || scanned >= 50000,
      engine: 'node',
    };
  }
  private ripgrep(
    root: string,
    query: string,
    caseSensitive: boolean,
    generation: number,
  ): Promise<{ matches: SearchMatch[]; truncated: boolean; engine: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.rgPath!,
        [
          '--json',
          '--fixed-strings',
          '--max-count',
          '20',
          '--max-filesize',
          '5M',
          '--glob',
          '*.{md,markdown,mdown,mkd,txt}',
          ...(caseSensitive ? [] : ['--ignore-case']),
          '--',
          query,
          root,
        ],
        { windowsHide: true },
      );
      this.process = child;
      const matches: SearchMatch[] = [];
      let buffer = '';
      let truncated = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          try {
            const item = JSON.parse(line) as {
              type: string;
              data: { path: { text: string }; line_number: number; lines: { text: string } };
            };
            if (item.type === 'match' && matches.length < 500)
              matches.push({
                path: item.data.path.text,
                line: item.data.line_number,
                text: item.data.lines.text.trimEnd().slice(0, 500),
              });
            if (matches.length >= 500) {
              truncated = true;
              child.kill();
            }
          } catch {
            /* ignore non-result line */
          }
        }
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (this.process === child) this.process = null;
        if (code && code > 1 && !truncated) reject(new Error('ripgrep failed'));
        else
          resolve({
            matches: generation === this.generation ? matches : [],
            truncated,
            engine: 'ripgrep',
          });
      });
    });
  }
}
