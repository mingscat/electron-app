/**
 * Background/Worker API 模块：后台窗口管理与任务执行
 */
import type {
  IBackgroundChannel,
  BackgroundTaskRequest,
  CreateBackgroundWindowResult,
  DestroyBackgroundWindowResult,
} from '../../types/background';

export class BackgroundApi {
  constructor(private readonly channel: IBackgroundChannel) {}

  /** 创建后台窗口（已存在则返回现有窗口） */
  createWindow(): Promise<CreateBackgroundWindowResult> {
    return this.channel.call('createBackgroundWindow');
  }

  /** 执行后台任务 */
  executeTask(taskName: string, args: unknown[] = []): Promise<unknown> {
    return this.channel.call('executeTask', { taskName, args } satisfies BackgroundTaskRequest);
  }

  /** 销毁后台窗口 */
  destroyWindow(): Promise<DestroyBackgroundWindowResult> {
    return this.channel.call('destroyBackgroundWindow');
  }
}
