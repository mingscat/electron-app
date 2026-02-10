/**
 * 后台窗口脚本：通过 IPC 接收并执行后台任务（class 写法）
 */
import type { IBackgroundIpc } from '../types/preload';
import type { BackgroundTaskHandler } from '../types/background';

class BackgroundWindowApp {
  private readonly taskHandlers = new Map<string, BackgroundTaskHandler>();

  constructor() {
    console.log('[BackgroundWindow] ========================================');
    console.log('[BackgroundWindow] 后台窗口脚本开始加载');
    console.log('[BackgroundWindow] 时间:', new Date().toISOString());
    console.log('[BackgroundWindow] ========================================');

    this.registerBuiltinTasks();
    this.setupTaskIpc();

    console.log('[BackgroundWindow] ========================================');
    console.log('[BackgroundWindow] ✓ 后台窗口初始化完成');
    console.log('[BackgroundWindow] ========================================');
  }

  // ─── 任务注册相关 ───────────────────────────────────

  private registerTask(name: string, handler: BackgroundTaskHandler): void {
    this.taskHandlers.set(name, handler);
    console.log(`[BackgroundWindow] ✓ 注册任务: ${name}`);
  }

  /** 内置任务（新增任务仅需在此处添加一行 registerTask） */
  private registerBuiltinTasks(): void {
    this.registerTask('ping', async () => {
      return { pong: true, timestamp: Date.now() };
    });

    this.registerTask('processData', async (...args: unknown[]) => {
      const data = args[0] as unknown[];
      console.log(`[BackgroundWindow] processData - 数据长度: ${data?.length || 0}`);
      return {
        processed: data?.map((item, index) => ({ index, value: item })),
        count: data?.length || 0,
      };
    });

    this.registerTask('longRunningTask', async () => {
      console.log('[BackgroundWindow] longRunningTask - 开始（5秒）...');
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ completed: true, duration: 5000 });
        }, 5000);
      });
    });

    console.log(`[BackgroundWindow] ✓ 已注册 ${this.taskHandlers.size} 个任务`);
  }

  // ─── IPC 任务监听（替代 window.executeBackgroundTask） ─

  private setupTaskIpc(): void {
    const bgIpc = window.backgroundIpc as IBackgroundIpc | undefined;
    if (!bgIpc) {
      console.warn('[BackgroundWindow] ⚠ 未找到 backgroundIpc，任务监听不可用');
      return;
    }

    console.log('[BackgroundWindow] 检测到 backgroundIpc，开始监听任务请求...');

    bgIpc.onTaskRequest(async (requestId: string, taskName: string, args: unknown[]) => {
      console.log(`[BackgroundWindow] ┌─ 收到任务请求 [${requestId}]`);
      console.log(`[BackgroundWindow] │  任务名称: ${taskName}`);
      console.log(`[BackgroundWindow] │  参数:`, args);

      const startTime = Date.now();
      const handler = this.taskHandlers.get(taskName);

      if (!handler) {
        console.error(`[BackgroundWindow] │  ✗ 未知任务: ${taskName}`);
        console.log(`[BackgroundWindow] └─ 任务失败`);
        bgIpc.sendTaskResponse(requestId, `Unknown task: ${taskName}`, null);
        return;
      }

      try {
        const result = await handler(...args);
        const duration = Date.now() - startTime;
        console.log(`[BackgroundWindow] │  ✓ 任务成功（耗时 ${duration}ms）`);
        console.log(`[BackgroundWindow] └─ 任务完成`);
        bgIpc.sendTaskResponse(requestId, null, result);
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[BackgroundWindow] │  ✗ 任务失败（耗时 ${duration}ms）:`, message);
        console.log(`[BackgroundWindow] └─ 任务失败`);
        bgIpc.sendTaskResponse(requestId, message, null);
      }
    });

    console.log('[BackgroundWindow] ✓ 任务请求监听已就绪');
  }
}

// 立即启动后台应用
new BackgroundWindowApp();
