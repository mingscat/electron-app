/**
 * 主进程 IPC Server（vscode 风格）：vscode:hello / vscode:message / vscode:disconnect
 */
import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import type { ClientConnectionEvent } from '../common/types.js';
import { IPCServer } from '../common/ipc.js';

const HELLO = 'vscode:hello';
const MESSAGE = 'vscode:message';
const DISCONNECT = 'vscode:disconnect';

/** 创建“客户端连接”事件源：收到 hello 时对应该 sender 的 protocol + onDidClientDisconnect */
function createOnDidClientConnect(): (listener: (e: ClientConnectionEvent) => void) => { dispose(): void } {
  const listeners: Array<(e: ClientConnectionEvent) => void> = [];

  ipcMain.on(HELLO, (event: Electron.IpcMainEvent) => {
    const webContents = event.sender as WebContents;
    const senderId = webContents.id;

    const messageListeners: Array<(msg: Uint8Array) => void> = [];
    const disconnectListeners: Array<() => void> = [];

    const msgHandler = (ev: Electron.IpcMainEvent, message: Buffer | ArrayBuffer | Uint8Array | null) => {
      if (ev.sender.id !== senderId) return;
      if (message) {
        const buf = message instanceof ArrayBuffer ? new Uint8Array(message) : message instanceof Uint8Array ? message : new Uint8Array((message as Buffer).buffer, (message as Buffer).byteOffset, (message as Buffer).byteLength);
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

    const protocol: ClientConnectionEvent['protocol'] = {
      send(buffer: ArrayBuffer | Uint8Array) {
        try {
          if (!buffer) {
            console.error('[IPC Server] Cannot send null/undefined buffer');
            return;
          }
          const d = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
          if (!d || d.length === 0) {
            console.error('[IPC Server] Buffer is empty after conversion');
            return;
          }
          const nodeBuffer = Buffer.from(d);
          if (!nodeBuffer || nodeBuffer.length === 0) {
            console.error('[IPC Server] Failed to create Node.js Buffer');
            return;
          }
          webContents.send(MESSAGE, nodeBuffer);
        } catch (error) {
          console.error('[IPC Server] Error sending message:', error, buffer);
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

export function createIPCServer<TContext = string>(): IPCServer<TContext> {
  return new IPCServer(createOnDidClientConnect());
}
