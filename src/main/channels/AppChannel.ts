import type { CancellationToken, IEvent, IServerChannel } from '../../ipc/common/types';

type CommandHandler = (ctx: string, arg: unknown) => Promise<unknown>;

class AppChannel implements IServerChannel<string> {
    private readonly handlers = new Map<string, CommandHandler>();

    constructor() {
        // ─── 命令注册表（新增命令只需加一行 + 对应方法） ───
        this.on('getVersion', this.getVersion);
        this.on('ping', this.ping);
    }

    // ─── 命令处理方法 ──────────────────────────────

    /** 获取应用版本号 */
    private getVersion = async (): Promise<string> => {
        // TODO: 可从 package.json 或 app.getVersion() 读取
        return '1.0.0';
    };

    /** 网络 ping 测试 */
    private ping = async (_ctx: string, arg: unknown): Promise<{ pong: true; arg: unknown }> => {
        return { pong: true, arg };
    };

    // ─── 基础设施（通常不需要修改） ─────────────────

    call<T>(ctx: string, command: string, arg?: unknown, _cancellationToken?: CancellationToken): Promise<T> {
        const handler = this.handlers.get(command);
        if (!handler) {
            return Promise.reject(new Error(`[AppChannel] Unknown command: ${command}`));
        }
        return handler(ctx, arg) as Promise<T>;
    }

    listen<T>(_ctx: string, _event: string, _arg?: unknown): IEvent<T> {
        throw new Error('[AppChannel] listen not implemented');
    }

    private on(command: string, handler: CommandHandler): void {
        this.handlers.set(command, handler);
    }
}

export function createAppChannel(): IServerChannel<string> {
    return new AppChannel();
}
