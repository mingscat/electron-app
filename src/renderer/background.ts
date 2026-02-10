/**
 * Worker 窗口入口：通过 IPC 接收并执行后台任务
 *
 * 服务实现已拆分至 worker/services/，本文件只做：
 *   1. 初始化服务注册表
 *   2. 监听 IPC 任务请求并路由到对应服务
 */
import type { IBackgroundIpc } from '../types/preload';
import { createServiceRegistry } from '../worker/registerServices';

class WorkerApp {
  private readonly registry = createServiceRegistry();

  constructor() {
    console.log('[Worker] ========================================');
    console.log('[Worker] Worker 窗口开始加载');
    console.log('[Worker] 时间:', new Date().toISOString());
    console.log('[Worker] ========================================');

    this.setupTaskIpc();

    console.log(`[Worker] ✓ 已注册 ${this.registry.size} 个服务: [${this.registry.names.join(', ')}]`);
    console.log('[Worker] ========================================');
    console.log('[Worker] ✓ Worker 初始化完成');
    console.log('[Worker] ========================================');
  }

  /**
   * 设置 IPC 任务监听：接收主进程转发的任务请求，路由到服务注册表
   */
  private setupTaskIpc(): void {
    const bgIpc = window.backgroundIpc as IBackgroundIpc | undefined;
    if (!bgIpc) {
      console.warn('[Worker] ⚠ 未找到 backgroundIpc，任务监听不可用');
      return;
    }

    console.log('[Worker] 检测到 backgroundIpc，开始监听任务请求...');

    bgIpc.onTaskRequest(async (requestId: string, taskName: string, args: unknown[]) => {
      console.log(`[Worker] ┌─ 收到任务请求 [${requestId}]`);
      console.log(`[Worker] │  任务名称: ${taskName}`);

      const startTime = Date.now();
      const handler = this.registry.get(taskName);

      if (!handler) {
        console.error(`[Worker] │  ✗ 未知任务: ${taskName}`);
        console.log(`[Worker] └─ 任务失败`);
        bgIpc.sendTaskResponse(requestId, `Unknown task: ${taskName}`, null);
        return;
      }

      try {
        const result = await handler(...args);
        const duration = Date.now() - startTime;
        console.log(`[Worker] │  ✓ 任务成功（耗时 ${duration}ms）`);
        console.log(`[Worker] └─ 任务完成`);
        bgIpc.sendTaskResponse(requestId, null, result);
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Worker] │  ✗ 任务失败（耗时 ${duration}ms）:`, message);
        console.log(`[Worker] └─ 任务失败`);
        bgIpc.sendTaskResponse(requestId, message, null);
      }
    });

    console.log('[Worker] ✓ 任务请求监听已就绪');
  }
}

// 立即启动 Worker
new WorkerApp();
