/**
 * 事件工具：Emitter（fire/event）+ once + Event.None
 */
import type { IDisposable, IEvent } from './types.js';

export interface EmitterLike<T> {
  fire(value: T): void;
  event: IEvent<T>;
}

/**
 * 通用事件发射器
 *
 * Channel 中使用方式：
 *   private readonly _onProgress = new Emitter<number>();
 *   // listen() 中返回 this._onProgress.event
 *   // 业务逻辑中 this._onProgress.fire(50)
 */
export class Emitter<T> implements EmitterLike<T> {
  private listeners: Array<(e: T) => void> = [];
  private _disposed = false;

  /** 订阅事件 */
  readonly event: IEvent<T> = (listener: (e: T) => void): IDisposable => {
    if (this._disposed) return { dispose() {} };
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  };

  /** 触发事件，通知所有订阅者 */
  fire(value: T): void {
    if (this._disposed) return;
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  /** 清理所有订阅者 */
  dispose(): void {
    this._disposed = true;
    this.listeners = [];
  }
}

/**
 * 事件工具类（静态成员）
 */
export class Event {
  /** 空事件（永远不会触发） */
  static readonly None: IEvent<any> = () => ({ dispose() {} });

  /** 将事件包装为只触发一次 */
  static once<T>(event: IEvent<T>): IEvent<T> {
    return (listener: (e: T) => void): IDisposable => {
      let disposed = false;
      const d = event(e => {
        if (disposed) return;
        d.dispose();
        disposed = true;
        listener(e);
      });
      return {
        dispose() {
          if (!disposed) {
            disposed = true;
            d.dispose();
          }
        },
      };
    };
  }
}
