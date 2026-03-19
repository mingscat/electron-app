/**
 * 渲染进程 IPC Client（vscode 风格）
 *
 * 继承 IPCClient，封装 preload 注入的 ipc 接口。
 *
 *   const client = ElectronIPCClient.create(ipc, 'window:1');
 *   const appChannel = client.getChannel<IAppChannel>('app');
 */
import { IPCClient } from '../common/ipc.js';
import type { IMessagePassingProtocol } from '../common/types.js';

/** 由 preload 注入的 ipc 接口 */
export interface IPreloadIPC {
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): (() => void) | void;
}

const HELLO = 'vscode:hello';
const MESSAGE = 'vscode:message';

export class ElectronIPCClient<TContext = string> extends IPCClient<TContext> {
  /**
   * 私有构造 —— 请使用 `ElectronIPCClient.create()`
   */
  private constructor(protocol: IMessagePassingProtocol, ctx: TContext) {
    super(protocol, ctx);
  }

  /**
   * 工厂方法 —— 构建 Protocol、发送 hello、返回就绪的 Client
   * @param ipc  preload 暴露的 ipc（contextBridge），需支持 send + on
   * @param ctx  上下文，会作为首包发给主进程（如 windowId）
   */
  static create<TContext = string>(ipc: IPreloadIPC, ctx: TContext): ElectronIPCClient<TContext> {
    const protocol = ElectronIPCClient.buildProtocol(ipc);
    ipc.send(HELLO);
    return new ElectronIPCClient(protocol, ctx);
  }

  // ─── 内部：构建 Protocol ─────────────────────────────

  private static buildProtocol(ipc: IPreloadIPC): IMessagePassingProtocol {
    const listeners: Array<(msg: Uint8Array) => void> = [];

    ipc.on(MESSAGE, (_: unknown, message: unknown) => {
      if (!message) {
        console.warn('[ElectronIPCClient] Received null/undefined message from main process');
        console.trace('[ElectronIPCClient] Stack trace for null message');
        return;
      }
      console.log(
        '[ElectronIPCClient] 收到消息，类型:',
        typeof message,
        '是否为ArrayBuffer:',
        message instanceof ArrayBuffer,
        '是否为Uint8Array:',
        message instanceof Uint8Array,
      );

      let buf: Uint8Array;
      try {
        if (message instanceof ArrayBuffer) {
          buf = new Uint8Array(message);
        } else if (message instanceof Uint8Array) {
          buf = message;
        } else {
          // Buffer 类型（Node.js Buffer）
          const b = message as Buffer;
          if (!b.buffer) {
            console.error('[ElectronIPCClient] Buffer has no buffer property');
            return;
          }
          buf = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        }
        listeners.forEach(l => l(buf));
      } catch (error) {
        console.error('[ElectronIPCClient] Error processing message:', error, message);
      }
    });

    return {
      send(buffer: ArrayBuffer | Uint8Array) {
        if (!buffer) {
          console.error('[ElectronIPCClient] Cannot send empty buffer');
          return;
        }
        const d = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
        if (!d.buffer) {
          console.error('[ElectronIPCClient] Uint8Array has no buffer property');
          return;
        }
        ipc.send(MESSAGE, d.buffer);
      },
      onMessage(listener: (m: Uint8Array) => void) {
        listeners.push(listener);
        return {
          dispose() {
            const i = listeners.indexOf(listener);
            if (i >= 0) listeners.splice(i, 1);
          },
        };
      },
    };
  }
}
