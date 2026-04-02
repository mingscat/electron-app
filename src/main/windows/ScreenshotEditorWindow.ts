/**
 * 截图编辑器窗口
 *
 * 特性：
 * - 全屏覆盖所有显示器
 * - 无边框、置顶
 * - 显示所有显示器截图作为背景
 * - 支持区域选择和标注
 */
import { BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import * as path from 'path';
import type { ImageData, ScreenshotResult, Area } from '../../types/screenshot.js';

export interface ScreenshotEditorOptions {
  /** 所有显示器的截图数据 */
  fullImageData: ImageData;
  /** 虚拟桌面边界 */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** 各显示器信息 */
  displays: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
  }>;
}

export class ScreenshotEditorWindow {
  private window: BrowserWindow | null = null;
  private resolvePromise: ((result: ScreenshotResult | null) => void) | null = null;
  private options: ScreenshotEditorOptions;

  constructor(options: ScreenshotEditorOptions) {
    this.options = options;
  }

  /**
   * 打开截图编辑器
   */
  async open(): Promise<ScreenshotResult | null> {
    if (this.window) {
      this.window.focus();
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.resolvePromise = resolve;

      const { bounds, displays } = this.options;

      // 获取 Electron 的显示器信息来验证坐标
      const electronDisplays = screen.getAllDisplays();
      console.log('[ScreenshotEditor] Electron displays:', electronDisplays.map(d => ({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      })));
      console.log('[ScreenshotEditor] Using bounds:', bounds);
      console.log('[ScreenshotEditor] Using displays:', displays);

      // 计算实际的虚拟桌面边界（使用 Electron 的显示器信息更可靠）
      const allDisplays = electronDisplays.length > 0 ? electronDisplays : displays.map(d => ({
        bounds: { x: d.x, y: d.y, width: d.width, height: d.height }
      }));

      const minX = Math.min(...allDisplays.map(d => d.bounds.x));
      const minY = Math.min(...allDisplays.map(d => d.bounds.y));
      const maxX = Math.max(...allDisplays.map(d => d.bounds.x + d.bounds.width));
      const maxY = Math.max(...allDisplays.map(d => d.bounds.y + d.bounds.height));

      const actualBounds = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };

      console.log('[ScreenshotEditor] Actual bounds:', actualBounds);

      // 获取主显示器尺寸（截图编辑器应该覆盖整个屏幕）
      const primaryDisplay = screen.getPrimaryDisplay();
      const workArea = primaryDisplay.workArea;
      const screenBounds = primaryDisplay.bounds;

      console.log('[ScreenshotEditor] Primary display workArea:', workArea);
      console.log('[ScreenshotEditor] Primary display bounds:', screenBounds);

      // 创建全屏窗口 - 在 Linux 上不使用 fullscreen 模式，而是手动设置大小
      this.window = new BrowserWindow({
        x: screenBounds.x,
        y: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        fullscreen: false,  // Linux 上 fullscreen 可能有问题
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: true,
        focusable: true,
        show: false,
        type: 'dock',  // 使用 dock 类型覆盖任务栏
        webPreferences: {
          preload: path.join(__dirname, '../../preload/screenshot-editor.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      // 手动设置窗口大小为整个屏幕（包括任务栏区域）
      this.window.setBounds(screenBounds);
      this.window.setSize(screenBounds.width, screenBounds.height);
      this.window.setPosition(screenBounds.x, screenBounds.y);
      this.window.setAlwaysOnTop(true, 'screen-saver');

      // 验证窗口大小
      const actualSize = this.window.getBounds();
      console.log('[ScreenshotEditor] Window bounds after creation:', actualSize);
      console.log('[ScreenshotEditor] Window size:', this.window.getSize());

      // 加载编辑器页面
      const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_VITE_DEV_URL;
      if (isDev) {
        this.window.loadURL(`${process.env.ELECTRON_VITE_DEV_URL || 'http://localhost:5173'}/screenshot-editor.html`);
      } else {
        this.window.loadFile(path.join(__dirname, '../../renderer/screenshot-editor.html'));
      }

      // 页面加载完成后发送截图数据
      this.window.webContents.on('did-finish-load', () => {
        // 获取实际窗口大小
        const winBounds = this.window?.getBounds();
        console.log('[ScreenshotEditor] Window size at load:', winBounds);

        this.window?.webContents.send('screenshot:data', {
          imageData: this.options.fullImageData,
          displays: this.options.displays,
          bounds: winBounds || screenBounds,
        });
        this.window?.show();
        this.window?.focus();
      });

      // 注册ESC快捷键关闭
      globalShortcut.register('Escape', () => {
        this.close(null);
      });

      // 监听渲染进程的消息
      this.setupIPC();

      // 窗口关闭时清理
      this.window.on('closed', () => {
        this.cleanup();
      });
    });
  }

  /**
   * 设置IPC通信
   */
  private setupIPC(): void {
    // 截图完成
    ipcMain.once('screenshot:complete', (_event, result: ScreenshotResult) => {
      this.close(result);
    });

    // 截图取消
    ipcMain.once('screenshot:cancel', () => {
      this.close(null);
    });

    // 复制到剪贴板
    ipcMain.handle('screenshot:copy', async (_event, dataUrl: string) => {
      // 由主进程处理复制逻辑
      return { success: true };
    });

    // 保存文件
    ipcMain.handle('screenshot:save', async (_event, dataUrl: string, filePath: string) => {
      // 由主进程处理保存逻辑
      return { success: true, path: filePath };
    });
  }

  /**
   * 关闭编辑器
   */
  private close(result: ScreenshotResult | null): void {
    if (this.resolvePromise) {
      this.resolvePromise(result);
      this.resolvePromise = null;
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }

    this.cleanup();
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    globalShortcut.unregister('Escape');
    this.window = null;

    // 移除IPC监听器
    ipcMain.removeAllListeners('screenshot:complete');
    ipcMain.removeAllListeners('screenshot:cancel');
    ipcMain.removeHandler('screenshot:copy');
    ipcMain.removeHandler('screenshot:save');
  }

  /**
   * 强制关闭
   */
  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.cleanup();
  }
}

/**
 * 创建截图编辑器窗口
 */
export function createScreenshotEditorWindow(options: ScreenshotEditorOptions): ScreenshotEditorWindow {
  return new ScreenshotEditorWindow(options);
}
