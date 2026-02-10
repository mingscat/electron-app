/**
 * IPC 通道管理器：集中注册/管理各类通道
 *
 * 默认通道：
 * - app：基础应用信息（版本、ping 等）
 * - background：后台窗口创建、任务执行、销毁
 * - http：HTTP 网络请求（Node.js http/https）
 * - file：文件读写操作（Node.js fs）
 *
 * 支持外部注入自定义通道（便于扩展和测试）。
 */
import type { IPCServer } from '../ipc/common/ipc.js';
import type { IServerChannel } from '../ipc/common/types.js';
import type { WindowManager } from './WindowManager.js';
import { createAppChannel } from './channels/AppChannel';
import { createBackgroundChannel } from './channels/BackgroundChannel';
import { createHttpChannel } from './channels/HttpChannel';
import { createFileChannel } from './channels/FileChannel';

/** 通道工厂函数签名 */
type ChannelFactory = () => IServerChannel<string>;

/** 通道定义：名称 + 工厂 */
interface ChannelEntry {
  name: string;
  factory: ChannelFactory;
}

export class IPCChannelManager {
  private readonly channels: ChannelEntry[] = [];

  /**
   * 注册一个通道（工厂方式，延迟创建）
   */
  register(name: string, factory: ChannelFactory): this {
    this.channels.push({ name, factory });
    return this;
  }

  /**
   * 注册默认内置通道
   */
  registerDefaults(windowManager: WindowManager): this {
    return this
      .register('app', () => createAppChannel())
      .register('http', () => createHttpChannel())
      .register('file', () => createFileChannel())
      .register('background', () => createBackgroundChannel(windowManager));
  }

  /**
   * 将所有已注册的通道绑定到 IPC Server
   */
  bindTo(ipcServer: IPCServer<string>): void {
    for (const { name, factory } of this.channels) {
      ipcServer.registerChannel(name, factory());
      console.log(`[IPCChannelManager] ✓ ${name} channel 已注册`);
    }
  }
}

