/**
 * 统一窗口管理器：支持窗口分组、属性存储、按组关闭
 */
import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import * as path from 'path';

/**
 * 窗口属性接口
 */
export interface WindowProperties {
  /** 窗口类型：main（主窗口）、normal（普通窗口）、background（后台窗口） */
  type: 'main' | 'normal' | 'background';
  /** 窗口分组 */
  group?: string;
  /** 窗口标题 */
  title?: string;
  /** 窗口标签 */
  tag?: string;
  /** 自定义属性 */
  [key: string]: unknown;
}

/**
 * 窗口创建选项
 */
export interface WindowCreateOptions extends BrowserWindowConstructorOptions {
  /** 窗口属性 */
  properties?: WindowProperties;
  /** 要加载的 URL 或文件路径 */
  url?: string;
  /** 是否在开发模式下打开 DevTools */
  openDevTools?: boolean;
}

/**
 * 扩展 BrowserWindow 类型以支持自定义属性
 */
declare module 'electron' {
  interface BrowserWindow {
    __windowProperties?: WindowProperties;
  }
}

export class WindowManager {
  /** 主窗口 */
  private mainWindow: BrowserWindow | null = null;
  /** 所有窗口映射：窗口ID -> 窗口实例 */
  private windows: Map<number, BrowserWindow> = new Map();
  /** 分组映射：分组名 -> 窗口ID数组 */
  private groups: Map<string, Set<number>> = new Map();

  /**
   * 创建窗口（统一方法）
   */
  createWindow(options: WindowCreateOptions): BrowserWindow {
    const {
      properties = { type: 'normal' },
      url,
      openDevTools = false,
      ...browserWindowOptions
    } = options;

    // 如果是主窗口且已存在，返回现有窗口
    if (properties.type === 'main' && this.mainWindow && !this.mainWindow.isDestroyed()) {
      console.log('[WindowManager] 主窗口已存在，返回现有窗口');
      return this.mainWindow;
    }

    // 设置默认的 webPreferences
    const webPreferences: Electron.WebPreferences = {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      ...browserWindowOptions.webPreferences,
    };

    // 创建窗口
    const win = new BrowserWindow({
      ...browserWindowOptions,
      webPreferences,
    });

    // 保存窗口属性到窗口对象上
    win.__windowProperties = {
      ...properties,
    };

    // 注册窗口
    this.registerWindow(win, properties.group);

    // 如果是主窗口，保存引用
    if (properties.type === 'main') {
      this.mainWindow = win;
    }

    // 加载页面
    this.loadWindowContent(win, url, properties.type);

    // 开发模式下打开 DevTools
    if (openDevTools || (process.env.NODE_ENV === 'development')) {
      win.webContents.openDevTools();
    }

    // 监听窗口关闭
    win.on('closed', () => {
      this.unregisterWindow(win);
      if (properties.type === 'main') {
        this.mainWindow = null;
      }
      console.log(`[WindowManager] 窗口已关闭，ID: ${win.id}, 类型: ${properties.type}`);
    });

    console.log(`[WindowManager] ✓ 窗口已创建，ID: ${win.id}, 类型: ${properties.type}, 分组: ${properties.group || '无'}`);
    return win;
  }

  /**
   * 创建主窗口
   */
  createMainWindow(options?: Partial<WindowCreateOptions>): BrowserWindow {
    return this.createWindow({
      width: 900,
      height: 700,
      properties: {
        type: 'main',
        title: '主窗口',
      },
      ...options,
    });
  }

  /**
   * 创建普通窗口
   */
  createNormalWindow(options: Partial<WindowCreateOptions> & { properties?: Partial<WindowProperties> }): BrowserWindow {
    return this.createWindow({
      width: 800,
      height: 600,
      properties: {
        type: 'normal',
        ...options.properties,
      },
      ...options,
    });
  }

  /**
   * 创建后台窗口（只能有一个）
   */
  createBackgroundWindow(options?: Partial<WindowCreateOptions>): BrowserWindow {
    // 检查是否已存在后台窗口
    const existingBgWindows = this.getWindowsByType('background');
    if (existingBgWindows.length > 0) {
      const existingWin = existingBgWindows[0] as BrowserWindow;
      if (!existingWin.isDestroyed()) {
        console.log('[WindowManager] 后台窗口已存在，返回现有窗口，ID:', existingWin.id);
        return existingWin;
      }
    }

    return this.createWindow({
      width: 400,
      height: 300,
      show: false,
      properties: {
        type: 'background',
        group: 'background',
        title: '后台窗口',
        ...options?.properties,
      },
      url: process.env.NODE_ENV === 'development' || process.env.ELECTRON_VITE_DEV_URL
        ? `${process.env.ELECTRON_VITE_DEV_URL || 'http://localhost:5173'}/background.html`
        : path.join(__dirname, '../renderer/background.html'),
      ...options,
    });
  }

  /**
   * 注册窗口
   */
  private registerWindow(win: BrowserWindow, group?: string): void {
    this.windows.set(win.id, win);

    if (group) {
      if (!this.groups.has(group)) {
        this.groups.set(group, new Set());
      }
      this.groups.get(group)!.add(win.id);
    }
  }

  /**
   * 注销窗口
   */
  private unregisterWindow(win: BrowserWindow): void {
    const properties = win.__windowProperties;
    this.windows.delete(win.id);

    if (properties?.group) {
      const groupSet = this.groups.get(properties.group);
      if (groupSet) {
        groupSet.delete(win.id);
        if (groupSet.size === 0) {
          this.groups.delete(properties.group);
        }
      }
    }
  }

  /**
   * 加载窗口内容
   */
  private loadWindowContent(win: BrowserWindow, url?: string, type?: string): void {
    if (url) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        win.loadURL(url);
      } else {
        win.loadFile(url);
      }
      return;
    }

    // 根据类型加载默认页面
    if (type === 'background') {
      const bgUrl = process.env.NODE_ENV === 'development' || process.env.ELECTRON_VITE_DEV_URL
        ? `${process.env.ELECTRON_VITE_DEV_URL || 'http://localhost:5173'}/background.html`
        : path.join(__dirname, '../renderer/background.html');
      if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_VITE_DEV_URL) {
        win.loadURL(bgUrl);
      } else {
        win.loadFile(bgUrl);
      }
    } else {
      // 主窗口和普通窗口加载主页面
      if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_VITE_DEV_URL) {
        win.loadURL(process.env.ELECTRON_VITE_DEV_URL || 'http://localhost:5173');
      } else {
        win.loadFile(path.join(__dirname, '../renderer/index.html'));
      }
    }
  }

  /**
   * 获取主窗口
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null;
  }

  /**
   * 根据 ID 获取窗口
   */
  getWindowById(id: number): BrowserWindow | null {
    const win = this.windows.get(id);
    return win && !win.isDestroyed() ? win : null;
  }

  /**
   * 根据分组获取所有窗口
   */
  getWindowsByGroup(group: string): BrowserWindow[] {
    const groupSet = this.groups.get(group);
    if (!groupSet) {
      return [];
    }

    const windows: BrowserWindow[] = [];
    for (const id of groupSet) {
      const win = this.getWindowById(id);
      if (win) {
        windows.push(win);
      }
    }
    return windows;
  }

  /**
   * 根据类型获取所有窗口
   */
  getWindowsByType(type: WindowProperties['type']): BrowserWindow[] {
    const windows: BrowserWindow[] = [];
    for (const win of this.windows.values()) {
      if (!win.isDestroyed() && win.__windowProperties?.type === type) {
        windows.push(win);
      }
    }
    return windows;
  }

  /**
   * 根据标签获取窗口
   */
  getWindowsByTag(tag: string): BrowserWindow[] {
    const windows: BrowserWindow[] = [];
    for (const win of this.windows.values()) {
      if (!win.isDestroyed() && win.__windowProperties?.tag === tag) {
        windows.push(win);
      }
    }
    return windows;
  }

  /**
   * 获取所有窗口
   */
  getAllWindows(): BrowserWindow[] {
    const windows: BrowserWindow[] = [];
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        windows.push(win);
      }
    }
    return windows;
  }

  /**
   * 获取窗口属性
   */
  getWindowProperties(win: BrowserWindow): WindowProperties | null {
    return win.__windowProperties || null;
  }

  /**
   * 更新窗口属性
   */
  updateWindowProperties(win: BrowserWindow, properties: Partial<WindowProperties>): void {
    if (!win.__windowProperties) {
      win.__windowProperties = { type: 'normal' };
    }
    Object.assign(win.__windowProperties, properties);

    // 如果分组改变，更新分组映射
    if (properties.group !== undefined) {
      // 从旧分组移除
      const oldGroup = win.__windowProperties.group;
      if (oldGroup) {
        const oldGroupSet = this.groups.get(oldGroup);
        if (oldGroupSet) {
          oldGroupSet.delete(win.id);
          if (oldGroupSet.size === 0) {
            this.groups.delete(oldGroup);
          }
        }
      }

      // 添加到新分组
      if (properties.group) {
        if (!this.groups.has(properties.group)) {
          this.groups.set(properties.group, new Set());
        }
        this.groups.get(properties.group)!.add(win.id);
      }
    }
  }

  /**
   * 关闭指定窗口
   */
  closeWindow(win: BrowserWindow): void {
    if (!win.isDestroyed()) {
      win.close();
    }
  }

  /**
   * 关闭指定分组的所有窗口
   */
  closeGroup(group: string): number {
    const windows = this.getWindowsByGroup(group);
    let closedCount = 0;

    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.close();
        closedCount++;
      }
    }

    console.log(`[WindowManager] 已关闭分组 "${group}" 的 ${closedCount} 个窗口`);
    return closedCount;
  }

  /**
   * 关闭指定类型的所有窗口
   */
  closeType(type: WindowProperties['type']): number {
    const windows = this.getWindowsByType(type);
    let closedCount = 0;

    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.close();
        closedCount++;
      }
    }

    console.log(`[WindowManager] 已关闭类型 "${type}" 的 ${closedCount} 个窗口`);
    return closedCount;
  }

  /**
   * 关闭所有窗口（除了主窗口）
   */
  closeAllWindows(exceptMain = true): number {
    const windows = this.getAllWindows();
    let closedCount = 0;

    for (const win of windows) {
      if (exceptMain && win === this.mainWindow) {
        continue;
      }
      if (!win.isDestroyed()) {
        win.close();
        closedCount++;
      }
    }

    console.log(`[WindowManager] 已关闭 ${closedCount} 个窗口`);
    return closedCount;
  }

  /**
   * 获取所有分组名称
   */
  getAllGroups(): string[] {
    return Array.from(this.groups.keys());
  }

  /**
   * 获取分组中的窗口数量
   */
  getGroupSize(group: string): number {
    return this.groups.get(group)?.size || 0;
  }
}
