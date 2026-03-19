/**
 * 服务注册器：集中管理 Worker 所有服务
 *
 * 新增服务只需：
 *   1. 在 services/ 下创建服务 class
 *   2. 在本文件 registerAll() 中实例化并注册
 */
import type { BackgroundTaskHandler } from '../types/background';
import type { HttpRequestOptions } from '../types/http';
import { TaskService } from './services/taskService';
import { HttpService } from './services/httpService';

export class ServiceRegistry {
  private readonly handlers = new Map<string, BackgroundTaskHandler>();

  /** 注册单个服务 */
  register(name: string, handler: BackgroundTaskHandler): void {
    this.handlers.set(name, handler);
    console.log(`[ServiceRegistry] ✓ 注册服务: ${name}`);
  }

  /** 获取服务处理器 */
  get(name: string): BackgroundTaskHandler | undefined {
    return this.handlers.get(name);
  }

  /** 服务数量 */
  get size(): number {
    return this.handlers.size;
  }

  /** 所有已注册服务名 */
  get names(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 注册所有内置服务
   */
  registerAll(): this {
    const task = new TaskService();
    const http = new HttpService();

    // ─── 任务服务 ───────────────────────────────────
    this.register('ping', (...args) => task.ping());
    this.register('processData', (...args) => task.processData(...args));
    this.register('longRunningTask', () => task.longRunningTask());

    // ─── HTTP 服务（Worker 侧 HTTP 能力） ───────────
    this.register('http:request', async (...args) => {
      return http.request(args[0] as HttpRequestOptions);
    });
    this.register('http:get', async (...args) => {
      const [url, options] = args as [string, Partial<HttpRequestOptions>?];
      return http.get(url, options);
    });
    this.register('http:post', async (...args) => {
      const [url, body, options] = args as [string, HttpRequestOptions['body']?, Partial<HttpRequestOptions>?];
      return http.post(url, body, options);
    });

    return this;
  }
}

/**
 * 创建并注册所有服务
 */
export function createServiceRegistry(): ServiceRegistry {
  return new ServiceRegistry().registerAll();
}
