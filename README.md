# Electron App

> Electron 桌面应用模板 — VSCode 风格 IPC + Worker 服务层 + HTTP 网络 + 文件读写

## 架构总览

```
src/
├─ ipc/                          # VSCode 风格 IPC 通信层
│  ├─ common/                    # 通用协议（序列化、Channel、Event）
│  │  ├─ buffer.ts               #   VSBuffer 二进制封装
│  │  ├─ channel.ts              #   ChannelServer / ChannelClient
│  │  ├─ event.ts                #   事件工具
│  │  ├─ ipc.ts                  #   IPCServer / IPCClient
│  │  ├─ serializer.ts           #   VQL 序列化 / 反序列化
│  │  └─ types.ts                #   IChannel / IServerChannel 等类型
│  ├─ electron-browser/
│  │  └─ client.ts               # 渲染进程 IPCClient（vscode:hello/message）
│  └─ electron-main/
│     ├─ protocol.ts             # 主进程 Protocol 封装
│     └─ server.ts               # 主进程 IPCServer
│
├─ main/                         # 主进程（窗口 + IPC 注册）
│  ├─ index.ts                   #   入口
│  ├─ ElectronApp.ts             #   应用生命周期
│  ├─ WindowManager.ts           #   统一窗口管理（分组、类型、批量操作）
│  ├─ IPCChannelManager.ts       #   IPC 通道注册中心
│  └─ channels/
│     ├─ AppChannel.ts           #   应用信息（getVersion、ping）
│     ├─ BackgroundChannel.ts    #   Worker 任务调度
│     ├─ HttpChannel.ts          #   HTTP 请求（Node.js http/https，支持 mTLS）
│     └─ FileChannel.ts          #   文件读写（Node.js fs/promises）
│
├─ preload/
│  └─ index.ts                   # contextBridge 暴露 ipcForVSCode + backgroundIpc
│
├─ worker/                       # Worker 服务层（运行在后台隐藏窗口）
│  ├─ registerServices.ts        #   ServiceRegistry — 集中注册所有服务
│  └─ services/
│     ├─ taskService.ts          #   内置任务（ping、processData、longRunningTask）
│     └─ httpService.ts          #   Worker 侧 HTTP（浏览器 fetch）
│
├─ renderer/                     # 渲染进程（UI 层）
│  ├─ index.html                 #   主窗口页面
│  ├─ main.ts                    #   主窗口入口
│  ├─ background.html            #   Worker 窗口页面
│  ├─ background.ts              #   Worker 窗口入口（监听 IPC → 路由到 ServiceRegistry）
│  └─ api/                       #   模块化 API（class 写法）
│     ├─ index.ts                #     统一导出
│     ├─ createApp.ts            #     ElectronApp — 顶层 API 入口
│     ├─ appApi.ts               #     AppApi（版本、ping）
│     ├─ backgroundApi.ts        #     BackgroundApi（任务执行）
│     ├─ httpApi.ts              #     HttpApi（get/post/put/delete/patch）
│     └─ fileApi.ts              #     FileApi（readText/writeText/listDir/...）
│
└─ types/                        # 全局类型定义
   ├─ index.d.ts                 #   统一导出
   ├─ background.d.ts            #   后台任务相关
   ├─ file.d.ts                  #   文件操作类型
   ├─ http.d.ts                  #   HTTP 请求/响应 + TLS 选项
   ├─ ipc.d.ts                   #   IPC Channel 接口
   ├─ preload.d.ts               #   Preload 暴露的全局对象
   └─ electron.d.ts              #   Electron 扩展类型
```

## 通信流程

```
渲染进程 (UI)           主进程                 Worker 窗口
─────────────         ──────────             ───────────────
ElectronApp           IPCServer              ServiceRegistry
  ├─ AppApi     ──IPC──▶ AppChannel            ├─ TaskService
  ├─ HttpApi    ──IPC──▶ HttpChannel           └─ HttpService
  ├─ FileApi    ──IPC──▶ FileChannel
  └─ BackgroundApi ─IPC─▶ BackgroundChannel
                           │
                           └──webContents.send──▶ background.ts
                           ◀──ipcMain.on────────    (路由到 Service)
```

### 关键设计

| 层 | 职责 | 通信方式 |
|----|------|---------|
| **渲染进程** | 纯 UI，通过 API class 调用 | `ipcForVSCode` → VSCode IPC |
| **主进程** | 窗口管理 + IPC Server + HTTP/文件代理 | ChannelServer 分发到各 Channel |
| **Worker 窗口** | 后台任务执行（不阻塞 UI） | `webContents.send` / `ipcMain.on` |

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck
```

## 使用示例

```typescript
// 渲染进程中
import { ElectronApp } from './api';

const api = new ElectronApp(window.ipcForVSCode);

// ── 应用信息 ──
const version = await api.app.getVersion();

// ── 后台任务 ──
await api.background.executeTask('ping');

// ── HTTP 请求 ──
const res = await api.http.get('https://api.example.com/data');
const res2 = await api.http.post('https://api.example.com', { key: 'value' });

// mTLS
const res3 = await api.http.get('https://internal.example.com/api', {
  cert: 'C:/certs/client.crt',
  key: 'C:/certs/client.key',
  ca: 'C:/certs/ca.crt',
});

// ── 文件操作 ──
await api.file.writeText('C:/tmp/hello.txt', 'Hello World');
const content = await api.file.readText('C:/tmp/hello.txt');
const exists = await api.file.exists('C:/tmp/hello.txt');
const files = await api.file.listDir('C:/tmp');
const info = await api.file.stat('C:/tmp/hello.txt');
await api.file.mkdir('C:/tmp/new-dir');
await api.file.remove('C:/tmp/hello.txt');
```

---

## 新接口编写指南

以下以「新增一个 `SettingsChannel`（配置读写）」为完整示例，展示从零到可用的 **5 步流程**。

### 第 1 步：定义类型 — `src/types/settings.d.ts`

在 `types/` 下创建 `.d.ts`，定义请求参数、响应结构、Channel 接口。

```typescript
// src/types/settings.d.ts

/** 设置项 */
export interface SettingsData {
  theme: 'light' | 'dark';
  language: string;
  [key: string]: unknown;
}

/** Settings Channel 接口（渲染进程调用的类型约束） */
export interface ISettingsChannel {
  call(command: 'get', arg: { key: string }): Promise<unknown>;
  call(command: 'set', arg: { key: string; value: unknown }): Promise<void>;
  call(command: 'getAll'): Promise<SettingsData>;
  call<T = unknown>(
    command: string,
    arg?: unknown,
    cancellationToken?: import('../ipc/common/types').CancellationToken,
  ): Promise<T>;
  listen<T = unknown>(event: string, arg?: unknown): import('../ipc/common/types').IEvent<T>;
}
```

> **注册到 `types/index.d.ts`**：加一行 `export * from './settings';`

### 第 2 步：实现 Channel — `src/main/channels/SettingsChannel.ts`

在主进程实现 `IServerChannel<string>`，内部处理具体逻辑。

```typescript
// src/main/channels/SettingsChannel.ts

import type { CancellationToken, IEvent, IServerChannel } from '../../ipc/common/types';

type CommandHandler = (ctx: string, arg: unknown) => Promise<unknown>;

class SettingsChannel implements IServerChannel<string> {
  private readonly handlers = new Map<string, CommandHandler>();
  private store = new Map<string, unknown>(); // 实际可换成 electron-store

  constructor() {
    this.on('get', this.handleGet);
    this.on('set', this.handleSet);
    this.on('getAll', this.handleGetAll);
  }

  private handleGet = async (_ctx: string, arg: unknown): Promise<unknown> => {
    const { key } = arg as { key: string };
    return this.store.get(key);
  };

  private handleSet = async (_ctx: string, arg: unknown): Promise<void> => {
    const { key, value } = arg as { key: string; value: unknown };
    this.store.set(key, value);
  };

  private handleGetAll = async (): Promise<Record<string, unknown>> => {
    return Object.fromEntries(this.store);
  };

  // ─── 以下为固定模板，直接复制 ────────────────────

  call<T>(ctx: string, command: string, arg?: unknown, _ct?: CancellationToken): Promise<T> {
    const handler = this.handlers.get(command);
    if (!handler) return Promise.reject(new Error(`[SettingsChannel] 未知命令: ${command}`));
    return handler(ctx, arg) as Promise<T>;
  }

  listen<T>(_ctx: string, _event: string, _arg?: unknown): IEvent<T> {
    throw new Error('[SettingsChannel] listen not implemented');
  }

  private on(command: string, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }
}

export function createSettingsChannel(): IServerChannel<string> {
  return new SettingsChannel();
}
```

### 第 3 步：注册 Channel — `src/main/IPCChannelManager.ts`

在 `registerChannels()` 中添加一行：

```typescript
import { createSettingsChannel } from './channels/SettingsChannel';

// 在 registerChannels() 方法内:
ipcServer.registerChannel('settings', createSettingsChannel());
console.log('[IPCChannelManager] ✓ settings channel 已注册');
```

### 第 4 步：创建 API class — `src/renderer/api/settingsApi.ts`

```typescript
// src/renderer/api/settingsApi.ts

import type { ISettingsChannel, SettingsData } from '../../types/settings';

export class SettingsApi {
  constructor(private readonly channel: ISettingsChannel) {}

  get(key: string): Promise<unknown> {
    return this.channel.call('get', { key });
  }

  set(key: string, value: unknown): Promise<void> {
    return this.channel.call('set', { key, value });
  }

  getAll(): Promise<SettingsData> {
    return this.channel.call('getAll');
  }
}
```

> **注册到 `api/index.ts`**：加一行 `export { SettingsApi } from './settingsApi';`

### 第 5 步：挂载到 ElectronApp — `src/renderer/api/createApp.ts`

```typescript
import type { ISettingsChannel } from '../../types/settings';
import { SettingsApi } from './settingsApi';

export class ElectronApp {
  // ... 已有属性
  readonly settings: SettingsApi;

  constructor(ipc: IPreloadIPC, clientId?: string) {
    // ... 已有初始化
    this.settings = new SettingsApi(this.client.getChannel<ISettingsChannel>('settings'));
  }
}
```

### 完成！渲染进程中即可使用

```typescript
const api = new ElectronApp(ipc);

await api.settings.set('theme', 'dark');
const theme = await api.settings.get('theme');
const all = await api.settings.getAll();
```

### 速查清单

| 步骤 | 文件 | 做什么 |
|------|------|--------|
| **1. 类型** | `src/types/xxx.d.ts` | 定义参数、响应、`IXxxChannel` 接口 |
| **2. Channel** | `src/main/channels/XxxChannel.ts` | `class XxxChannel implements IServerChannel` + 命令处理 |
| **3. 注册** | `src/main/IPCChannelManager.ts` | `ipcServer.registerChannel('xxx', createXxxChannel())` |
| **4. API** | `src/renderer/api/xxxApi.ts` | `class XxxApi` 封装 `channel.call()` |
| **5. 挂载** | `src/renderer/api/createApp.ts` | `ElectronApp` 中 `new XxxApi(...)` |
| **6. 导出** | `types/index.d.ts` + `api/index.ts` | 各加一行 `export` |

> **原则**：types 定义约束 → Channel 实现逻辑 → API 封装调用 → ElectronApp 组装暴露。每一层只关心自己的职责。

## 扩展指南（其他场景）

### 新增后台任务

1. 在 `src/worker/services/` 中新建 Service class 或添加方法
2. 在 `src/worker/registerServices.ts` 的 `registerAll()` 中注册
3. 渲染进程通过 `api.background.executeTask('taskName', args)` 调用

### 后台任务 vs IPC Channel 如何选？

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 需要 Node.js API（fs, http, child_process） | **IPC Channel** | 主进程有完整 Node 权限 |
| CPU 密集型计算（不阻塞主进程） | **后台任务** | Worker 窗口独立进程 |
| 简单的数据转换 / 格式化 | **后台任务** | 轻量、不需要新 Channel |
| 需要持久连接 / 状态管理 | **IPC Channel** | Channel 实例在主进程常驻 |

## 技术栈

- **Electron** 38+ / **electron-vite** 构建
- **TypeScript** 严格模式
- **VSCode 风格 IPC**：二进制序列化 + ChannelServer/Client
- **Node.js http/https**：主进程 HTTP（支持客户端证书 / mTLS）
- **Node.js fs/promises**：主进程文件操作
