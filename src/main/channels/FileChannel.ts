/**
 * 文件通道：主进程中处理文件读写操作
 *
 * 使用 Node.js fs/promises，运行在主进程中。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IServerChannel } from '../../ipc/common/types';
import type {
  ReadFileOptions,
  WriteFileOptions,
  ExistsOptions,
  ListDirOptions,
  MkdirOptions,
  RemoveOptions,
  FileInfo,
} from '../../types/file';
import { BaseChannel } from '../../ipc/common/baseChannel';

class FileChannel extends BaseChannel {
  constructor() {
    super();
    this.onCommand('readFile', this.handleReadFile);
    this.onCommand('writeFile', this.handleWriteFile);
    this.onCommand('exists', this.handleExists);
    this.onCommand('stat', this.handleStat);
    this.onCommand('listDir', this.handleListDir);
    this.onCommand('mkdir', this.handleMkdir);
    this.onCommand('remove', this.handleRemove);
  }

  private handleReadFile = async (_ctx: string, arg: unknown): Promise<string | number[]> => {
    const { path: filePath, encoding = 'utf-8' } = arg as ReadFileOptions;
    console.log(`[FileChannel] readFile: ${filePath}`);
    if (encoding === null) {
      const buffer = await fs.readFile(filePath);
      return Array.from(buffer);
    }
    return fs.readFile(filePath, { encoding: encoding as BufferEncoding });
  };

  private handleWriteFile = async (_ctx: string, arg: unknown): Promise<void> => {
    const { path: filePath, content, encoding = 'utf-8', append = false } = arg as WriteFileOptions;
    console.log(`[FileChannel] writeFile: ${filePath} (append=${append})`);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    if (Array.isArray(content)) {
      const buffer = Buffer.from(content);
      if (append) await fs.appendFile(filePath, buffer);
      else await fs.writeFile(filePath, buffer);
    } else {
      if (append) await fs.appendFile(filePath, content, { encoding: encoding as BufferEncoding });
      else await fs.writeFile(filePath, content, { encoding: encoding as BufferEncoding });
    }
  };

  private handleExists = async (_ctx: string, arg: unknown): Promise<boolean> => {
    const { path: filePath } = arg as ExistsOptions;
    try { await fs.access(filePath); return true; } catch { return false; }
  };

  private handleStat = async (_ctx: string, arg: unknown): Promise<FileInfo> => {
    const { path: filePath } = arg as ExistsOptions;
    const stat = await fs.stat(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
    };
  };

  private handleListDir = async (_ctx: string, arg: unknown): Promise<FileInfo[]> => {
    const { path: dirPath, recursive = false } = arg as ListDirOptions;
    console.log(`[FileChannel] listDir: ${dirPath} (recursive=${recursive})`);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result: FileInfo[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const stat = await fs.stat(fullPath);
      result.push({
        name: entry.name,
        path: fullPath,
        size: stat.size,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
      if (recursive && entry.isDirectory()) {
        const children = await this.handleListDir(_ctx, { path: fullPath, recursive: true });
        result.push(...(children as FileInfo[]));
      }
    }
    return result;
  };

  private handleMkdir = async (_ctx: string, arg: unknown): Promise<void> => {
    const { path: dirPath, recursive = true } = arg as MkdirOptions;
    console.log(`[FileChannel] mkdir: ${dirPath}`);
    await fs.mkdir(dirPath, { recursive });
  };

  private handleRemove = async (_ctx: string, arg: unknown): Promise<void> => {
    const { path: filePath, recursive = false } = arg as RemoveOptions;
    console.log(`[FileChannel] remove: ${filePath} (recursive=${recursive})`);
    await fs.rm(filePath, { recursive, force: true });
  };
}

export function createFileChannel(): IServerChannel<string> {
  return new FileChannel();
}
