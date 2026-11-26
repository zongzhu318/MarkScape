import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, chmod, stat, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import iconv from 'iconv-lite';
import { FileService, detectEncoding, encodeText } from '../../src/main/services/file-service';
import { PathService } from '../../src/main/services/path-service';
import type { Encoding } from '../../src/shared/types';

let directory: string;
let service: FileService;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'markscape-files-'));
  const paths = new PathService();
  await paths.grantDirectory(directory);
  service = new FileService(paths);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('lossless file round trips', () => {
  for (const encoding of [
    'utf8',
    'utf8-bom',
    'gbk',
    'utf16le',
    'utf16be',
    'shift_jis',
  ] as Encoding[]) {
    for (const eol of ['\n', '\r\n'])
      for (const trailing of [false, true]) {
        it(`${encoding}, ${JSON.stringify(eol)}, trailing=${trailing}`, async () => {
          const original = `# Markdown${eol}${encoding === 'shift_jis' ? '日本語の文書' : '中文文档'}${trailing ? eol : ''}`;
          const bytes = iconv.encode(original, encoding === 'utf8-bom' ? 'utf8' : encoding, {
            addBOM: ['utf8-bom', 'utf16le', 'utf16be'].includes(encoding),
          });
          const filename = path.join(directory, 'sample.md');
          await writeFile(filename, bytes);
          const document = await service.read(filename);
          expect(document.meta.encoding).toBe(encoding);
          await service.save(document.text, document.meta);
          expect(await readFile(filename)).toEqual(bytes);
          const result = await service.save(
            document.text.replace('Markdown', 'MarkScape'),
            document.meta,
          );
          const changed = await readFile(filename);
          expect(iconv.decode(changed, encoding === 'utf8-bom' ? 'utf8' : encoding)).toBe(
            original.replace('Markdown', 'MarkScape'),
          );
          expect(result.encoding).toBe(encoding);
        });
      }
  }
  it('keeps mixed line endings byte-for-byte when unchanged', async () => {
    const filename = path.join(directory, 'mixed.md');
    const original = Buffer.from('# Title\r\n\nText\r\n\r\n');
    await writeFile(filename, original);
    const doc = await service.read(filename);
    await service.save(doc.text, doc.meta);
    expect(await readFile(filename)).toEqual(original);
  });
  it('detects BOM and BOM-less UTF-16 and rejects lossy legacy saves', () => {
    expect(detectEncoding(iconv.encode('Title\nContent', 'utf16le')).encoding).toBe('utf16le');
    expect(detectEncoding(iconv.encode('Title\nContent', 'utf16be')).encoding).toBe('utf16be');
    expect(detectEncoding(Buffer.from('\ufeff中文')).encoding).toBe('utf8-bom');
    expect(() =>
      encodeText('无法保存😀', {
        encoding: 'gbk',
        bom: false,
        eol: 'lf',
        hasTrailingNewline: false,
      }),
    ).toThrow(/UTF-8/);
  });
});
describe('save protection', () => {
  it.each(['utf8', 'gbk', 'utf16le', 'shift_jis'] as Encoding[])(
    'pages %s without duplicate or broken characters',
    async (encoding) => {
      const text = `${'A'.repeat(1024 * 1024 - 1)}${encoding === 'shift_jis' ? '日本語' : '中文'}\r\nend\r`;
      const filename = path.join(directory, 'paged.md');
      await writeFile(filename, iconv.encode(text, encoding));
      let offset: number | undefined = 0;
      let actual = '';
      while (offset !== undefined) {
        const page = await service.readPage(filename, offset, encoding);
        actual += page.text;
        offset = page.nextOffset;
      }
      expect(actual).toBe(text.replace(/\r\n?/g, '\n'));
    },
  );
  it('detects changes even within a one-second mtime window', async () => {
    const filename = path.join(directory, 'conflict.md');
    await writeFile(filename, 'before');
    const original = await service.read(filename);
    await writeFile(filename, 'external');
    await expect(service.save('my edit', original.meta)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await readFile(filename, 'utf8')).toBe('external');
  });
  it('rejects a deleted file instead of recreating it silently', async () => {
    const filename = path.join(directory, 'deleted.md');
    await writeFile(filename, 'before');
    const original = await service.read(filename);
    await rm(filename);
    await expect(service.save('my edit', original.meta)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains file permissions and cleans atomic-write temporary files', async () => {
    const filename = path.join(directory, 'atomic.md');
    await writeFile(filename, 'before');
    await chmod(filename, 0o640);
    const original = await service.read(filename);
    await service.save('after', original.meta);
    if (process.platform !== 'win32') expect((await stat(filename)).mode & 0o777).toBe(0o640);
    expect(await readdir(directory)).toEqual(['atomic.md']);
  });
  it('does not write to a read-only document', async () => {
    if (process.platform === 'win32') return;
    const filename = path.join(directory, 'readonly.md');
    await writeFile(filename, 'before');
    await chmod(filename, 0o444);
    const original = await service.read(filename);
    expect(original.meta.readonly).toBe(true);
    await expect(service.save('after', original.meta)).rejects.toMatchObject({ code: 'EACCES' });
  });
});

it('copies the complete paged file, even when a UTF-8 character crosses the first page boundary', async () => {
  const filename = path.join(directory, 'large.md');
  const destination = path.join(directory, 'copy.md');
  const pageSize = 1024 * 1024;
  const length = 51 * pageSize;
  const file = await open(filename, 'w');
  try {
    await file.write(Buffer.alloc(pageSize - 1, 65));
    await file.write('中文');
    await file.write(Buffer.from('END'), 0, 3, length - 3);
  } finally {
    await file.close();
  }
  const doc = await service.read(filename);
  expect(doc.meta).toMatchObject({ large: true, encoding: 'utf8' });
  expect(doc.nextOffset).toBe(pageSize - 1);
  const copy = await service.saveAs(destination, doc.text, doc.meta);
  expect(copy.size).toBe(length);
  expect(await service.readPage(destination, length - 3, 'utf8')).toEqual({ text: 'END' });
});

it('checks for conflicts when Save As selects the original document', async () => {
  const filename = path.join(directory, 'same.md');
  await writeFile(filename, 'original');
  const doc = await service.read(filename);
  await writeFile(filename, 'external change');
  await expect(service.saveAs(filename, 'my changes', doc.meta)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(await readFile(filename, 'utf8')).toEqual('external change');
});

it('preserves group write permission when replacing a shared file', async () => {
  if (process.platform === 'win32') return;
  const filename = path.join(directory, 'shared.md');
  await writeFile(filename, 'original');
  await chmod(filename, 0o664);
  const doc = await service.read(filename);
  await service.save('edit', doc.meta);
  expect((await stat(filename)).mode & 0o777).toBe(0o664);
});

it('still allows an explicit UTF-8 conversion when saving as the same unchanged path', async () => {
  const filename = path.join(directory, 'legacy.md');
  await writeFile(filename, iconv.encode('中文文档', 'gbk'));
  const doc = await service.read(filename, 'gbk');
  const meta = await service.saveAs(filename, doc.text + '😀', doc.meta);
  expect(meta.encoding).toBe('utf8');
  expect(await readFile(filename, 'utf8')).toBe('中文文档😀');
});
