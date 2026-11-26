import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
/* global document */
import console from 'node:console';
import { performance } from 'node:perf_hooks';

const runs = Number(process.argv[2] || 7);
if (!Number.isInteger(runs) || runs < 1) throw new Error('Expected a positive number of runs');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const root = await mkdtemp(path.join(tmpdir(), 'markscape-open-'));
const small = path.join(root, 'small.md');
const large = path.join(root, 'large.md');
const metrics = [];
try {
  await writeFile(small, '# Small\n\nDraft.\n');
  const paragraph = 'Markdown 文档用于测量打开和预览耗时。'.repeat(5);
  await writeFile(
    large,
    '# Large\n\n' +
      Array.from({ length: 1250 }, (_, i) => '## Section ' + i + '\n\n' + paragraph + '\n\n').join(
        '',
      ),
  );
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const app = await electron.launch({
      args: [path.resolve('out/main/index.js'), small],
      env: { ...env, MARKSCAPE_USER_DATA: path.join(root, 'profile-' + i) },
    });
    try {
      const page = await app.firstWindow();
      const editor = (title) =>
        page.waitForFunction(
          (title) =>
            document
              .querySelector('.cm-content[contenteditable="true"]')
              ?.textContent.includes(title),
          title,
        );
      const preview = (title) =>
        page.waitForFunction(
          (title) => document.querySelector('.preview-scroll h1')?.textContent === title,
          title,
        );
      await editor('Small');
      const startupEditor = performance.now() - start;
      await preview('Small');
      const startupPreview = performance.now() - start;
      await app.evaluate(({ dialog }, filename) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
      }, large);
      const open = performance.now();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.send('event:command', 'open'),
      );
      await editor('Large');
      const openEditor = performance.now() - open;
      await preview('Large');
      metrics.push(
        [startupEditor, startupPreview, openEditor, performance.now() - open].map(Math.round),
      );
    } finally {
      await Promise.all([app.waitForEvent('close'), app.evaluate(({ app }) => app.exit(0))]);
    }
  }
  const median = metrics[0].map((_, i) => {
    const sorted = metrics.map((values) => values[i]).sort((a, b) => a - b);
    return (sorted[Math.floor((runs - 1) / 2)] + sorted[Math.floor(runs / 2)]) / 2;
  });
  console.log(
    JSON.stringify({
      bytes: (await stat(large)).size,
      runs,
      ms: ['launchToEditor', 'launchToPreview', 'openToEditor', 'openToPreview'],
      samples: metrics,
      median,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
