/**
 * 主进程 IPC Server（vscode 风格）
 *
 * 继承 IPCServer，封装 Electron ipcMain 的 hello / message / disconnect 协议。
 *
 *   const server = ElectronIPCServer.create<string>();
 *   server.registerChannel('app', appChannel);
 */
import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import type { ClientConnectionEvent, IDisposable } from '../common/types.js';
import { IPCServer } from '../common/ipc.js';

const HELLO = 'vscode:hello';
const MESSAGE = 'vscode:message';
const DISCONNECT = 'vscode:disconnect';

export class ElectronIPCServer<TContext = string> extends IPCServer<TContext> {
  /**
   * 私有构造 —— 请使用 `ElectronIPCServer.create()`
   */
  private constructor(
    onDidClientConnect: (listener: (e: ClientConnectionEvent) => void) => IDisposable,
  ) {
    super(onDidClientConnect);
  }

  /**
   * 工厂方法 —— 创建 ElectronIPCServer 并绑定 ipcMain 事件
   */
  static create<TContext = string>(): ElectronIPCServer<TContext> {
    return new ElectronIPCServer(ElectronIPCServer.buildConnectionListener());
  }

  // ─── 内部：构建"客户端连接"事件源 ────────────────────

  private static buildConnectionListener(): (listener: (e: ClientConnectionEvent) => void) => IDisposable {
    const listeners: Array<(e: ClientConnectionEvent) => void> = [];

    ipcMain.on(HELLO, (event: Electron.IpcMainEvent) => {
      const webContents = event.sender as WebContents;
      const senderId = webContents.id;

      // ── 每个连接独立的 listener 集合 ──
      const messageListeners: Array<(msg: Uint8Array) => void> = [];
      const disconnectListeners: Array<() => void> = [];

      // ── ipcMain 事件转发 ──
      const msgHandler = (
        ev: Electron.IpcMainEvent,
        message: Buffer | ArrayBuffer | Uint8Array | null,
      ) => {
        if (ev.sender.id !== senderId) return;
        if (message) {
          const buf =
            message instanceof ArrayBuffer
              ? new Uint8Array(message)
              : message instanceof Uint8Array
                ? message
                : new Uint8Array(
                    (message as Buffer).buffer,
                    (message as Buffer).byteOffset,
                    (message as Buffer).byteLength,
                  );
          messageListeners.forEach(l => l(buf));
        }
      };

      const disconnectHandler = (ev: Electron.IpcMainEvent) => {
        if (ev.sender.id !== senderId) return;
        ipcMain.removeListener(MESSAGE, msgHandler);
        ipcMain.removeListener(DISCONNECT, disconnectHandler);
        disconnectListeners.forEach(l => l());
      };

      ipcMain.on(MESSAGE, msgHandler);
      ipcMain.on(DISCONNECT, disconnectHandler);

      // ── 构造 protocol ──
      const protocol: ClientConnectionEvent['protocol'] = {
        send(buffer: ArrayBuffer | Uint8Array) {
          try {
            if (!buffer) {
              console.error('[ElectronIPCServer] Cannot send null/undefined buffer');
              return;
            }
            const d = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
            if (!d || d.length === 0) {
              console.error('[ElectronIPCServer] Buffer is empty after conversion');
              return;
            }
            const nodeBuffer = Buffer.from(d);
            if (!nodeBuffer || nodeBuffer.length === 0) {
              console.error('[ElectronIPCServer] Failed to create Node.js Buffer');
              return;
            }
            webContents.send(MESSAGE, nodeBuffer);
          } catch (error) {
            console.error('[ElectronIPCServer] Error sending message:', error, buffer);
          }
        },
        onMessage(listener: (m: Uint8Array) => void) {
          messageListeners.push(listener);
          return {
            dispose() {
              const i = messageListeners.indexOf(listener);
              if (i >= 0) messageListeners.splice(i, 1);
            },
          };
        },
      };

      const onDidClientDisconnect = (listener: () => void) => {
        disconnectListeners.push(listener);
        return {
          dispose() {
            const i = disconnectListeners.indexOf(listener);
            if (i >= 0) disconnectListeners.splice(i, 1);
          },
        };
      };

      // ── 通知所有订阅者 ──
      listeners.forEach(l => l({ protocol, onDidClientDisconnect }));
    });

    return (listener: (e: ClientConnectionEvent) => void) => {
      listeners.push(listener);
      return {
        dispose() {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    };
  }
}
