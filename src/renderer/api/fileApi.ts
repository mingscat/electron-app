/**
 * File API 模块：文件读写操作
 *
 * 请求通过 IPC 传递到主进程 FileChannel（Node.js fs），拥有完整文件系统权限。
 */
import type {
  IFileChannel,
  ReadFileOptions,
  WriteFileOptions,
  ListDirOptions,
  MkdirOptions,
  RemoveOptions,
  FileInfo,
  FileEncoding,
} from '../../types/file';

export class FileApi {
  constructor(private readonly channel: IFileChannel) {}

  /** 读取文本文件 */
  readText(path: string, encoding: FileEncoding = 'utf-8'): Promise<string> {
    return this.channel.call('readFile', { path, encoding }) as Promise<string>;
  }

  /** 读取二进制文件（返回 number[]） */
  readBinary(path: string): Promise<number[]> {
    return this.channel.call('readFile', { path, encoding: null }) as Promise<number[]>;
  }

  /** 读取文件（通用） */
  readFile(options: ReadFileOptions): Promise<string | number[]> {
    return this.channel.call('readFile', options);
  }

  /** 写入文本文件 */
  writeText(path: string, content: string, encoding: FileEncoding = 'utf-8'): Promise<void> {
    return this.channel.call('writeFile', { path, content, encoding });
  }

  /** 追加文本 */
  appendText(path: string, content: string, encoding: FileEncoding = 'utf-8'): Promise<void> {
    return this.channel.call('writeFile', { path, content, encoding, append: true });
  }

  /** 写入二进制文件 */
  writeBinary(path: string, content: number[]): Promise<void> {
    return this.channel.call('writeFile', { path, content });
  }

  /** 写入文件（通用） */
  writeFile(options: WriteFileOptions): Promise<void> {
    return this.channel.call('writeFile', options);
  }

  /** 检查文件/目录是否存在 */
  exists(path: string): Promise<boolean> {
    return this.channel.call('exists', { path });
  }

  /** 获取文件/目录信息 */
  stat(path: string): Promise<FileInfo> {
    return this.channel.call('stat', { path });
  }

  /** 列出目录内容 */
  listDir(path: string, recursive = false): Promise<FileInfo[]> {
    return this.channel.call('listDir', { path, recursive } as ListDirOptions);
  }

  /** 创建目录 */
  mkdir(path: string, recursive = true): Promise<void> {
    return this.channel.call('mkdir', { path, recursive } as MkdirOptions);
  }

  /** 删除文件或目录 */
  remove(path: string, recursive = false): Promise<void> {
    return this.channel.call('remove', { path, recursive } as RemoveOptions);
  }
}
