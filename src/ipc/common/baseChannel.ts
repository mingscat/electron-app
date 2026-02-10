/**
 * Channel 基类：消除 call/listen 的重复模板代码
 *
 * 子类只需：
 *   1. 在 constructor 中 this.onCommand('xxx', this.handleXxx)
 *   2. 在 constructor 中 this.onEvent('yyy', this._onYyy.event)（可选）
 *   3. 实现具体的 handleXxx 方法
 */
import type { CancellationToken, IEvent, IServerChannel } from './types.js';
import { Event } from './event.js';

export type CommandHandler = (ctx: string, arg: unknown) => Promise<unknown>;

export abstract class BaseChannel implements IServerChannel<string> {
  private readonly commands = new Map<string, CommandHandler>();
  private readonly events = new Map<string, IEvent<unknown>>();

  /** 注册命令处理器 */
  protected onCommand(command: string, handler: CommandHandler): void {
    this.commands.set(command, handler);
  }

  /** 注册事件源 */
  protected onEvent(event: string, source: IEvent<unknown>): void {
    this.events.set(event, source);
  }

  /** IServerChannel.call —— 分发到注册的命令处理器 */
  call<T>(ctx: string, command: string, arg?: unknown, _cancellationToken?: CancellationToken): Promise<T> {
    const handler = this.commands.get(command);
    if (!handler) {
      return Promise.reject(new Error(`[${this.constructor.name}] 未知命令: ${command}`));
    }
    return handler(ctx, arg) as Promise<T>;
  }

  /** IServerChannel.listen —— 分发到注册的事件源 */
  listen<T>(_ctx: string, event: string, _arg?: unknown): IEvent<T> {
    const source = this.events.get(event);
    if (!source) {
      console.warn(`[${this.constructor.name}] 未知事件: ${event}`);
      return Event.None as IEvent<T>;
    }
    return source as IEvent<T>;
  }
}
