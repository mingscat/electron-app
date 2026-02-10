/**
 * Preload 脚本暴露的全局对象类型
 */

/**
 * Preload IPC 接口（由 contextBridge 注入）
 */
export interface IPreloadIPC {
  /**
   * 发送消息
   */
  send(channel: string, ...args: unknown[]): void;

  /**
   * 监听消息
   */
  on(channel: string, listener: (...args: unknown[]) => void): (() => void) | void;
}

/**
 * 后台窗口任务 IPC 接口（由 contextBridge 注入）
 */
export interface IBackgroundIpc {
  /** 监听主进程发来的任务请求，返回取消监听函数 */
  onTaskRequest(listener: (requestId: string, taskName: string, args: unknown[]) => void): () => void;

  /** 向主进程回复任务执行结果 */
  sendTaskResponse(requestId: string, error: string | null, result: unknown): void;
}

/**
 * Electron API 全局对象
 */
export interface ElectronAPI {
  /**
   * 获取 Channel（如果通过 preload 直接暴露）
   */
  getChannel?: (channelName: string) => unknown;
}

declare global {
  interface Window {
    /**
     * VSCode 风格 IPC 接口（由 preload 注入）
     */
    ipcForVSCode?: IPreloadIPC;

    /**
     * 后台窗口任务 IPC 接口（由 preload 注入）
     */
    backgroundIpc?: IBackgroundIpc;

    /**
     * Electron API（如果通过 preload 暴露）
     */
    electronAPI?: ElectronAPI;
  }
}

export {};
