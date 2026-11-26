import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionService } from '../../src/main/services/session-service';
import { FileService } from '../../src/main/services/file-service';
import { PathService } from '../../src/main/services/path-service';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'markscape-session-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('recovers drafts after restart and preserves divergent disk versions as copies', async () => {
  const filename = path.join(root, 'notes.md');
  await writeFile(filename, 'original');
  const paths = new PathService();
  await paths.grantDirectory(root);
  const file = await new FileService(paths).read(filename);
  const service = new SessionService(root);
  await service.initialize();
  await service.save({
    tabs: [
      {
        id: 'one',
        path: filename,
        name: 'notes.md',
        text: 'unsaved work',
        meta: file.meta,
        cursor: 4,
        scrollTop: 0,
        viewMode: 'split',
      },
    ],
    activeId: 'one',
    root: null,
    savedAt: Date.now(),
  });
  await writeFile(filename, 'new disk content');
  const restarted = new SessionService(root);
  await restarted.initialize();
  const recovery = await restarted.recovery();
  expect(recovery[0].path).toBeNull();
  expect(recovery[0].text).toBe('unsaved work');
  await restarted.clearRecovery();
  expect(await restarted.recovery()).toEqual([]);
});
it('serializes concurrent persistence and bounds the recent list', async () => {
  const service = new SessionService(root);
  await service.initialize();
  await Promise.all(
    Array.from({ length: 30 }, (_, index) => service.addRecent(path.join(root, `${index}.md`))),
  );
  const restarted = new SessionService(root);
  await restarted.initialize();
  expect(restarted.recent).toHaveLength(20);
  expect(restarted.recent[0]).toContain('29.md');
});
