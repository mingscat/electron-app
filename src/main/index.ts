/**
 * 主进程入口
 *
 * 职责：
 *   1. 单实例锁定
 *   2. 全局错误兜底（在 ElectronApp 之前）
 *   3. 创建应用实例并初始化
 */
import { app } from 'electron';
import { ElectronApp } from './ElectronApp.js';

// ─── 单实例锁定 ────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] 已有实例运行，退出当前进程');
  app.quit();
} else {
  const electronApp = ElectronApp.create();

  // 第二个实例启动时，聚焦已有窗口
  app.on('second-instance', () => {
    const mainWin = electronApp.getWindowManager().getMainWindow();
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  // 应用就绪后初始化
  app.whenReady().then(() => {
    electronApp.initialize().catch((error) => {
      console.error('[Main] 应用初始化失败:', error);
      app.quit();
    });
  });
}
