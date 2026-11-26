import { isUtf8 } from 'node:buffer';
import { constants } from 'node:fs';
import { access, copyFile, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import type { Encoding, FileDoc, FileMeta } from '../../shared/types';
import { AppError } from '../../shared/errors';
import type { PathService } from './path-service';

const PAGE_SIZE = 1024 * 1024;
const MAX_EDIT_SIZE = 50 * 1024 * 1024;
export function detectEncoding(
  buffer: Buffer,
  partial = false,
): { encoding: Encoding; bom: boolean } {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    return { encoding: 'utf8-bom', bom: true };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { encoding: 'utf16le', bom: true };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { encoding: 'utf16be', bom: true };
  // Detect BOM-less UTF-16 before UTF-8: NUL bytes are valid UTF-8 too.
  const sample = buffer.subarray(0, 4096);
  let even = 0,
    odd = 0;
  for (let i = 0; i < sample.length; i++)
    if (sample[i] === 0) {
      if (i % 2) odd++;
      else even++;
    }
  if (odd > sample.length / 5) return { encoding: 'utf16le', bom: false };
  if (even > sample.length / 5) return { encoding: 'utf16be', bom: false };
  if (isUtf8(buffer)) return { encoding: 'utf8', bom: false };
  if (partial) {
    try {
      // A valid UTF-8 character may straddle the page boundary.
      new TextDecoder('utf-8', { fatal: true }).decode(buffer, { stream: true });
      return { encoding: 'utf8', bom: false };
    } catch {
      /* legacy encoding */
    }
  }
  const detection = jschardet.detect(buffer);
  const detected = detection.encoding?.toLowerCase().replace(/[-_]/g, '') ?? '';
  // Short East Asian documents are often misclassified as a Western single-byte codec.
  // Recognize lossless Japanese text with full-width kana before the GBK fallback.
  if (!/shiftjis|sjis|gb|utf16/.test(detected) || detection.confidence < 0.5) {
    const japanese = iconv.decode(buffer, 'shift_jis');
    const kana = japanese.match(/[\u3040-\u30ff]/g)?.length ?? 0;
    const halfwidth = japanese.match(/[\uff61-\uff9f]/g)?.length ?? 0;
    if (kana > 0 && kana > halfwidth && iconv.encode(japanese, 'shift_jis').equals(buffer))
      return { encoding: 'shift_jis', bom: false };
  }
  return {
    encoding: /shiftjis|sjis/.test(detected)
      ? 'shift_jis'
      : /utf16be/.test(detected)
        ? 'utf16be'
        : /utf16le/.test(detected)
          ? 'utf16le'
          : 'gbk',
    bom: false,
  };
}
export function decodeBuffer(buffer: Buffer, encoding: Encoding): string {
  return iconv.decode(buffer, encoding === 'utf8-bom' ? 'utf8' : encoding);
}
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
export function encodeText(
  text: string,
  meta: Pick<FileMeta, 'encoding' | 'bom' | 'eol' | 'hasTrailingNewline'>,
): Buffer {
  let normalized = normalizeText(text);
  if (meta.hasTrailingNewline) {
    if (!normalized.endsWith('\n')) normalized += '\n';
  } else normalized = normalized.replace(/\n+$/, '');
  const output = meta.eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
  const encoding = meta.encoding === 'utf8-bom' ? 'utf8' : meta.encoding;
  const bytes = iconv.encode(output, encoding, {
    addBOM: meta.bom || meta.encoding === 'utf8-bom',
  });
  if (decodeBuffer(bytes, meta.encoding) !== output)
    throw new AppError('ENCODING_LOSS', '当前编码无法保存部分字符，请另存为 UTF-8');
  return bytes;
}
export async function atomicWrite(
  filename: string,
  bytes: Buffer,
  mode?: number,
  beforeReplace?: () => Promise<void>,
): Promise<void> {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', mode ?? 0o600);
    await handle.writeFile(bytes);
    if (mode !== undefined) await handle.chmod(mode & 0o777);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await beforeReplace?.();
    await rename(temporary, filename);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}
function revision(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
function completePage(
  bytes: Buffer,
  encoding: Encoding,
  offset: number,
): { text: string; consumed: number } {
  const codec = encoding === 'utf8-bom' ? 'utf8' : encoding;
  const decoder = iconv.getDecoder(codec, { stripBOM: offset === 0 });
  // Streaming decode withholds incomplete multibyte characters until the next page.
  let text = decoder.write(bytes);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  // Count only a signature stripped by this decoder, including encoding overrides.
  let bomLength = 0;
  if (offset === 0) {
    if (codec === 'utf8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      bomLength = 3;
    if (codec === 'utf16le' && bytes[0] === 0xff && bytes[1] === 0xfe) bomLength = 2;
    if (codec === 'utf16be' && bytes[0] === 0xfe && bytes[1] === 0xff) bomLength = 2;
  }
  let consumed = iconv.encode(text, codec).length + bomLength;
  // Keep CRLF together across page boundaries.
  if (text.endsWith('\r')) {
    text = text.slice(0, -1);
    consumed -= codec.startsWith('utf16') ? 2 : 1;
  }
  return { text: normalizeText(text), consumed: Math.min(bytes.length, consumed) };
}
export class FileService {
  private saving = new Set<string>();
  constructor(private paths: PathService) {}
  async read(filename: string, override?: Encoding): Promise<FileDoc> {
    const canonical = await this.paths.check(filename);
    const info = await stat(canonical);
    if (!info.isFile()) throw new AppError('EISDIR', '此路径不是文件');
    const large = info.size > MAX_EDIT_SIZE;
    let bytes: Buffer;
    if (large) {
      const file = await open(canonical, 'r');
      try {
        bytes = Buffer.alloc(PAGE_SIZE);
        const result = await file.read(bytes, 0, PAGE_SIZE, 0);
        bytes = bytes.subarray(0, result.bytesRead);
      } finally {
        await file.close();
      }
    } else bytes = await readFile(canonical);
    const detected = detectEncoding(bytes, large);
    const encoding = override ?? detected.encoding;
    const raw = decodeBuffer(bytes, encoding);
    const page = large ? completePage(bytes, encoding, 0) : null;
    let eol: FileMeta['eol'] = process.platform === 'win32' ? 'crlf' : 'lf';
    if (raw.includes('\n')) {
      eol = 'lf';
      if (raw.includes('\r')) {
        let crlf = 0,
          lf = 0;
        for (let i = raw.indexOf('\n'); i !== -1; i = raw.indexOf('\n', i + 1)) {
          if (raw[i - 1] === '\r') crlf++;
          else lf++;
        }
        if (crlf > lf) eol = 'crlf';
      }
    }
    const writable =
      (info.mode & 0o222) !== 0 &&
      (await access(canonical, constants.W_OK).then(
        () => true,
        () => false,
      ));
    return {
      text: page?.text ?? normalizeText(raw),
      meta: {
        path: canonical,
        mtimeMs: info.mtimeMs,
        size: info.size,
        revision: revision(bytes),
        encoding,
        bom: detected.bom,
        eol,
        hasTrailingNewline: /\r?\n$/.test(raw),
        readonly: large || !writable,
        large,
      },
      ...(page ? { nextOffset: page.consumed } : {}),
    };
  }
  async readPage(
    filename: string,
    offset: number,
    encoding: Encoding,
  ): Promise<{ text: string; nextOffset?: number }> {
    const canonical = await this.paths.check(filename);
    const info = await stat(canonical);
    const file = await open(canonical, 'r');
    try {
      const bytes = Buffer.alloc(PAGE_SIZE);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
      const page =
        offset + bytesRead >= info.size
          ? {
              text: normalizeText(decodeBuffer(bytes.subarray(0, bytesRead), encoding)),
              consumed: bytesRead,
            }
          : completePage(bytes.subarray(0, bytesRead), encoding, offset);
      const next = offset + page.consumed;
      return { text: page.text, ...(next < info.size ? { nextOffset: next } : {}) };
    } finally {
      await file.close();
    }
  }
  async save(text: string, expected: FileMeta): Promise<FileMeta> {
    return this.replaceDocument(text, expected, false);
  }
  private async replaceDocument(
    text: string,
    expected: FileMeta,
    saveAsUtf8: boolean,
  ): Promise<FileMeta> {
    const canonical = await this.paths.check(expected.path);
    if (this.saving.has(canonical)) throw new AppError('BUSY', '文件正在保存，请稍后重试');
    this.saving.add(canonical);
    try {
      const current = await this.read(canonical, expected.encoding);
      if (current.meta.readonly) throw new AppError('EACCES', '文件为只读');
      if (current.meta.revision !== expected.revision || current.meta.mtimeMs !== expected.mtimeMs)
        throw new AppError('CONFLICT', '文件已被其他程序修改，请重新加载或另存为副本');
      // Byte-for-byte preservation, including mixed EOLs, on a no-op save.
      if (!saveAsUtf8 && text === current.text) return current.meta;
      const bytes = saveAsUtf8
        ? Buffer.from(normalizeText(text), 'utf8')
        : encodeText(text, expected);
      const latest = await stat(canonical);
      if (latest.mtimeMs !== current.meta.mtimeMs || latest.size !== current.meta.size)
        throw new AppError('CONFLICT', '保存期间文件发生了变化');
      await atomicWrite(canonical, bytes, latest.mode, async () => {
        const atCommit = await stat(canonical);
        if (
          atCommit.ino !== latest.ino ||
          atCommit.ctimeMs !== latest.ctimeMs ||
          atCommit.size !== latest.size
        )
          throw new AppError('CONFLICT', '保存期间文件发生了变化');
      });
      const saved = (await this.read(canonical, saveAsUtf8 ? 'utf8' : expected.encoding)).meta;
      const committed = saved.large ? bytes.subarray(0, PAGE_SIZE) : bytes;
      if (saved.size !== bytes.length || saved.revision !== revision(committed))
        throw new AppError('CONFLICT', '保存后文件已被其他程序修改');
      return saved;
    } finally {
      this.saving.delete(canonical);
    }
  }
  async saveAs(filename: string, text: string, source?: FileMeta): Promise<FileMeta> {
    const canonical = await this.paths.check(filename, true);
    if (source && canonical === source.path) return this.replaceDocument(text, source, true);
    const existing = await stat(canonical).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing && !existing.isFile()) throw new AppError('EISDIR', '目标不是文件');
    if (source?.large) {
      const original = await this.paths.check(source.path);
      const temporary = path.join(path.dirname(canonical), `.markscape-${randomUUID()}.tmp`);
      try {
        await copyFile(original, temporary, constants.COPYFILE_EXCL);
        await rename(temporary, canonical);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return (await this.read(canonical, source.encoding)).meta;
    }
    await atomicWrite(canonical, Buffer.from(normalizeText(text), 'utf8'), existing?.mode);
    return (await this.read(canonical, 'utf8')).meta;
  }
}
