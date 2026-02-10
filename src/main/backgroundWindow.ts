/**
 * 后台窗口管理器：创建不可见窗口执行后台任务
 */
import { BrowserWindow } from 'electron';
import * as path from 'path';
import type { IBackgroundWindowManager } from '../types/background.js';

export class BackgroundWindowManager implements IBackgroundWindowManager {
  private backgroundWindow: BrowserWindow | null = null;

  /**
   * 创建后台窗口（不可见）
   */
  createBackgroundWindow(): BrowserWindow {
    if (this.backgroundWindow && !this.backgroundWindow.isDestroyed()) {
      console.log('[BackgroundWindowManager] 后台窗口已存在，返回现有窗口');
      return this.backgroundWindow;
    }

    console.log('[BackgroundWindowManager] 开始创建后台窗口...');
    const win = new BrowserWindow({
      width: 400,
      height: 300,
      show: false, // 关键：不显示窗口
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    console.log(`[BackgroundWindowManager] 后台窗口已创建，ID: ${win.id}`);

    // 窗口准备好后加载页面（但不显示）
    win.once('ready-to-show', () => {
      console.log('[BackgroundWindowManager] ✓ 后台窗口已准备就绪（ready-to-show）');
    });

    // 监听页面加载事件
    win.webContents.on('did-finish-load', () => {
      console.log('[BackgroundWindowManager] ✓ 后台窗口页面加载完成（did-finish-load）');
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error(`[BackgroundWindowManager] ✗ 后台窗口页面加载失败:`);
      console.error(`  错误代码: ${errorCode}`);
      console.error(`  错误描述: ${errorDescription}`);
      console.error(`  URL: ${validatedURL}`);
    });

    win.webContents.on('dom-ready', () => {
      console.log('[BackgroundWindowManager] ✓ 后台窗口 DOM 已就绪');
    });

    // 监听控制台消息（从渲染进程）
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const levelStr = ['', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
      console.log(`[BackgroundWindow][${levelStr}] ${message} (${sourceId}:${line})`);
    });

    // 监听渲染进程崩溃
    win.webContents.on('render-process-gone', (event, details) => {
      console.error('[BackgroundWindowManager] ✗ 后台窗口渲染进程崩溃:', details);
    });

    // 监听未捕获的异常
    win.webContents.on('unresponsive', () => {
      console.warn('[BackgroundWindowManager] ⚠ 后台窗口无响应');
    });

    win.webContents.on('responsive', () => {
      console.log('[BackgroundWindowManager] ✓ 后台窗口已恢复响应');
    });

    // 加载后台任务页面
    const url = process.env.NODE_ENV === 'development' || process.env.ELECTRON_VITE_DEV_URL
      ? `${process.env.ELECTRON_VITE_DEV_URL || 'http://localhost:5173'}/background.html`
      : path.join(__dirname, '../renderer/background.html');
    
    console.log(`[BackgroundWindowManager] 正在加载后台窗口页面: ${url}`);
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_VITE_DEV_URL) {
      win.loadURL(url);
    } else {
      win.loadFile(url);
    }

    // 防止窗口被意外显示
    win.on('close', (event) => {
      console.log('[BackgroundWindowManager] 后台窗口关闭事件触发');
      // 可以选择阻止关闭，让窗口保持运行
      // event.preventDefault();
      // this.backgroundWindow = null;
    });

    this.backgroundWindow = win;
    console.log('[BackgroundWindowManager] ✓ 后台窗口创建完成');
    return win;
  }

  /**
   * 获取后台窗口
   */
  getBackgroundWindow(): BrowserWindow | null {
    const win = this.backgroundWindow && !this.backgroundWindow.isDestroyed() 
      ? this.backgroundWindow 
      : null;
    if (!win) {
      console.log('[BackgroundWindowManager] 后台窗口不存在或已销毁');
    }
    return win;
  }

  /**
   * 销毁后台窗口
   */
  destroyBackgroundWindow(): void {
    if (this.backgroundWindow && !this.backgroundWindow.isDestroyed()) {
      console.log(`[BackgroundWindowManager] 正在销毁后台窗口，ID: ${this.backgroundWindow.id}`);
      this.backgroundWindow.destroy();
      this.backgroundWindow = null;
      console.log('[BackgroundWindowManager] ✓ 后台窗口已销毁');
    } else {
      console.log('[BackgroundWindowManager] 后台窗口不存在，无需销毁');
    }
  }

  /**
   * 执行后台任务（通过 IPC）
   */
  async executeBackgroundTask(taskName: string, ...args: unknown[]): Promise<unknown> {
    console.log(`[BackgroundWindowManager] 执行后台任务: ${taskName}`, args);
    const win = this.getBackgroundWindow();
    if (!win) {
      const error = new Error('后台窗口未创建');
      console.error(`[BackgroundWindowManager] ✗ ${error.message}`);
      throw error;
    }

    try {
      // 检查页面是否已加载
      if (!win.webContents.isLoading()) {
        console.log(`[BackgroundWindowManager] 页面已加载，执行任务: ${taskName}`);
      } else {
        console.log(`[BackgroundWindowManager] 页面正在加载，等待完成后执行任务: ${taskName}`);
        await new Promise<void>((resolve) => {
          win.webContents.once('did-finish-load', () => {
            console.log('[BackgroundWindowManager] 页面加载完成，开始执行任务');
            resolve();
          });
        });
      }

      // 通过 webContents.executeJavaScript 执行任务
      const result = await win.webContents.executeJavaScript(`
        (async () => {
          console.log('[BackgroundWindow] 收到任务执行请求: ${taskName}');
          if (window.executeBackgroundTask) {
            try {
              const result = await window.executeBackgroundTask('${taskName}', ...${JSON.stringify(args)});
              console.log('[BackgroundWindow] 任务执行成功:', result);
              return result;
            } catch (error) {
              console.error('[BackgroundWindow] 任务执行失败:', error);
              throw error;
            }
          }
          throw new Error('Background task handler not found');
        })()
      `);
      
      console.log(`[BackgroundWindowManager] ✓ 任务执行成功: ${taskName}`, result);
      return result;
    } catch (error) {
      console.error(`[BackgroundWindowManager] ✗ 任务执行失败: ${taskName}`, error);
      throw error;
    }
  }
}

export const backgroundWindowManager = new BackgroundWindowManager();
