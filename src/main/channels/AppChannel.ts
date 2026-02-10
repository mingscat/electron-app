/**
 * App 通道：应用基础信息
 *
 * 命令：getVersion / ping
 * 事件：onLog —— 主进程日志推送给渲染进程（示例事件）
 */
import { app } from 'electron';
import type { IServerChannel } from '../../ipc/common/types';
import { BaseChannel } from '../../ipc/common/baseChannel';
import { Emitter } from '../../ipc/common/event';

/** 日志条目 */
export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

class AppChannel extends BaseChannel {
  private readonly _onLog = new Emitter<LogEntry>();

  constructor() {
    super();
    // ─── 命令 ───
    this.onCommand('getVersion', this.handleGetVersion);
    this.onCommand('ping', this.handlePing);

    // ─── 事件 ───
    this.onEvent('onLog', this._onLog.event);
  }

  private handleGetVersion = async (): Promise<string> => {
    return app.getVersion();
  };

  private handlePing = async (_ctx: string, arg: unknown): Promise<{ pong: true; arg: unknown }> => {
    return { pong: true, arg };
  };

  /** 供其他模块调用：向渲染进程推送日志 */
  pushLog(level: LogEntry['level'], message: string): void {
    this._onLog.fire({ level, message, timestamp: Date.now() });
  }
}

export function createAppChannel(): IServerChannel<string> {
  return new AppChannel();
}

export { AppChannel };
