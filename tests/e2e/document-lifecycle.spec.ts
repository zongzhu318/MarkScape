import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;

async function withEditor(
  run: (app: Awaited<ReturnType<typeof electron.launch>>, directory: string) => Promise<void>,
  prepare?: (directory: string) => Promise<void>,
  startupFile?: string,
) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'markscape-lifecycle-')));
  try {
    await prepare?.(directory);
    const app = await electron.launch({
      args: [
        path.resolve('out/main/index.js'),
        ...(startupFile ? [path.join(directory, startupFile)] : []),
      ],
      env: { ...env, MARKSCAPE_USER_DATA: path.join(directory, 'profile') },
    });
    try {
      await run(app, directory);
    } finally {
      await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('first save enables image paste, opening a draft auto-saves, and Save As protects other open tabs', async () => {
  await withEditor(async (app, directory) => {
    const page = await app.firstWindow();
    const create = page.getByRole('button', { name: '新建文档', exact: true }).last();
    const filename = path.join(directory, 'first.md');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, filename);
    await create.click();
    await page.locator('.cm-content').fill('first');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'first.md' })).toBeVisible();
    await page.locator('.cm-content').evaluate((element) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        ),
        (c) => c.charCodeAt(0),
      );
      transfer.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.locator('.cm-content')).toContainText('assets/image-');
    await create.click();
    await expect.poll(() => readFile(filename, 'utf8')).toContain('assets/image-');
    const saved = await readFile(filename, 'utf8');
    await page.locator('.cm-content').fill('other draft');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('其他标签');
    expect(await readFile(filename, 'utf8')).toBe(saved);
    await expect(page.locator('.cm-content')).toContainText('other draft');
  });
});

test('opening a saved tab at launch retains its view, tab order and focus', async () => {
  const names = ['first.md', 'second.md', 'requested.md'];
  await withEditor(
    async (app) => {
      const page = await app.firstWindow();
      const tabs = page.getByRole('tab');
      await expect(tabs).toHaveCount(names.length);
      for (const [index, name] of names.entries())
        await expect(tabs.nth(index)).toContainText(name);
      await expect(page.locator('.editing-area')).toHaveClass(/mode-preview/);
      await expect(page.locator('.preview-scroll h1')).toHaveText('requested.md');
    },
    async (directory) => {
      const profile = path.join(directory, 'profile');
      await mkdir(profile);
      for (const name of names) await writeFile(path.join(directory, name), '# ' + name);
      await writeFile(
        path.join(profile, 'session.json'),
        JSON.stringify({
          root: null,
          activeId: names[0],
          savedAt: Date.now(),
          tabs: names.map((name) => ({
            id: name,
            name,
            path: path.join(directory, name),
            meta: null,
            cursor: 0,
            scrollTop: 0,
            viewMode: name === 'requested.md' ? 'preview' : 'split',
          })),
        }),
      );
    },
    'requested.md',
  );
});

test('recovery keeps a same-mtime external revision and the draft in separate documents', async () => {
  await withEditor(
    async (app, directory) => {
      const page = await app.firstWindow();
      await page.getByRole('button', { name: '恢复文档', exact: true }).click();
      await expect(page.getByRole('tab')).toHaveCount(2);
      await expect(page.locator('.cm-content')).toContainText('unsaved work');
      await page.getByRole('tab', { name: 'notes.md', exact: true }).click();
      await expect(page.locator('.cm-content')).toContainText('external');
      expect(await readFile(path.join(directory, 'notes.md'), 'utf8')).toBe('external');
    },
    async (directory) => {
      const filename = path.join(directory, 'notes.md');
      const profile = path.join(directory, 'profile');
      await mkdir(profile);
      await writeFile(filename, 'external');
      const info = await stat(filename);
      const meta = {
        path: filename,
        mtimeMs: info.mtimeMs,
        size: info.size,
        revision: '0'.repeat(64),
        encoding: 'utf8',
        bom: false,
        eol: 'lf',
        hasTrailingNewline: false,
        readonly: false,
        large: false,
      };
      await writeFile(
        path.join(profile, 'session.json'),
        JSON.stringify({
          root: null,
          activeId: 'old',
          savedAt: Date.now(),
          tabs: [
            {
              id: 'old',
              path: filename,
              meta,
              name: 'notes.md',
              text: 'unsaved work',
              cursor: 0,
              scrollTop: 0,
              viewMode: 'split',
            },
          ],
        }),
      );
    },
  );
});

test('paged viewer keeps source mode and copies the full file from a later page', async () => {
  await withEditor(async (app, directory) => {
    const source = path.join(directory, 'large.md');
    const target = path.join(directory, 'copy.md');
    const file = await open(source, 'w');
    try {
      // Keep both viewed pages representative of text. The untouched tail may remain sparse.
      await file.write(Buffer.from('Markdown notes. '.repeat(131072)));
      await file.write(Buffer.from('first page\n'), 0, 11, 0);
      await file.write(Buffer.from('second page\n'), 0, 12, 1024 * 1024);
      await file.write(Buffer.from('last bytes'), 0, 10, 51 * 1024 * 1024);
    } finally {
      await file.close();
    }
    const page = await app.firstWindow();
    await expect(page.getByText('给想法，一片自由的空间。')).toBeVisible();
    await app.evaluate(
      ({ BrowserWindow, dialog }, { source, target }) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
        BrowserWindow.getAllWindows()[0].webContents.send('event:command', 'open');
      },
      { source, target },
    );
    await expect(page.getByRole('tab', { name: 'large.md' })).toBeVisible();
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page.getByRole('button', { name: '上一页' })).toBeVisible();
    const command = (value: string) =>
      app.evaluate(
        ({ BrowserWindow }, value) =>
          BrowserWindow.getAllWindows()[0].webContents.send('event:command', value),
        value,
      );
    await command('view');
    await expect(page.locator('.editing-area')).toHaveClass(/mode-source/);
    await command('exportHtml');
    await expect(page.getByRole('status')).toContainText('分页');
    await command('save');
    await command('saveAs');
    await expect(page.getByRole('tab', { name: 'copy.md' })).toBeVisible();
    expect((await stat(target)).size).toBe((await stat(source)).size);
  });
});
