/**
 * 后台窗口相关类型定义
 */

export interface BackgroundTaskResult {
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp?: number;
}

export interface BackgroundTaskRequest {
  taskName: string;
  args: unknown[];
}

export interface CreateBackgroundWindowResult {
  success: boolean;
  windowId: number;
  /** 是否为新建窗口（false 表示返回了现有窗口） */
  isNew: boolean;
}

export interface DestroyBackgroundWindowResult {
  success: boolean;
}

/**
 * 后台任务处理器
 */
export type BackgroundTaskHandler = (...args: unknown[]) => Promise<unknown>;

/**
 * 后台窗口管理器接口
 */
export interface IBackgroundWindowManager {
  createBackgroundWindow(): Electron.BrowserWindow;
  getBackgroundWindow(): Electron.BrowserWindow | null;
  destroyBackgroundWindow(): void;
  executeBackgroundTask(taskName: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * 后台窗口 IPC Channel 接口
 */
export interface IBackgroundChannel {
  call(command: 'createBackgroundWindow'): Promise<CreateBackgroundWindowResult>;
  call(command: 'executeTask', arg: BackgroundTaskRequest): Promise<unknown>;
  call(command: 'destroyBackgroundWindow'): Promise<DestroyBackgroundWindowResult>;
  call<T = unknown>(command: string, arg?: unknown, cancellationToken?: import('../ipc/common/types').CancellationToken): Promise<T>;
  listen<T = unknown>(event: string, arg?: unknown): import('../ipc/common/types').IEvent<T>;
}

export {};
