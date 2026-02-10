/**
 * Background 通道：管理后台窗口及任务执行
 *
 * 命令：createBackgroundWindow / executeTask / destroyBackgroundWindow
 * 事件：onTaskProgress —— 任务进度推送（预留）
 */
import type { IServerChannel } from '../../ipc/common/types';
import type { BackgroundTaskRequest } from '../../types/background';
import type { WindowManager } from '../WindowManager';
import { ipcMain, type BrowserWindow } from 'electron';
import { BaseChannel } from '../../ipc/common/baseChannel';

/** 主进程 → 后台窗口 的 IPC 通道名 */
const BG_TASK_REQUEST = 'background:task-request';
/** 后台窗口 → 主进程 的 IPC 通道名 */
const BG_TASK_RESPONSE = 'background:task-response';

/** 默认任务超时（ms） */
const TASK_TIMEOUT = 30_000;

let requestSeq = 0;

class BackgroundChannel extends BaseChannel {
  constructor(private readonly windowManager: WindowManager) {
    super();
    if (!windowManager) {
      throw new Error('[BackgroundChannel] WindowManager is required');
    }

    this.onCommand('createBackgroundWindow', this.handleCreateWindow);
    this.onCommand('executeTask', this.handleExecuteTask);
    this.onCommand('destroyBackgroundWindow', this.handleDestroyWindow);
  }

  // ─── 命令实现 ─────────────────────────────────────

  private handleCreateWindow = async (): Promise<{ success: true; windowId: number; isNew: boolean }> => {
    const existingBgWindows = this.windowManager.getWindowsByType('background');
    const isNew = existingBgWindows.length === 0;
    const win = this.windowManager.createBackgroundWindow();
    return { success: true, windowId: win.id, isNew };
  };

  private handleExecuteTask = async (_ctx: string, arg: unknown): Promise<unknown> => {
    const { taskName, args } = arg as BackgroundTaskRequest;
    const bgWindows = this.windowManager.getWindowsByType('background');
    if (bgWindows.length === 0) {
      throw new Error('[BackgroundChannel] 后台窗口未创建');
    }

    const win = bgWindows[0] as BrowserWindow;
    const requestId = `bg_${++requestSeq}_${Date.now()}`;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener(BG_TASK_RESPONSE, handler);
        reject(new Error(`[BackgroundChannel] 任务 '${taskName}' 超时（${TASK_TIMEOUT}ms）`));
      }, TASK_TIMEOUT);

      const handler = (
        _event: Electron.IpcMainEvent,
        respId: string,
        error: string | null,
        result: unknown,
      ) => {
        if (respId !== requestId) return;
        ipcMain.removeListener(BG_TASK_RESPONSE, handler);
        clearTimeout(timer);
        if (error) reject(new Error(error));
        else resolve(result);
      };

      ipcMain.on(BG_TASK_RESPONSE, handler);
      win.webContents.send(BG_TASK_REQUEST, requestId, taskName, args);
    });
  };

  private handleDestroyWindow = async (): Promise<{ success: true }> => {
    const bgWindows = this.windowManager.getWindowsByType('background');
    bgWindows.forEach((win: BrowserWindow) => this.windowManager.closeWindow(win));
    return { success: true };
  };
}

export function createBackgroundChannel(windowManager: WindowManager): IServerChannel<string> {
  return new BackgroundChannel(windowManager);
}
