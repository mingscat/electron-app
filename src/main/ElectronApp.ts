/**
 * Electron 主应用类
 *
 * 职责：
 *   - 全局错误处理
 *   - 单实例锁定
 *   - 应用生命周期管理
 *   - 窗口状态持久化
 *   - IPC Server 初始化
 *
 * 推荐使用工厂方法创建：
 *   const electronApp = ElectronApp.create();
 *
 * 测试时可注入 mock 依赖：
 *   const electronApp = new ElectronApp(mockWindowManager, mockChannelManager);
 */
import { app, BrowserWindow, globalShortcut, ipcMain, dialog, clipboard, nativeImage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ElectronIPCServer } from '../ipc/electron-main/server.js';
import { WindowManager } from './WindowManager.js';
import { IPCChannelManager } from './IPCChannelManager';
import { createScreenshotEditorWindow, ScreenshotEditorWindow } from './windows/ScreenshotEditorWindow.js';
import type { ImageData } from '../types/screenshot.js';

/** 窗口状态持久化数据 */
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export class ElectronApp {
  private ipcServer: ElectronIPCServer<string> | null = null;
  private isQuitting = false;
  private screenshotEditor: ScreenshotEditorWindow | null = null;

  /** 窗口状态文件路径 */
  private get windowStatePath(): string {
    return path.join(app.getPath('userData'), 'window-state.json');
  }

  /**
   * 构造函数 —— 接收外部依赖（便于测试和替换）
   */
  constructor(
    private readonly windowManager: WindowManager,
    private readonly ipcChannelManager: IPCChannelManager,
  ) {}

  /**
   * 工厂方法 —— 创建默认依赖并组装
   */
  static create(): ElectronApp {
    return new ElectronApp(new WindowManager(), new IPCChannelManager());
  }

  /**
   * 初始化应用
   */
  async initialize(): Promise<void> {
    console.log('[ElectronApp] 开始初始化应用...');

    // 1. 全局错误处理（最先设置）
    this.setupGlobalErrorHandlers();

    // 2. 应用生命周期
    this.setupAppLifecycle();

    // 3. IPC Server
    this.initializeIPCServer();

    // 4. 创建主窗口（带状态恢复）
    this.createMainWindowWithState();

    // 5. 创建后台窗口
    this.createDefaultBackgroundWindow();

    // 6. 设置截图快捷键
    this.setupScreenshotShortcut();

    // 7. 设置截图相关的IPC处理
    this.setupScreenshotIPC();

    console.log('[ElectronApp] ✓ 应用初始化完成');
  }

  // ─── 全局错误处理 ─────────────────────────────────

  private setupGlobalErrorHandlers(): void {
    // 主进程未捕获异常
    process.on('uncaughtException', (error) => {
      console.error('[ElectronApp] ✗ 未捕获的异常:', error);
      this.writeErrorLog('uncaughtException', error);
      // 非开发环境下，显示错误对话框后退出
      // 开发环境保持运行以便调试
    });

    // 主进程未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason) => {
      console.error('[ElectronApp] ✗ 未处理的 Promise 拒绝:', reason);
      this.writeErrorLog('unhandledRejection', reason);
    });

    // 渲染进程崩溃
    app.on('render-process-gone', (event, webContents, details) => {
      console.error(`[ElectronApp] ✗ 渲染进程崩溃 [${webContents.id}]:`, details);
      this.writeErrorLog('render-process-gone', details);

      // 如果主窗口崩溃，尝试重建
      const mainWin = this.windowManager.getMainWindow();
      if (mainWin && mainWin.webContents.id === webContents.id) {
        console.log('[ElectronApp] 主窗口崩溃，尝试重建...');
        setTimeout(() => {
          this.createMainWindowWithState();
        }, 1000);
      }
    });

    // 子进程崩溃
    app.on('child-process-gone', (event, details) => {
      console.error('[ElectronApp] ✗ 子进程崩溃:', details);
      this.writeErrorLog('child-process-gone', details);
    });

    console.log('[ElectronApp] ✓ 全局错误处理已设置');
  }

  /**
   * 将错误写入日志文件（追加模式）
   */
  private writeErrorLog(type: string, error: unknown): void {
    try {
      const logDir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(logDir, { recursive: true });

      const logFile = path.join(logDir, 'crash.log');
      const entry = [
        `[${new Date().toISOString()}] ${type}`,
        error instanceof Error
          ? `${error.message}\n${error.stack}`
          : JSON.stringify(error, null, 2),
        '---',
        '',
      ].join('\n');

      fs.appendFileSync(logFile, entry, 'utf-8');
    } catch {
      // 日志写入失败不应该影响应用
    }
  }

  // ─── 应用生命周期 ─────────────────────────────────

  private setupAppLifecycle(): void {
    // ─── 优雅退出：清理资源 ───
    app.on('before-quit', () => {
      console.log('[ElectronApp] 应用即将退出...');
      this.isQuitting = true;

      // 保存主窗口状态
      this.saveMainWindowState();

      // 关闭后台窗口
      const bgWindows = this.windowManager.getWindowsByType('background');
      for (const win of bgWindows) {
        if (!win.isDestroyed()) win.destroy();
      }

      console.log('[ElectronApp] ✓ 资源清理完成');
    });

    // ─── 所有窗口关闭 ───
    app.on('window-all-closed', () => {
      // macOS 下点关闭按钮不退出
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    // ─── macOS dock 点击 ───
    app.on('activate', () => {
      if (this.windowManager.getMainWindow() === null) {
        this.createMainWindowWithState();
      }
    });

    console.log('[ElectronApp] ✓ 生命周期钩子已设置');
  }

  // ─── 窗口状态持久化 ───────────────────────────────

  private loadWindowState(): WindowState {
    const defaults: WindowState = { width: 900, height: 700, isMaximized: false };
    try {
      if (fs.existsSync(this.windowStatePath)) {
        const data = fs.readFileSync(this.windowStatePath, 'utf-8');
        const state = JSON.parse(data) as WindowState;
        // 基本校验
        if (state.width > 0 && state.height > 0) {
          return state;
        }
      }
    } catch {
      console.warn('[ElectronApp] 读取窗口状态失败，使用默认值');
    }
    return defaults;
  }

  private saveMainWindowState(): void {
    const mainWin = this.windowManager.getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) return;

    try {
      const isMaximized = mainWin.isMaximized();
      const bounds = mainWin.getBounds();
      const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
      };
      fs.writeFileSync(this.windowStatePath, JSON.stringify(state, null, 2), 'utf-8');
      console.log('[ElectronApp] ✓ 窗口状态已保存');
    } catch {
      console.warn('[ElectronApp] 保存窗口状态失败');
    }
  }

  private createMainWindowWithState(): void {
    const state = this.loadWindowState();
    const mainWin = this.windowManager.createMainWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    });

    if (state.isMaximized) {
      mainWin.maximize();
    }

    // 窗口关闭时保存状态（macOS 隐藏而非退出）
    mainWin.on('close', (event) => {
      if (process.platform === 'darwin' && !this.isQuitting) {
        event.preventDefault();
        mainWin.hide();
        return;
      }
      this.saveMainWindowState();
    });

    // 定期保存（防止异常退出丢失）
    const saveInterval = setInterval(() => {
      if (mainWin.isDestroyed()) {
        clearInterval(saveInterval);
        return;
      }
      this.saveMainWindowState();
    }, 60_000); // 每分钟
  }

  // ─── IPC Server ───────────────────────────────────

  private initializeIPCServer(): void {
    console.log('[ElectronApp] 初始化 IPC Server...');
    this.ipcServer = ElectronIPCServer.create<string>();
    this.ipcChannelManager.registerDefaults(this.windowManager);
    this.ipcChannelManager.bindTo(this.ipcServer);
    console.log('[ElectronApp] ✓ IPC Server 已启动');
  }

  // ─── 后台窗口 ─────────────────────────────────────

  private createDefaultBackgroundWindow(): void {
    console.log('[ElectronApp] 正在创建默认后台窗口...');
    try {
      const bgWin = this.windowManager.createBackgroundWindow();
      console.log(`[ElectronApp] ✓ 后台窗口已创建，ID: ${bgWin.id}`);

      bgWin.webContents.on('did-finish-load', () => {
        console.log('[ElectronApp] ✓ 后台窗口页面加载完成');
      });

      bgWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error(`[ElectronApp] ✗ 后台窗口页面加载失败: ${errorCode} - ${errorDescription}`);
      });

      bgWin.on('closed', () => {
        console.log('[ElectronApp] 后台窗口已关闭');
      });
    } catch (error) {
      console.error('[ElectronApp] ✗ 创建后台窗口失败:', error);
    }
  }

  // ─── 截图功能 ─────────────────────────────────────

  private setupScreenshotShortcut(): void {
    // 注册截图快捷键 Ctrl+Shift+A (Windows/Linux) 或 Cmd+Shift+A (macOS)
    const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+D' : 'Ctrl+Shift+D';

    const registered = globalShortcut.register(shortcut, () => {
      console.log('[ElectronApp] Screenshot shortcut triggered');
      this.startScreenshot();
    });

    if (registered) {
      console.log(`[ElectronApp] Screenshot shortcut registered: ${shortcut}`);
    } else {
      console.error(`[ElectronApp] Failed to register screenshot shortcut: ${shortcut}`);
    }
  }

  private setupScreenshotIPC(): void {
    // 处理截图完成后的保存/复制操作
    ipcMain.handle('screenshot:save-file', async (_event, dataUrl: string) => {
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: `screenshot-${Date.now()}.png`,
          filters: [
            { name: 'PNG Images', extensions: ['png'] },
            { name: 'JPEG Images', extensions: ['jpg', 'jpeg'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (!result.canceled && result.filePath) {
          const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(result.filePath, buffer);
          return { success: true, path: result.filePath };
        }
        return { success: false, canceled: true };
      } catch (error) {
        console.error('[ElectronApp] Failed to save screenshot:', error);
        return { success: false, error: String(error) };
      }
    });

    ipcMain.handle('screenshot:copy-clipboard', async (_event, dataUrl: string) => {
      try {
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const image = nativeImage.createFromBuffer(buffer);
        clipboard.writeImage(image);
        return { success: true };
      } catch (error) {
        console.error('[ElectronApp] Failed to copy screenshot:', error);
        return { success: false, error: String(error) };
      }
    });
  }

  private async startScreenshot(): Promise<void> {
    try {
      // 加载原生模块
      let nativeModule: typeof import('../../native/index.js') | null = null;
      const platform = process.platform;
      const arch = process.arch;

      let binaryName: string;
      if (platform === 'win32') {
        binaryName = `screenshot-native.win32-${arch}-msvc.node`;
      } else if (platform === 'darwin') {
        binaryName = `screenshot-native.darwin-${arch}.node`;
      } else {
        binaryName = `screenshot-native.linux-${arch}-gnu.node`;
      }

      const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_VITE_DEV_URL;
      const searchPaths = isDev
        ? [
            path.join(__dirname, '../../../native', binaryName),
            path.join(__dirname, '../../../../native', binaryName),
            path.join(app.getAppPath(), 'native', binaryName),
          ]
        : [
            path.join(process.resourcesPath, 'native', binaryName),
            path.join(__dirname, '..', '..', 'native', binaryName),
          ];

      for (const modulePath of searchPaths) {
        if (fs.existsSync(modulePath)) {
          nativeModule = require(modulePath);
          console.log('[ElectronApp] Loaded native module from:', modulePath);
          break;
        }
      }

      if (!nativeModule) {
        throw new Error('Native module not found');
      }

      // 获取所有显示器信息
      const displays = nativeModule.getDisplays();
      console.log('[ElectronApp] Displays:', displays);

      // 捕获所有显示器
      const fullImage = nativeModule.captureAllDisplays();
      console.log('[ElectronApp] Captured all displays:', fullImage.width, 'x', fullImage.height);

      // 计算虚拟桌面边界
      const minX = Math.min(...displays.map(d => d.x));
      const minY = Math.min(...displays.map(d => d.y));

      // 如果已有编辑器窗口，先关闭
      if (this.screenshotEditor) {
        this.screenshotEditor.destroy();
        this.screenshotEditor = null;
      }

      // 创建截图编辑器
      this.screenshotEditor = createScreenshotEditorWindow({
        fullImageData: {
          data: Buffer.from(fullImage.data).toString('base64'),
          width: fullImage.width,
          height: fullImage.height,
        },
        bounds: {
          x: minX,
          y: minY,
          width: fullImage.width,
          height: fullImage.height,
        },
        displays: displays.map(d => ({
          x: d.x,
          y: d.y,
          width: d.width,
          height: d.height,
          scaleFactor: d.scaleFactor,
        })),
      });

      // 打开编辑器并等待结果
      const result = await this.screenshotEditor.open();
      this.screenshotEditor = null;

      if (result) {
        console.log('[ElectronApp] Screenshot completed:', result.imageData.width, 'x', result.imageData.height);

        // 自动复制到剪贴板
        const base64Data = result.imageData.data;
        const buffer = Buffer.from(base64Data, 'base64');
        const image = nativeImage.createFromBuffer(buffer);
        clipboard.writeImage(image);

        // 显示通知
        const mainWin = this.windowManager.getMainWindow();
        if (mainWin) {
          mainWin.webContents.send('screenshot:completed', {
            width: result.imageData.width,
            height: result.imageData.height,
          });
        }
      } else {
        console.log('[ElectronApp] Screenshot cancelled');
      }
    } catch (error) {
      console.error('[ElectronApp] Screenshot failed:', error);
    }
  }

  // ─── 公共方法 ─────────────────────────────────────

  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  getIPCChannelManager(): IPCChannelManager {
    return this.ipcChannelManager;
  }
}
