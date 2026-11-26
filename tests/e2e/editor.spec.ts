import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { ELECTRON_RUN_AS_NODE: _runAsNode, ...electronEnv } = process.env;

test('open, edit, preview, save, conflict, and retain history across tabs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-e2e-'));
  const document = path.join(directory, 'notes.md');
  await writeFile(document, '# Hello\r\n\r\n- [ ] A task\r\n');
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js'), document],
    env: { ...electronEnv, MARKSCAPE_USER_DATA: path.join(directory, 'profile') },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('tab', { name: 'notes.md' })).toBeVisible();
    await expect(page.locator('.preview-scroll h1')).toHaveText('Hello');
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.type('\nA new paragraph');
    await expect(page.locator('.preview-scroll')).toContainText('A new paragraph');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => readFile(document, 'utf8')).toContain('A new paragraph\r\n');
    await page.getByRole('button', { name: '新建文档', exact: true }).last().click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('Draft preserved');
    await page.getByRole('tab', { name: 'notes.md' }).click();
    await expect(page.locator('.cm-content')).toContainText('A new paragraph');
    await page.getByRole('tab', { name: 'Untitled.md' }).click();
    await expect(page.locator('.cm-content')).toContainText('Draft preserved');
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('.cm-content')).not.toContainText('Draft preserved');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await expect(page.locator('.cm-content')).toContainText('Draft preserved');
    await page.getByRole('tab', { name: 'notes.md' }).click();
    await writeFile(document, '# External content\r\n');
    await expect(page.getByRole('alert')).toContainText('磁盘上的文件已改变');
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.locator('.preview-scroll h1')).toHaveText('External content');
    await page.screenshot({ path: 'test-results/editor.png' });
    expect(
      await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
    ).toBe('undefined');
  } finally {
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('welcome, settings, live preview, and untrusted Markdown remain usable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-ui-'));
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js')],
    env: { ...electronEnv, MARKSCAPE_USER_DATA: directory },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByText('给想法，一片自由的空间。')).toBeVisible();
    await page.screenshot({ path: 'test-results/welcome.png' });
    await page.getByRole('button', { name: '打开示例，探索 MarkScape' }).click();
    await expect(page.locator('.preview-scroll h1')).toContainText('给想法');
    await page.getByRole('button', { name: '即时预览', exact: true }).click();
    await expect(page.locator('.source-pane')).toBeVisible();
    await page.getByRole('button', { name: '分栏', exact: true }).click();
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('主题', { exact: true }).selectOption('dark');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: 'test-results/dark-editor.png' });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('exports highlighted code, formulas, diagrams and local images to standalone HTML and PDF', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-export-'));
  const filename = path.join(directory, 'export.md');
  await writeFile(
    filename,
    '# Export\n\n![pixel](pixel.png)\n\n$x^2$\n\n```typescript\nconst answer = 42;\n```\n\n```mermaid\ngraph LR\nA-->B\n```',
  );
  await writeFile(
    path.join(directory, 'pixel.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js'), filename],
    env: { ...electronEnv, MARKSCAPE_USER_DATA: path.join(directory, 'profile') },
  });
  try {
    await app.evaluate(({ dialog }, directory) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args[args.length - 1] as Electron.SaveDialogOptions;
        return { canceled: false, filePath: `${directory}/${options.defaultPath}` };
      }) as typeof dialog.showSaveDialog;
    }, directory);
    const page = await app.firstWindow();
    await expect(page.locator('.preview-scroll h1')).toHaveText('Export');
    await expect(page.locator('.preview-scroll pre[data-language] span')).not.toHaveCount(0);
    await expect(page.locator('.preview-scroll .mermaid-block svg')).toBeVisible({
      timeout: 15000,
    });
    await page.locator('.export-menu summary').click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect
      .poll(async () => readFile(path.join(directory, 'export.html'), 'utf8').catch(() => ''), {
        timeout: 30000,
      })
      .toContain('data:image/png;base64,');
    const html = await readFile(path.join(directory, 'export.html'), 'utf8');
    expect(html).toContain('<svg');
    expect(html).toContain('katex');
    expect(html).not.toContain('mdasset://');
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await readFile(path.join(directory, 'export.pdf')).catch(() => Buffer.alloc(0)))
            .subarray(0, 4)
            .toString(),
        { timeout: 30000 },
      )
      .toBe('%PDF');
  } finally {
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('recovers an unsaved draft after a crash and honors close cancellation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-recovery-'));
  const launch = () =>
    electron.launch({
      args: [path.join(process.cwd(), 'out/main/index.js')],
      env: { ...electronEnv, MARKSCAPE_USER_DATA: directory },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page
      .getByRole('button', { name: /新建文档/ })
      .last()
      .click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('Recover this precious draft');
    await expect
      .poll(async () => readFile(path.join(directory, 'session.json'), 'utf8').catch(() => ''), {
        timeout: 15000,
      })
      .toContain('Recover this precious draft');
    const stopped = app.waitForEvent('close');
    app.process().kill('SIGKILL');
    await stopped;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: '恢复文档', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('Recover this precious draft');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 2,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await page.getByRole('button', { name: '关闭 Untitled.md', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Untitled.md' })).toBeVisible();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await page.getByRole('button', { name: '关闭 Untitled.md', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Untitled.md' })).toHaveCount(0);
  } finally {
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('denies unauthorized IPC paths and unsafe links, including HTML passthrough', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-security-'));
  const forbidden = await mkdtemp(path.join(os.tmpdir(), 'markscape-private-'));
  const secret = path.join(forbidden, 'private.md');
  await writeFile(secret, 'not authorized');
  const filename = path.join(directory, 'untrusted.md');
  await writeFile(
    filename,
    '# Safe\n\n<script>window.pwned=true</script>\n\n<img src="x" onerror="window.pwned=true">\n\n<a href="javascript:alert(1)">bad</a>',
  );
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js'), filename],
    env: { ...electronEnv, MARKSCAPE_USER_DATA: path.join(directory, 'profile') },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.preview-scroll h1')).toHaveText('Safe');
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await page.getByLabel('允许 HTML（经安全过滤）').check();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(
      page.locator(
        '.preview-scroll script, .preview-scroll [onerror], .preview-scroll a[href^="javascript:"]',
      ),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned),
    ).toBeUndefined();
    expect(
      await page.evaluate(async (secret) => {
        try {
          await window.md.open(secret);
          return 'allowed';
        } catch (error) {
          return (error as { code: string }).code;
        }
      }, secret),
    ).toBe('ACCESS_DENIED');
    expect(
      await page.evaluate(async () => {
        try {
          await window.md.openExternal('javascript:alert(1)');
          return 'allowed';
        } catch {
          return 'denied';
        }
      }),
    ).toBe('denied');
  } finally {
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(forbidden, { recursive: true, force: true });
  }
});
