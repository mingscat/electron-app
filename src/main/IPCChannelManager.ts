/**
 * IPC 通道管理器：集中注册/管理各类通道
 *
 * - app 通道：基础应用信息（版本、ping 等）
 * - background 通道：后台窗口创建、任务执行、销毁
 */
import type { IPCServer } from '../ipc/common/ipc.js';
import type { WindowManager } from './WindowManager.js';
import { createAppChannel } from './channels/AppChannel';
import { createBackgroundChannel } from './channels/BackgroundChannel';

export class IPCChannelManager {
  private windowManager?: WindowManager;

  /**
   * 设置窗口管理器（用于 background 通道）
   */
  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager;
  }

  /**
   * 注册所有通道到 IPC Server
   */
  registerChannels(ipcServer: IPCServer<string>): void {
    // app 通道
    ipcServer.registerChannel('app', createAppChannel());
    console.log('[IPCChannelManager] ✓ app channel 已注册');

    // background 通道（依赖 WindowManager）
    if (!this.windowManager) {
      console.warn('[IPCChannelManager] 未设置 WindowManager，跳过 background channel 注册');
      return;
    }

    ipcServer.registerChannel('background', createBackgroundChannel(this.windowManager));
    console.log('[IPCChannelManager] ✓ background channel 已注册');
  }
}

