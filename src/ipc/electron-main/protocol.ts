/**
 * 主进程侧：基于 WebContents 的 Protocol，与 vscode 一致使用 vscode:message
 */
import type { IMessagePassingProtocol } from '../common/types.js';
import type { IEvent } from '../common/types.js';
import type { WebContents } from 'electron';

export function createProtocol(webContents: WebContents, onMessage: IEvent<Uint8Array>): IMessagePassingProtocol {
  return {
    send(buffer: ArrayBuffer | Uint8Array) {
      try {
        const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
        webContents.send('vscode:message', Buffer.from(data));
      } catch {
        // ignore
      }
    },
    onMessage,
  };
}
