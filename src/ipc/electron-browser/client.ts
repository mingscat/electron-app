/**
 * 渲染进程 IPC Client（vscode 风格）：先发 vscode:hello，再通过 Protocol 收发 vscode:message
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
const DISCONNECT = 'vscode:disconnect';

/**
 * 创建与主进程通信的 IPCClient。
 * @param ipc preload 暴露的 ipc（contextBridge），需支持 send + on
 * @param ctx 上下文，会作为首包发给主进程（如 windowId）
 */
export function createIPCClient<TContext = string>(ipc: IPreloadIPC, ctx: TContext): IPCClient<TContext> {
  const listeners: Array<(msg: Uint8Array) => void> = [];

  ipc.on(MESSAGE, (_: unknown, message: unknown) => {
    if (!message) {
      console.warn('[IPCClient] Received null/undefined message from main process');
      console.trace('[IPCClient] Stack trace for null message');
      return;
    }
    console.log('[IPCClient] 收到消息，类型:', typeof message, '是否为ArrayBuffer:', message instanceof ArrayBuffer, '是否为Uint8Array:', message instanceof Uint8Array);
    // 主进程发送的 Buffer，转换为 Uint8Array
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
          console.error('[IPCClient] Buffer has no buffer property');
          return;
        }
        buf = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      }
      listeners.forEach(l => l(buf));
    } catch (error) {
      console.error('[IPCClient] Error processing message:', error, message);
    }
  });
  ipc.send(HELLO);

  const protocol: IMessagePassingProtocol = {
    send(buffer: ArrayBuffer | Uint8Array) {
      if (!buffer) {
        console.error('[IPCClient] Cannot send empty buffer');
        return;
      }
      const d = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
      // 传递 ArrayBuffer（preload 会转换为 Buffer）
      if (!d.buffer) {
        console.error('[IPCClient] Uint8Array has no buffer property');
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

  return new IPCClient(protocol, ctx);
}
