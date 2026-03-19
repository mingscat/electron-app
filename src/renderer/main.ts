/**
 * 渲染进程入口
 *
 * 使用模块化 API 与主进程通信：
 *   api.app.getVersion()
 *   api.background.executeTask('ping')
 *   api.http.get('https://...')
 */
import type { IPreloadIPC } from '../types/preload';
import { ElectronApp } from './api';

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
    const api = ElectronApp.create(ipc);
    log('✓ API 已就绪');

    // ─── 获取版本号 ─────────────────────────────────
    document.getElementById('btn-version')!.addEventListener('click', async () => {
      log('调用 app.getVersion...');
      try {
        const v = await api.app.getVersion();
        log(`✓ 版本: ${v}`);
      } catch (e) {
        log(`✗ getVersion 失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 创建后台窗口 ───────────────────────────────
    document.getElementById('btn-create-bg')!.addEventListener('click', async () => {
      log('创建后台窗口...');
      try {
        const result = await api.background.createWindow();
        log(`✓ 后台窗口: ${JSON.stringify(result)}`);
      } catch (e) {
        log(`✗ 创建失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 执行后台任务 ───────────────────────────────
    document.getElementById('btn-exec-task')!.addEventListener('click', async () => {
      log('执行后台任务 ping...');
      try {
        const result = await api.background.executeTask('ping');
        log(`✓ 任务完成: ${JSON.stringify(result)}`);
      } catch (e) {
        log(`✗ 任务失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── HTTP GET ───────────────────────────────────
    document.getElementById('btn-http-get')!.addEventListener('click', async () => {
      const urlInput = document.getElementById('http-url') as HTMLInputElement;
      const url = urlInput.value.trim() || 'https://httpbin.org/get';
      log(`HTTP GET ${url} ...`);
      try {
        const res = await api.http.get(url);
        log(`✓ HTTP ${res.status} ${res.statusText}`);
        log(`  data: ${JSON.stringify(res.data).slice(0, 200)}`);
      } catch (e) {
        log(`✗ HTTP 失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── HTTP POST ──────────────────────────────────
    document.getElementById('btn-http-post')!.addEventListener('click', async () => {
      const urlInput = document.getElementById('http-url') as HTMLInputElement;
      const url = urlInput.value.trim() || 'https://httpbin.org/post';
      const body = { hello: 'world', timestamp: Date.now() };
      log(`HTTP POST ${url} ...`);
      try {
        const res = await api.http.post(url, body);
        log(`✓ HTTP ${res.status} ${res.statusText}`);
        log(`  data: ${JSON.stringify(res.data).slice(0, 200)}`);
      } catch (e) {
        log(`✗ HTTP 失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 文件写入 ─────────────────────────────────────
    document.getElementById('btn-file-write')!.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-path') as HTMLInputElement;
      const filePath = fileInput.value.trim();
      if (!filePath) { log('✗ 请输入文件路径'); return; }
      const content = `Hello from Electron App!\n时间: ${new Date().toISOString()}\n`;
      log(`写入文件: ${filePath} ...`);
      try {
        await api.file.writeText(filePath, content);
        log(`✓ 文件已写入: ${filePath}`);
      } catch (e) {
        log(`✗ 写入失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 文件读取 ─────────────────────────────────────
    document.getElementById('btn-file-read')!.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-path') as HTMLInputElement;
      const filePath = fileInput.value.trim();
      if (!filePath) { log('✗ 请输入文件路径'); return; }
      log(`读取文件: ${filePath} ...`);
      try {
        const content = await api.file.readText(filePath);
        log(`✓ 内容 (${content.length} 字符):\n${content.slice(0, 500)}`);
      } catch (e) {
        log(`✗ 读取失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 文件存在检查 ─────────────────────────────────
    document.getElementById('btn-file-exists')!.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-path') as HTMLInputElement;
      const filePath = fileInput.value.trim();
      if (!filePath) { log('✗ 请输入路径'); return; }
      try {
        const exists = await api.file.exists(filePath);
        log(`✓ ${filePath} → ${exists ? '存在' : '不存在'}`);
      } catch (e) {
        log(`✗ 检查失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 列出目录 ─────────────────────────────────────
    document.getElementById('btn-file-listdir')!.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-path') as HTMLInputElement;
      const dirPath = fileInput.value.trim();
      if (!dirPath) { log('✗ 请输入目录路径'); return; }
      log(`列出目录: ${dirPath} ...`);
      try {
        const files = await api.file.listDir(dirPath);
        log(`✓ 共 ${files.length} 项:`);
        for (const f of files.slice(0, 20)) {
          const icon = f.isDirectory ? '📁' : '📄';
          log(`  ${icon} ${f.name}  (${f.size} bytes)`);
        }
        if (files.length > 20) log(`  ... 还有 ${files.length - 20} 项`);
      } catch (e) {
        log(`✗ 列出失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    // ─── 删除文件 ─────────────────────────────────────
    document.getElementById('btn-file-remove')!.addEventListener('click', async () => {
      const fileInput = document.getElementById('file-path') as HTMLInputElement;
      const filePath = fileInput.value.trim();
      if (!filePath) { log('✗ 请输入路径'); return; }
      log(`删除: ${filePath} ...`);
      try {
        await api.file.remove(filePath);
        log(`✓ 已删除: ${filePath}`);
      } catch (e) {
        log(`✗ 删除失败: ${e instanceof Error ? e.message : e}`);
      }
    });

    log('已就绪，可点击按钮测试');
  } catch (error) {
    log(`初始化失败: ${error}`);
    console.error('[Renderer] 初始化失败:', error);
  }
}
