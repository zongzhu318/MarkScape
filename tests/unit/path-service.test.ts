import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PathService, within } from '../../src/main/services/path-service';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'markscape-paths-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('rejects sibling-prefix traversal and symlink escapes', async () => {
  const allowed = path.join(root, 'workspace');
  const denied = path.join(root, 'workspace-secret');
  await mkdir(allowed);
  await mkdir(denied);
  await writeFile(path.join(denied, 'secret.md'), 'secret');
  const service = new PathService();
  await service.grantDirectory(allowed);
  expect(within(allowed, denied)).toBe(false);
  await expect(
    service.check(path.join(allowed, '..', 'workspace-secret', 'secret.md')),
  ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await symlink(
    denied,
    path.join(allowed, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(service.check(path.join(allowed, 'escape', 'secret.md'))).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
  await expect(service.check(path.join(allowed, 'escape', 'new.md'), true)).rejects.toMatchObject({
    code: 'ACCESS_DENIED',
  });
});
it('allows new files only under a canonical authorized parent', async () => {
  const service = new PathService();
  await service.grantDirectory(root);
  expect(await service.check(path.join(root, 'new.md'), true)).toContain('new.md');
  await expect(service.check('relative.md')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
});
