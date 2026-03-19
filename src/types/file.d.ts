/**
 * 文件操作相关类型定义
 */

/** 文件编码 */
export type FileEncoding = 'utf-8' | 'utf8' | 'ascii' | 'base64' | 'binary' | 'hex' | 'latin1';

/** 读取文件选项 */
export interface ReadFileOptions {
  /** 文件路径（绝对路径） */
  path: string;
  /** 编码，默认 utf-8；传 null 返回 number[]（二进制） */
  encoding?: FileEncoding | null;
}

/** 写入文件选项 */
export interface WriteFileOptions {
  /** 文件路径（绝对路径） */
  path: string;
  /** 文件内容 */
  content: string | number[];
  /** 编码，默认 utf-8 */
  encoding?: FileEncoding;
  /** 是否追加模式，默认 false（覆盖写入） */
  append?: boolean;
}

/** 文件信息 */
export interface FileInfo {
  /** 文件名 */
  name: string;
  /** 绝对路径 */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 是否为文件 */
  isFile: boolean;
  /** 创建时间（ISO 字符串） */
  createdAt: string;
  /** 修改时间（ISO 字符串） */
  modifiedAt: string;
}

/** 目录列表选项 */
export interface ListDirOptions {
  /** 目录路径 */
  path: string;
  /** 是否递归，默认 false */
  recursive?: boolean;
}

/** 文件存在性检查 */
export interface ExistsOptions {
  /** 文件或目录路径 */
  path: string;
}

/** 删除文件/目录选项 */
export interface RemoveOptions {
  /** 文件或目录路径 */
  path: string;
  /** 是否递归删除目录，默认 false */
  recursive?: boolean;
}

/** 创建目录选项 */
export interface MkdirOptions {
  /** 目录路径 */
  path: string;
  /** 是否递归创建，默认 true */
  recursive?: boolean;
}

/**
 * File Channel 接口（渲染进程调用）
 */
export interface IFileChannel {
  call(command: 'readFile', arg: ReadFileOptions): Promise<string | number[]>;
  call(command: 'writeFile', arg: WriteFileOptions): Promise<void>;
  call(command: 'exists', arg: ExistsOptions): Promise<boolean>;
  call(command: 'stat', arg: ExistsOptions): Promise<FileInfo>;
  call(command: 'listDir', arg: ListDirOptions): Promise<FileInfo[]>;
  call(command: 'mkdir', arg: MkdirOptions): Promise<void>;
  call(command: 'remove', arg: RemoveOptions): Promise<void>;
  call<T = unknown>(
    command: string,
    arg?: unknown,
    cancellationToken?: import('../ipc/common/types').CancellationToken,
  ): Promise<T>;
  listen<T = unknown>(event: string, arg?: unknown): import('../ipc/common/types').IEvent<T>;
}
