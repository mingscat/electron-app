/**
 * Electron 主应用类
 */
import { app } from 'electron';
import { createIPCServer } from '../ipc/electron-main/server.js';
import type { IPCServer } from '../ipc/common/ipc.js';
import { WindowManager } from './WindowManager.js';
import { IPCChannelManager } from './IPCChannelManager';

export class ElectronApp {
  private windowManager: WindowManager;
  private ipcChannelManager: IPCChannelManager;
  private ipcServer: IPCServer<string> | null = null;

  constructor() {
    this.windowManager = new WindowManager();
    this.ipcChannelManager = new IPCChannelManager();
  }

  /**
   * 初始化应用
   */
  async initialize(): Promise<void> {
    console.log('[ElectronApp] 开始初始化应用...');

    // 设置应用生命周期
    this.setupAppLifecycle();

    // 初始化 IPC Server
    this.initializeIPCServer();

    // 创建主窗口
    this.windowManager.createMainWindow();

    // 创建默认后台窗口
    this.createDefaultBackgroundWindow();

    console.log('[ElectronApp] ✓ 应用初始化完成');
  }

  /**
   * 设置应用生命周期
   */
  private setupAppLifecycle(): void {
    // 注意：不在这里 quit，因为后台窗口需要保持运行
    app.on('window-all-closed', () => {
      // 如果所有窗口都关闭，检查是否有后台窗口
      const bgWindows = this.windowManager.getWindowsByType('background');
      if (bgWindows.length === 0) {
        app.quit();
      }
    });

    app.on('activate', () => {
      // macOS: 当点击 dock 图标时，如果没有窗口则创建新窗口
      if (this.windowManager.getMainWindow() === null) {
        this.windowManager.createMainWindow();
      }
    });
  }

  /**
   * 初始化 IPC Server
   */
  private initializeIPCServer(): void {
    console.log('[ElectronApp] 初始化 IPC Server...');
    this.ipcServer = createIPCServer<string>();
    // 设置窗口管理器到 IPC 通道管理器
    this.ipcChannelManager.setWindowManager(this.windowManager);
    this.ipcChannelManager.registerChannels(this.ipcServer);
    console.log('[ElectronApp] ✓ IPC Server 已启动');
  }

  /**
   * 创建默认后台窗口
   */
  private createDefaultBackgroundWindow(): void {
    console.log('[ElectronApp] 正在创建默认后台窗口...');
    try {
      const bgWin = this.windowManager.createBackgroundWindow();
      console.log(`[ElectronApp] ✓ 后台窗口已创建，ID: ${bgWin.id}`);

      // 监听后台窗口事件
      bgWin.webContents.on('did-finish-load', () => {
        console.log('[ElectronApp] ✓ 后台窗口页面加载完成');
      });

      bgWin.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`[ElectronApp] ✗ 后台窗口页面加载失败: ${errorCode} - ${errorDescription}`);
      });

      bgWin.on('closed', () => {
        console.log('[ElectronApp] 后台窗口已关闭');
      });
    } catch (error) {
      console.error('[ElectronApp] ✗ 创建后台窗口失败:', error);
    }
  }

  /**
   * 获取窗口管理器
   */
  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  /**
   * 获取 IPC 通道管理器
   */
  getIPCChannelManager(): IPCChannelManager {
    return this.ipcChannelManager;
  }
}
