/**
 * 主进程入口：通信采用 vscode 风格 IPC
 */
import { app } from 'electron';
import { ElectronApp } from './ElectronApp.js';

// 创建应用实例
const electronApp = new ElectronApp();

// 应用准备就绪后初始化
app.whenReady().then(() => {
  electronApp.initialize().catch((error) => {
    console.error('[Main] 应用初始化失败:', error);
    app.quit();
  });
});
