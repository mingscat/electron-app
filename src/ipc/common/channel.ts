/**
 * vscode 风格 ChannelServer / ChannelClient（主进程注册 channel，渲染进程 getChannel 调用）
 */
import type { IChannel, IServerChannel, IEvent, CancellationToken, IDisposable } from './types.js';
import { CancellationToken as CT } from './types.js';
import { VSBuffer } from './buffer.js';
import { BufferReader, BufferWriter, serialize, deserialize } from './serializer.js';
import type { IMessagePassingProtocol } from './types.js';
import { Event } from './event.js';

const enum RequestType {
  Promise = 100,
  PromiseCancel = 101,
  EventListen = 102,
  EventDispose = 103,
}

const enum ResponseType {
  Initialize = 200,
  PromiseSuccess = 201,
  PromiseError = 202,
  PromiseErrorObj = 203,
  EventFire = 204,
}

type IRawPromiseRequest = { type: RequestType.Promise; id: number; channelName: string; name: string; arg: unknown };
type IRawEventListenRequest = { type: RequestType.EventListen; id: number; channelName: string; name: string; arg: unknown };
type IRawDisposeRequest = { type: RequestType.PromiseCancel | RequestType.EventDispose; id: number };

type IRawPromiseSuccessResponse = { type: ResponseType.PromiseSuccess; id: number; data: unknown };
type IRawPromiseErrorResponse = { type: ResponseType.PromiseError; id: number; data: { message: string; name: string; stack?: string[] } };
type IRawEventFireResponse = { type: ResponseType.EventFire; id: number; data: unknown };

export class ChannelServer<TContext = string> implements IDisposable {
  private channels = new Map<string, IServerChannel<TContext>>();
  private protocolListener: IDisposable | null = null;

  constructor(
    private protocol: IMessagePassingProtocol,
    private ctx: TContext
  ) {
    this.protocolListener = protocol.onMessage(msg => this.onMessage(msg));
    this.sendResponse([ResponseType.Initialize]);
  }

  registerChannel(channelName: string, channel: IServerChannel<TContext>): void {
    this.channels.set(channelName, channel);
  }

  private sendResponse(header: unknown[], body?: unknown): void {
    const writer = new BufferWriter();
    serialize(writer, header);
    serialize(writer, body);
    const buf = writer.buffer;
    if (!buf || !buf.buffer) {
      console.error('[ChannelServer] Failed to serialize response', header, body);
      return;
    }
    console.log(`[ChannelServer] 发送响应: header=`, header, `body=`, body, `buffer长度=`, buf.buffer.byteLength);
    this.protocol.send(buf.buffer);
  }

  private onMessage(message: Uint8Array): void {
    if (!message || message.length === 0) {
      console.error('[ChannelServer] Received empty or invalid message');
      return;
    }
    try {
      const reader = new BufferReader(VSBuffer.wrap(message));
      const header = deserialize(reader) as number[];
      const body = deserialize(reader);
      const type = header[0] as RequestType;
      const id = header[1] as number;

      if (type === RequestType.Promise) {
        const channelName = header[2] as unknown as string;
        const name = header[3] as unknown as string;
        const channel = this.channels.get(channelName);
        console.log(`[ChannelServer] 收到请求: channel=${channelName}, command=${name}, id=${id}`, body);
        if (channel) {
          channel
            .call(this.ctx, name, body, CT.None)
            .then(data => {
              console.log(`[ChannelServer] 响应成功: id=${id}, data=`, data);
              this.sendResponse([ResponseType.PromiseSuccess, id], data);
            })
            .catch(err => {
              console.error(`[ChannelServer] 响应错误: id=${id}`, err);
              const data =
                err instanceof Error
                  ? { message: err.message, name: err.name, stack: err.stack?.split('\n') }
                  : err;
              this.sendResponse([ResponseType.PromiseError, id], data);
            });
        } else {
          console.error(`[ChannelServer] 未找到 channel: ${channelName}`);
          this.sendResponse([ResponseType.PromiseError, id], { message: `Channel not found: ${channelName}`, name: 'Error' });
        }
      } else if (type === RequestType.EventListen) {
        const channel = this.channels.get(header[2] as unknown as string);
        const name = header[3] as unknown as string;
        if (channel) {
          const event = channel.listen(this.ctx, name, body);
          const d = event((data: unknown) => this.sendResponse([ResponseType.EventFire, id], data));
          // 简单起见不维护 activeRequests 的 dispose（实际应在 onDisconnect 时清理）
        }
      }
    } catch (error) {
      console.error('[ChannelServer] Error processing message:', error, message);
    }
  }

  dispose(): void {
    this.protocolListener?.dispose();
    this.protocolListener = null;
  }
}

export class ChannelClient implements IDisposable {
  private isDisposed = false;
  private state: 'uninitialized' | 'idle' = 'uninitialized';
  private handlers = new Map<number, (res: any) => void>();
  private lastRequestId = 0;
  private protocolListener: IDisposable | null = null;
  private initResolve: (() => void) | null = null;
  private initPromise = new Promise<void>(r => {
    this.initResolve = r;
  });

  constructor(private protocol: IMessagePassingProtocol) {
    this.protocolListener = protocol.onMessage(msg => this.onMessage(msg));
  }

  getChannel<T extends IChannel>(channelName: string): T {
    const that = this;
    return {
      call(command: string, arg?: unknown, cancellationToken?: CancellationToken): Promise<unknown> {
        if (that.isDisposed) return Promise.reject(new Error('Disposed'));
        const id = that.lastRequestId++;
        return that.initPromise.then(() => {
          return new Promise((resolve, reject) => {
            that.handlers.set(id, (res: any) => {
              if (res.type === ResponseType.PromiseSuccess) resolve(res.data);
              else if (res.type === ResponseType.PromiseError) {
                const e = new Error(res.data?.message);
                if (res.data?.stack) e.stack = Array.isArray(res.data.stack) ? res.data.stack.join('\n') : res.data.stack;
                if (res.data?.name) e.name = res.data.name;
                reject(e);
              } else reject(res.data);
            });
            // header: [type, id, channelName, command], body: arg
            console.log(`[ChannelClient] 发送请求: channel=${channelName}, command=${command}, id=${id}`, arg);
            const writer = new BufferWriter();
            serialize(writer, [RequestType.Promise, id, channelName, command]);
            serialize(writer, arg);
            const buf = writer.buffer;
            if (!buf || !buf.buffer) {
              reject(new Error('Failed to serialize request'));
              return;
            }
            that.protocol.send(buf.buffer);
          });
        });
      },
      listen(event: string, arg?: unknown): IEvent<unknown> {
        if (that.isDisposed) return Event.None;
        return listener => {
          const id = that.lastRequestId++;
          that.handlers.set(id, (res: any) => {
            if (res.type === ResponseType.EventFire) listener(res.data);
          });
          that.initPromise.then(() => {
            // header: [type, id, channelName, event], body: arg
            const writer = new BufferWriter();
            serialize(writer, [RequestType.EventListen, id, channelName, event]);
            serialize(writer, arg);
            const buf = writer.buffer;
            if (buf && buf.buffer) {
              that.protocol.send(buf.buffer);
            }
          });
          return {
            dispose() {
              const w = new BufferWriter();
              serialize(w, [RequestType.EventDispose, id]);
              serialize(w, undefined);
              const buf = w.buffer;
              if (buf && buf.buffer) {
                that.protocol.send(buf.buffer);
              }
              that.handlers.delete(id);
            },
          };
        };
      },
    } as T;
  }

  private onMessage(message: Uint8Array): void {
    if (!message || message.length === 0) {
      console.error('[ChannelClient] Received empty or invalid message');
      return;
    }
    try {
      const reader = new BufferReader(VSBuffer.wrap(message));
      const header = deserialize(reader) as number[];
      const body = deserialize(reader);
      const type = header[0] as ResponseType;
      if (type === ResponseType.Initialize) {
        console.log('[ChannelClient] 收到 Initialize，连接已建立');
        this.state = 'idle';
        this.initResolve?.();
        return;
      }
      const id = header[1] as number;
      console.log(`[ChannelClient] 收到响应: type=${type}, id=${id}`, body);
      const handler = this.handlers.get(id);
      if (handler) {
        handler({ type, id, data: body });
      } else {
        console.warn(`[ChannelClient] 未找到 handler for id=${id}`);
      }
    } catch (error) {
      console.error('[ChannelClient] Error processing message:', error, message);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.protocolListener?.dispose();
    this.protocolListener = null;
  }
}
