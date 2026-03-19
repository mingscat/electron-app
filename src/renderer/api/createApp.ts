/**
 * 渲染进程 API 入口 —— 组装所有模块，返回统一 API 实例
 *
 * 用法（推荐工厂方法）：
 *   import { ElectronApp } from './api';
 *   const api = ElectronApp.create(ipc);
 *
 *   await api.app.getVersion();
 *   await api.background.executeTask('ping');
 *   const res = await api.http.get('https://api.example.com/data');
 *
 *   // 事件订阅
 *   const disposable = api.app.onLog((entry) => console.log(entry));
 *   disposable.dispose(); // 取消订阅
 *
 * 测试时可直接注入 mock 依赖：
 *   const api = new ElectronApp({ app: mockAppApi, ... });
 */
import type { IPreloadIPC } from '../../types/preload';
import type { IAppChannel } from '../../types/ipc';
import type { IBackgroundChannel } from '../../types/background';
import type { IHttpChannel } from '../../types/http';
import type { IFileChannel } from '../../types/file';
import { ElectronIPCClient } from '../../ipc/electron-browser/client';
import { AppApi } from './appApi';
import { BackgroundApi } from './backgroundApi';
import { HttpApi } from './httpApi';
import { FileApi } from './fileApi';

/** ElectronApp 依赖项 */
export interface ElectronAppDeps {
  app: AppApi;
  background: BackgroundApi;
  http: HttpApi;
  file: FileApi;
  /** 通用调用（逃生口），可选 */
  call?: <T = unknown>(channel: string, command: string, arg?: unknown) => Promise<T>;
}

export class ElectronApp {
  /** 应用信息 */
  readonly app: AppApi;
  /** 后台 Worker 管理 */
  readonly background: BackgroundApi;
  /** HTTP 网络请求 */
  readonly http: HttpApi;
  /** 文件读写 */
  readonly file: FileApi;

  private readonly _call?: ElectronAppDeps['call'];

  /**
   * 直接注入依赖（测试 / 自定义场景）
   */
  constructor(deps: ElectronAppDeps) {
    this.app = deps.app;
    this.background = deps.background;
    this.http = deps.http;
    this.file = deps.file;
    this._call = deps.call;
  }

  /**
   * 工厂方法 —— 自动创建 IPC Client 和全部 API 实例
   */
  static create(ipc: IPreloadIPC, clientId?: string): ElectronApp {
    const id = clientId ?? `window:${Date.now()}`;
    const client = ElectronIPCClient.create(ipc, id);

    return new ElectronApp({
      app: new AppApi(client.getChannel<IAppChannel>('app')),
      background: new BackgroundApi(client.getChannel<IBackgroundChannel>('background')),
      http: new HttpApi(client.getChannel<IHttpChannel>('http')),
      file: new FileApi(client.getChannel<IFileChannel>('file')),
      call: <T = unknown>(channel: string, command: string, arg?: unknown) => {
        const ch = client.getChannel<IAppChannel>(channel);
        return ch.call<T>(command, arg);
      },
    });
  }

  /**
   * 通用调用（逃生口：当 channel 尚未封装时使用）
   * @example api.call('custom', 'someCommand', payload)
   */
  call<T = unknown>(channel: string, command: string, arg?: unknown): Promise<T> {
    if (!this._call) {
      throw new Error('ElectronApp: call() 不可用，请通过 ElectronApp.create() 创建实例');
    }
    return this._call<T>(channel, command, arg);
  }
}
