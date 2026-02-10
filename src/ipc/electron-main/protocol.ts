/**
 * 主进程侧：基于 WebContents 的 Protocol
 *
 * 实现 IMessagePassingProtocol，通过 vscode:message 通道收发二进制消息。
 */
import type { IMessagePassingProtocol, IEvent } from '../common/types.js';
import type { WebContents } from 'electron';

const MESSAGE = 'vscode:message';

export class ElectronProtocol implements IMessagePassingProtocol {
  constructor(
    private readonly webContents: WebContents,
    public readonly onMessage: IEvent<Uint8Array>,
  ) {}

  /** 向渲染进程发送二进制消息 */
  send(buffer: ArrayBuffer | Uint8Array): void {
    try {
      const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
      this.webContents.send(MESSAGE, Buffer.from(data));
    } catch {
      // ignore — webContents 可能已销毁
    }
  }
}
