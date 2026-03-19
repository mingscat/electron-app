/**
 * 任务服务：内置后台任务的具体实现
 *
 * 新增任务只需在 class 中添加方法，然后在 registerServices.ts 中注册
 */

export class TaskService {
  /** Ping 测试 */
  async ping(): Promise<{ pong: true; timestamp: number }> {
    return { pong: true, timestamp: Date.now() };
  }

  /** 数据处理任务 */
  async processData(...args: unknown[]): Promise<{ processed: unknown[]; count: number }> {
    const data = args[0] as unknown[];
    console.log(`[TaskService] processData - 数据长度: ${data?.length || 0}`);
    return {
      processed: data?.map((item, index) => ({ index, value: item })) ?? [],
      count: data?.length || 0,
    };
  }

  /** 长时间运行任务（模拟 5 秒） */
  async longRunningTask(): Promise<{ completed: true; duration: number }> {
    console.log('[TaskService] longRunningTask - 开始（5秒）...');
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ completed: true, duration: 5000 });
      }, 5000);
    });
  }
}
