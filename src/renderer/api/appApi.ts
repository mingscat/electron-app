/**
 * App API 模块：应用基础信息、通用命令、事件订阅
 */
import type { IAppChannel } from '../../types/ipc';
import type { IDisposable } from '../../ipc/common/types';

/** 日志条目（与主进程 AppChannel 对齐） */
export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export class AppApi {
  constructor(private readonly channel: IAppChannel) {}

  /** 获取应用版本号 */
  getVersion(): Promise<string> {
    return this.channel.call('getVersion');
  }

  /** Ping 测试 */
  ping(arg?: unknown): Promise<{ pong: boolean; arg?: unknown }> {
    return this.channel.call('ping', arg);
  }

  /**
   * 订阅主进程日志推送
   * @returns IDisposable — 调用 .dispose() 取消订阅
   */
  onLog(listener: (entry: LogEntry) => void): IDisposable {
    return this.channel.listen<LogEntry>('onLog')(listener);
  }
}
