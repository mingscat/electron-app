/**
 * Electron 相关类型扩展
 */

import type { BrowserWindow } from 'electron';

/**
 * 扩展 BrowserWindow 类型（如果需要）
 */
export interface ExtendedBrowserWindow extends BrowserWindow {
  // 可以在这里添加自定义属性或方法
}

/**
 * 窗口配置类型
 */
export interface WindowConfig {
  width?: number;
  height?: number;
  show?: boolean;
  webPreferences?: {
    preload?: string;
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
  };
}
