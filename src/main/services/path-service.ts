import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../shared/errors';

export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export class PathService {
  private roots = new Set<string>();
  async grantDirectory(directory: string): Promise<string> {
    const canonical = await realpath(directory);
    if (!(await stat(canonical)).isDirectory()) throw new AppError('EISDIR', '请选择文件夹');
    this.roots.add(canonical);
    return canonical;
  }
  async grantFile(filename: string): Promise<string> {
    const canonical = await realpath(filename);
    await this.grantDirectory(path.dirname(canonical));
    return canonical;
  }
  async check(filename: string, allowMissing = false): Promise<string> {
    if (!path.isAbsolute(filename) || filename.includes('\0'))
      throw new AppError('ACCESS_DENIED', '需要本地绝对路径');
    let canonical: string;
    try {
      canonical = await realpath(filename);
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      canonical = path.join(await realpath(path.dirname(filename)), path.basename(filename));
    }
    if (![...this.roots].some((root) => within(root, canonical)))
      throw new AppError('ACCESS_DENIED', '路径不在已授权的文档目录或工作区内');
    return canonical;
  }
}
