/**
 * IPC 相关类型定义
 */

import type { IChannel, IServerChannel } from '../ipc/common/types';

/**
 * IPC 客户端接口
 */
export interface IIPCClient {
  /**
   * 获取指定名称的 Channel
   */
  getChannel<T extends IChannel>(channelName: string): T;
}

/**
 * IPC 服务端接口
 */
export interface IIPCServer {
  /**
   * 注册 Channel
   */
  registerChannel(channelName: string, channel: IServerChannel<string>): void;
}

/**
 * App Channel 接口
 */
export interface IAppChannel {
  /**
   * 获取版本号
   */
  call(command: 'getVersion'): Promise<string>;

  /**
   * Ping 测试
   */
  call(command: 'ping', arg?: unknown): Promise<{ pong: boolean; arg?: unknown }>;

  /**
   * 通用调用
   */
  call<T = unknown>(command: string, arg?: unknown, cancellationToken?: import('../ipc/common/types').CancellationToken): Promise<T>;
  
  /**
   * 监听事件
   */
  listen<T = unknown>(event: string, arg?: unknown): import('../ipc/common/types').IEvent<T>;
}

/**
 * 主进程 IPC 服务接口
 */
export interface IMainProcessService {
  /**
   * 获取 Channel
   */
  getChannel<T extends IChannel>(channelName: string): T;
}
