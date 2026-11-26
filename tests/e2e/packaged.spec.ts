import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const binary =
  process.platform === 'darwin'
    ? 'dist/mac-arm64/MarkScape.app/Contents/MacOS/MarkScape'
    : process.platform === 'win32'
      ? 'dist/win-unpacked/MarkScape.exe'
      : 'dist/linux-unpacked/markscape';
test('packaged application starts and edits without development dependencies', async () => {
  test.skip(!existsSync(binary), 'Build a local directory package first');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-packaged-'));
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(binary),
    args: [],
    env: { ...env, MARKSCAPE_USER_DATA: directory },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('给想法，一片自由的空间。')).toBeVisible();
    const workspace = page.getByRole('main');
    const expandedWidth = await workspace.evaluate((element) => element.clientWidth);
    await page.getByRole('button', { name: '收起侧栏' }).click();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
    await expect(page.locator('#workspace-sidebar')).toBeHidden();
    expect(await workspace.evaluate((element) => element.clientWidth)).toBeGreaterThan(
      expandedWidth,
    );
    await page.reload();
    await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();
    await page.getByRole('button', { name: '打开示例，探索 MarkScape' }).click();
    await expect(page.locator('.preview-scroll h1')).toContainText('给想法');
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.type('\nPackaged application works.');
    await expect(page.locator('.preview-scroll')).toContainText('Packaged application works.');
    await page.getByRole('button', { name: '展开侧栏' }).click();
    await expect(page.locator('#workspace-sidebar')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('Packaged application works.');
  } finally {
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
