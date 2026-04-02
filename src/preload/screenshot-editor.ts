/**
 * Screenshot Editor Preload Script
 *
 * 暴露截图编辑器需要的API给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ImageData, ScreenshotResult, Area, Annotation } from '../types/screenshot.js';

// 截图数据接口
interface ScreenshotData {
  imageData: ImageData;
  displays: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
  }>;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// 暴露给渲染进程的API
const screenshotEditorAPI = {
  // 接收截图数据
  onScreenshotData(callback: (data: ScreenshotData) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, data: ScreenshotData) => {
      callback(data);
    };
    ipcRenderer.on('screenshot:data', handler);
    return () => ipcRenderer.removeListener('screenshot:data', handler);
  },

  // 完成截图
  complete(result: ScreenshotResult): void {
    ipcRenderer.send('screenshot:complete', result);
  },

  // 取消截图
  cancel(): void {
    ipcRenderer.send('screenshot:cancel');
  },

  // 复制到剪贴板
  async copyToClipboard(dataUrl: string): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('screenshot:copy', dataUrl);
  },

  // 保存文件
  async saveToFile(dataUrl: string, filePath: string): Promise<{ success: boolean; path: string }> {
    return ipcRenderer.invoke('screenshot:save', dataUrl, filePath);
  },
};

contextBridge.exposeInMainWorld('screenshotEditor', screenshotEditorAPI);

// 类型声明
declare global {
  interface Window {
    screenshotEditor: typeof screenshotEditorAPI;
  }
}
