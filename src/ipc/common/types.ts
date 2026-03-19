/**
 * vscode 风格 IPC 类型定义（与 vscode base/parts/ipc 兼容）
 */

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

export const CancellationToken = {
  None: { isCancellationRequested: false } as CancellationToken,
  Cancelled: { isCancellationRequested: true } as CancellationToken,
};

export interface IDisposable {
  dispose(): void;
}

/** Channel：调用 command 或监听 event */
export interface IChannel {
  call<T>(command: string, arg?: unknown, cancellationToken?: CancellationToken): Promise<T>;
  listen<T>(event: string, arg?: unknown): IEvent<T>;
}

/** 服务端 Channel 实现 */
export interface IServerChannel<TContext = string> {
  call<T>(ctx: TContext, command: string, arg?: unknown, cancellationToken?: CancellationToken): Promise<T>;
  listen<T>(ctx: TContext, event: string, arg?: unknown): IEvent<T>;
}

/** 简单事件接口 */
export interface IEvent<T> {
  (listener: (e: T) => void): IDisposable;
}

/** 消息传递协议：发送 Buffer，接收 onMessage */
export interface IMessagePassingProtocol {
  send(buffer: ArrayBuffer | Uint8Array): void;
  readonly onMessage: IEvent<Uint8Array>;
  disconnect?(): void;
}

export interface ClientConnectionEvent {
  protocol: IMessagePassingProtocol;
  onDidClientDisconnect: IEvent<void>;
}
