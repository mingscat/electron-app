import type { IEvent, IServerChannel } from '../../ipc/common/types';
import type { BackgroundTaskRequest } from '../../types/background';
import type { WindowManager } from '../WindowManager';
import { ipcMain, type BrowserWindow } from 'electron';

type CommandHandler = (ctx: string, arg: unknown) => Promise<unknown>;

/** 主进程 → 后台窗口 的 IPC 通道名 */
const BG_TASK_REQUEST = 'background:task-request';
/** 后台窗口 → 主进程 的 IPC 通道名 */
const BG_TASK_RESPONSE = 'background:task-response';

/** 默认任务超时（ms） */
const TASK_TIMEOUT = 30_000;

let requestSeq = 0;

/**
 * background 通道：管理后台窗口及任务执行
 *
 * 通信流程（已替换 executeJavaScript）：
 *   主进程  ──(webContents.send)──▶  后台渲染进程
 *   主进程  ◀──(ipcMain.on)────────  后台渲染进程
 */
class BackgroundChannel implements IServerChannel<string> {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(private readonly windowManager: WindowManager) {
    if (!windowManager) {
      throw new Error('[BackgroundChannel] WindowManager is required');
    }

    // ─── 命令注册表 ───
    this.on('createBackgroundWindow', this.handleCreateWindow);
    this.on('executeTask', this.handleExecuteTask);
    this.on('destroyBackgroundWindow', this.handleDestroyWindow);
  }

  // ─── 命令实现 ─────────────────────────────────────

  /** 创建后台窗口（如果已存在则返回现有窗口） */
  private handleCreateWindow = async (): Promise<{ success: true; windowId: number; isNew: boolean }> => {
    const existingBgWindows = this.windowManager.getWindowsByType('background');
    const isNew = existingBgWindows.length === 0;
    
    const win = this.windowManager.createBackgroundWindow();
    return { success: true, windowId: win.id, isNew };
  };

  /**
   * 执行后台任务 —— 通过 IPC 消息与后台渲染进程通信
   *
   * 1. 生成唯一 requestId
   * 2. 通过 webContents.send 向后台窗口发送任务请求
   * 3. 通过 ipcMain.on 接收对应 requestId 的响应
   * 4. 超时自动拒绝
   */
  private handleExecuteTask = async (_ctx: string, arg: unknown): Promise<unknown> => {
    const { taskName, args } = arg as BackgroundTaskRequest;
    const bgWindows = this.windowManager.getWindowsByType('background');
    if (bgWindows.length === 0) {
      throw new Error('[BackgroundChannel] 后台窗口未创建');
    }

    const win = bgWindows[0] as BrowserWindow;
    const requestId = `bg_${++requestSeq}_${Date.now()}`;

    return new Promise<unknown>((resolve, reject) => {
      // 超时保护
      const timer = setTimeout(() => {
        ipcMain.removeListener(BG_TASK_RESPONSE, handler);
        reject(new Error(`[BackgroundChannel] 任务 '${taskName}' 超时（${TASK_TIMEOUT}ms）`));
      }, TASK_TIMEOUT);

      // 监听后台窗口的响应
      const handler = (
        _event: Electron.IpcMainEvent,
        respId: string,
        error: string | null,
        result: unknown,
      ) => {
        if (respId !== requestId) return; // 不是本次请求，忽略
        ipcMain.removeListener(BG_TASK_RESPONSE, handler);
        clearTimeout(timer);

        if (error) {
          reject(new Error(error));
        } else {
          resolve(result);
        }
      };

      ipcMain.on(BG_TASK_RESPONSE, handler);

      // 向后台窗口发送任务请求
      win.webContents.send(BG_TASK_REQUEST, requestId, taskName, args);
    });
  };

  /** 销毁后台窗口 */
  private handleDestroyWindow = async (): Promise<{ success: true }> => {
    const bgWindows = this.windowManager.getWindowsByType('background');
    bgWindows.forEach((win: BrowserWindow) => this.windowManager.closeWindow(win));
    return { success: true };
  };

  // ─── 基础设施 ─────────────────────────────────────

  call<T>(ctx: string, command: string, arg?: unknown): Promise<T> {
    console.log(`[BackgroundChannel] call: ${command}`, arg);
    const handler = this.handlers.get(command);
    if (!handler) {
      return Promise.reject(new Error(`[BackgroundChannel] 未知命令: ${command}`));
    }
    return handler(ctx, arg) as Promise<T>;
  }

  listen<T>(_ctx: string, _event: string, _arg?: unknown): IEvent<T> {
    throw new Error('[BackgroundChannel] listen not implemented');
  }

  private on(command: string, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }
}

export function createBackgroundChannel(windowManager: WindowManager): IServerChannel<string> {
  return new BackgroundChannel(windowManager);
}
