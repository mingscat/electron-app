/**
 * 渲染进程入口
 *
 * 使用 app API 与主进程通信（不再需要了解 channel / call 机制）：
 *   app.getVersion()
 *   app.background.createWindow()
 *   app.background.executeTask('ping', [])
 */
import type { IPreloadIPC } from '../types/preload';
import { createApp } from './api';

const ipc = window.ipcForVSCode as IPreloadIPC | undefined;

if (!ipc) {
  document.getElementById('log')!.textContent = '未找到 ipcForVSCode（请通过 preload 注入）';
} else {
  const logEl = document.getElementById('log')!;
  const log = (msg: string) => {
    console.log('[Renderer]', msg);
    logEl.textContent = msg + '\n' + logEl.textContent;
  };

  try {
    log('正在初始化...');
    const app = createApp(ipc);
    log('✓ app 已就绪');

    // ─── 获取版本号 ───
    document.getElementById('btn-version')!.addEventListener('click', async () => {
      log('调用 getVersion...');
      try {
        const v = await app.getVersion();
        log(`✓ getVersion: ${v}`);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        log(`✗ getVersion 失败: ${error.message}`);
      }
    });

    // ─── 创建后台窗口 ───
    const btnCreateBg = document.createElement('button');
    btnCreateBg.textContent = '创建后台窗口';
    btnCreateBg.style.margin = '10px';
    btnCreateBg.addEventListener('click', async () => {
      try {
        const result = await app.background.createWindow();
        log(`✓ 后台窗口已创建: ${JSON.stringify(result)}`);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        log(`✗ 创建失败: ${error.message}`);
      }
    });
    document.body.appendChild(btnCreateBg);

    // ─── 执行后台任务 ───
    const btnExecuteTask = document.createElement('button');
    btnExecuteTask.textContent = '执行后台任务';
    btnExecuteTask.style.margin = '10px';
    btnExecuteTask.addEventListener('click', async () => {
      try {
        const result = await app.background.executeTask('ping');
        log(`✓ 任务完成: ${JSON.stringify(result)}`);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        log(`✗ 任务失败: ${error.message}`);
      }
    });
    document.body.appendChild(btnExecuteTask);

    log('已就绪，可点击按钮测试');
  } catch (error) {
    log(`初始化失败: ${error}`);
    console.error('[Renderer] 初始化失败:', error);
  }
}
