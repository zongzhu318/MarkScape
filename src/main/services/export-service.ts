import { BrowserWindow, dialog } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Settings } from '../../shared/types';
import type { PathService } from './path-service';
import { atomicWrite } from './file-service';

export const assetMime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};
export class ExportService {
  constructor(private paths: PathService) {}
  async export(
    owner: BrowserWindow,
    html: string,
    name: string,
    format: 'html' | 'pdf',
    settings: Settings,
  ): Promise<string | null> {
    const choice = await dialog.showSaveDialog(owner, {
      defaultPath: `${path.basename(name, path.extname(name))}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (choice.canceled || !choice.filePath) return null;
    // Assets are resolved through exactly the same authorization gate as preview.
    const assets = [...html.matchAll(/mdasset:\/\/local\/[^\s"'<>]+/g)].map((m) => m[0]);
    for (const asset of new Set(assets)) {
      try {
        const url = new URL(asset);
        const filename = await this.paths.check(decodeURIComponent(url.pathname.slice(1)));
        const mime = assetMime[path.extname(filename).toLowerCase()];
        if (!mime) continue;
        const bytes = await readFile(filename);
        if (bytes.length > 20 * 1024 * 1024) continue;
        html = html.split(asset).join(`data:${mime};base64,${bytes.toString('base64')}`);
      } catch {
        /* unauthorized/missing images remain unavailable */
      }
    }
    const csp =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
    html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${html}</body></html>`;
    if (format === 'html') {
      await atomicWrite(choice.filePath, Buffer.from(html));
      return choice.filePath;
    }
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        partition: `export-${Date.now()}`,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await window.webContents.printToPDF({
        pageSize: settings.export.pdfPageSize,
        printBackground: true,
        margins: { top: 0.79, bottom: 0.79, left: 0.79, right: 0.79 },
      });
      await atomicWrite(choice.filePath, pdf);
      return choice.filePath;
    } finally {
      window.destroy();
    }
  }
}
