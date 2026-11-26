import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PathService } from '../../src/main/services/path-service';
import { WorkspaceService } from '../../src/main/services/workspace-service';
it('falls back to Node search, skips ignored folders, and reports source lines', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markscape-search-'));
  try {
    await writeFile(path.join(root, 'readme.md'), '# Title\nA needle\nNEEDLE again');
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'ignored.md'), 'needle');
    const paths = new PathService();
    await paths.grantDirectory(root);
    const service = new WorkspaceService(paths, null);
    service.root = root;
    expect((await service.list(root)).map((node) => node.name)).toEqual(['readme.md']);
    const result = await service.search('needle', false);
    expect(result.engine).toBe('node');
    expect(result.matches.map((match) => match.line)).toEqual([2, 3]);
    expect((await service.search('needle', true)).matches).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
