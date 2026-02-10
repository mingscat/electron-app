/**
 * 最小化 Event：订阅即返回 disposable
 */
import type { IDisposable } from './types.js';

export interface EmitterLike<T> {
  fire(value: T): void;
  event: (listener: (e: T) => void) => IDisposable;
}

export function once<T>(event: (listener: (e: T) => void) => IDisposable): (listener: (e: T) => void) => IDisposable {
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

export const Event = {
  None: (() => {
    const noop = () => ({ dispose: () => {} });
    return noop as (listener: (e: any) => void) => IDisposable;
  })(),
  once,
};
