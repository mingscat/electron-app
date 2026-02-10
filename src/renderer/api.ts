/**
 * 渲染进程高层 API —— 封装 IPC Channel，提供直接方法调用
 *
 * 用法：
 *   import { createApp } from './api';
 *   const app = createApp(ipc);
 *
 *   const version = await app.getVersion();
 *   await app.background.createWindow();
 *   const result = await app.background.executeTask('ping', []);
 */
import type { IPreloadIPC } from '../types/preload';
import type { IAppChannel } from '../types/ipc';
import type { IBackgroundChannel, BackgroundTaskRequest, CreateBackgroundWindowResult, DestroyBackgroundWindowResult } from '../types/background';
import { createIPCClient } from '../ipc/electron-browser/client';

// ─── 类型定义 ────────────────────────────────────────

/** app 子模块：应用信息与通用命令 */
export interface AppAPI {
    /** 获取应用版本号 */
    getVersion(): Promise<string>;
    /** Ping 测试 */
    ping(arg?: unknown): Promise<{ pong: boolean; arg?: unknown }>;

    /** 后台窗口相关操作 */
    readonly background: BackgroundAPI;

    /**
     * 通用调用（当命令尚未封装时的逃生口）
     * @example app.call('app', 'someNewCommand', payload)
     */
    call<T = unknown>(channel: string, command: string, arg?: unknown): Promise<T>;
}

/** app.background 子模块：后台窗口管理 */
export interface BackgroundAPI {
    /** 创建后台窗口 */
    createWindow(): Promise<CreateBackgroundWindowResult>;
    /** 执行后台任务 */
    executeTask(taskName: string, args?: unknown[]): Promise<unknown>;
    /** 销毁后台窗口 */
    destroyWindow(): Promise<DestroyBackgroundWindowResult>;
}

// ─── 实现 ────────────────────────────────────────────

/**
 * 创建渲染进程 app API
 *
 * @param ipc - 由 preload 注入的 ipcForVSCode
 * @param clientId - 可选的客户端标识，默认自动生成
 * @returns 链式调用的 app 对象
 */
export function createApp(ipc: IPreloadIPC, clientId?: string): AppAPI {
    const id = clientId ?? `window:${Date.now()}`;
    const client = createIPCClient(ipc, id);

    const appChannel = client.getChannel<IAppChannel>('app');
    const bgChannel = client.getChannel<IBackgroundChannel>('background');

    // ─── background 子模块 ───

    const background: BackgroundAPI = {
        createWindow() {
            return bgChannel.call('createBackgroundWindow');
        },
        executeTask(taskName: string, args: unknown[] = []) {
            return bgChannel.call('executeTask', { taskName, args } satisfies BackgroundTaskRequest);
        },
        destroyWindow() {
            return bgChannel.call('destroyBackgroundWindow');
        },
    };

    // ─── app 主对象 ───

    const app: AppAPI = {
        getVersion() {
            return appChannel.call('getVersion');
        },
        ping(arg?: unknown) {
            return appChannel.call('ping', arg);
        },

        background,

        call<T = unknown>(channel: string, command: string, arg?: unknown): Promise<T> {
            const ch = client.getChannel<IAppChannel>(channel);
            return ch.call<T>(command, arg);
        },
    };

    return app;
}
