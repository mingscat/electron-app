# 架构流程图

## 整体架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Electron Application                             │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        Main Process (Node.js)                        │   │
│  │                                                                      │   │
│  │  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐     │   │
│  │  │ ElectronApp  │──▶│ WindowManager    │   │ ElectronIPCServer│     │   │
│  │  │              │   │                  │   │  (vscode:hello)  │     │   │
│  │  │ • 生命周期    │   │ • main window    │   │  (vscode:message)│     │   │
│  │  │ • 错误处理    │   │ • background win │   │                  │     │   │
│  │  │ • 窗口状态    │   │ • normal windows │   └────────┬─────────┘     │   │
│  │  │ • 单实例锁定  │   └──────────────────┘            │               │   │
│  │  └──────────────┘                                    │               │   │
│  │                     ┌────────────────────────────────┘               │   │
│  │                     │ IPCChannelManager                              │   │
│  │                     │ (registerDefaults → bindTo)                    │   │
│  │                     ▼                                                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐ │   │
│  │  │AppChannel│  │HttpChanne│  │FileChanne│  │ BackgroundChannel   │ │   │
│  │  │          │  │          │  │          │  │                     │ │   │
│  │  │getVersion│  │ request  │  │ readFile │  │ createBgWindow     │ │   │
│  │  │ping      │  │ (http/   │  │ writeFile│  │ executeTask ──┐    │ │   │
│  │  │onLog ⚡  │  │  https)  │  │ stat     │  │ destroyBgWindow│    │ │   │
│  │  └──────────┘  └──────────┘  │ listDir  │  └───────────────┼────┘ │   │
│  │                              │ mkdir    │                  │      │   │
│  │        ▲  VSCode IPC (二进制) │ remove   │    Raw IPC ▼    │      │   │
│  └────────┼─────────────────────┴──────────┘──────────────────┼──────┘   │
│           │                                                    │          │
│           │  vscode:hello ↑↓ vscode:message        background:task-req ↓ │
│           │                                        background:task-res ↑ │
│  ┌────────┼──────────────────────────────────┐  ┌─────────────┼────────┐ │
│  │        │       Preload (contextBridge)     │  │             │        │ │
│  │   window.ipcForVSCode                      │  │  window.backgroundIpc│ │
│  │   { send(), on() }                         │  │  { onTaskRequest()   │ │
│  │                                            │  │    sendTaskResponse()}│ │
│  └────────┼───────────────────────────────────┘  └─────────────┼───────┘ │
│           │                                                    │         │
│  ╔════════╧══════════════════════════════╗  ╔══════════════════╧═══════╗ │
│  ║     Renderer Process (主窗口)          ║  ║  Background Window       ║ │
│  ║                                        ║  ║  (隐藏 Worker 窗口)       ║ │
│  ║  ElectronIPCClient ◀─ preload ipc      ║  ║                          ║ │
│  ║      │                                 ║  ║  WorkerApp                ║ │
│  ║      ├── ChannelClient                 ║  ║    │                      ║ │
│  ║      │     │                           ║  ║    ├── ServiceRegistry    ║ │
│  ║      │     ├── getChannel('app')       ║  ║    │     │                ║ │
│  ║      │     ├── getChannel('http')      ║  ║    │     ├── TaskService  ║ │
│  ║      │     ├── getChannel('file')      ║  ║    │     │   • ping       ║ │
│  ║      │     └── getChannel('background')║  ║    │     │   • processData║ │
│  ║      │                                 ║  ║    │     │                ║ │
│  ║  ElectronApp (API 层)                  ║  ║    │     └── HttpService  ║ │
│  ║    ├── AppApi                          ║  ║    │         • fetch()     ║ │
│  ║    ├── HttpApi                         ║  ║    │                      ║ │
│  ║    ├── FileApi                         ║  ║    └── backgroundIpc      ║ │
│  ║    └── BackgroundApi                   ║  ║        (监听任务 → 路由执行)║ │
│  ╚════════════════════════════════════════╝  ╚══════════════════════════╝ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三条通信链路

### 链路 A：渲染进程 ↔ 主进程（VSCode IPC）

所有 `AppApi` / `HttpApi` / `FileApi` / `BackgroundApi` 的调用都走这条路。

```
  Renderer                      Preload                     Main Process
  ────────                      ───────                     ────────────

  api.app.getVersion()
    │
    ▼
  AppApi.getVersion()
    │  channel.call('getVersion')
    ▼
  ChannelClient
    │  序列化: [Promise, id, 'app', 'getVersion'] + arg
    │  protocol.send(buffer)
    ▼
  ElectronIPCClient.protocol
    │  ipc.send('vscode:message', buffer)
    ▼
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  window.ipcForVSCode.send()
    │  ipcRenderer.send('vscode:message', buffer)
    ▼
  ═══════════════════════ 进程边界 ═══════════════════════════
    │
    ▼
  ElectronIPCServer
    │  ipcMain.on('vscode:message')
    ▼
  ChannelServer
    │  反序列化: channel='app', command='getVersion'
    │  channels.get('app').call(ctx, 'getVersion')
    ▼
  AppChannel (extends BaseChannel)
    │  commands.get('getVersion') → handleGetVersion()
    │  return app.getVersion()  →  "1.0.0"
    ▼
  ChannelServer
    │  序列化: [PromiseSuccess, id] + "1.0.0"
    │  protocol.send(buffer)
    ▼
  ═══════════════════════ 进程边界 ═══════════════════════════
    │  webContents.send('vscode:message', buffer)
    ▼
  ElectronIPCClient.protocol
    │  onMessage → handler(id)
    ▼
  ChannelClient
    │  反序列化 → resolve("1.0.0")
    ▼
  api.app.getVersion() ──▶ "1.0.0" ✓
```

---

### 链路 B：渲染进程 → 主进程 → 后台窗口（任务转发）

`BackgroundApi.executeTask()` 走的是 VSCode IPC + 原生 IPC 两段拼接。

```
  Renderer                  Main Process                 Background Window
  ────────                  ────────────                 ─────────────────

  api.background.executeTask('ping')
    │
    ▼
  BackgroundApi
    │  channel.call('executeTask', {taskName:'ping', args:[]})
    ▼
  ── VSCode IPC（链路 A）──▶
                            BackgroundChannel
                              │  handleExecuteTask()
                              │  requestId = 'bg_1_1707...'
                              │
                              │  ┌───────────────────────┐
                              │  │ 发送:                   │
                              │  │ win.webContents.send(   │
                              │  │   'background:task-request',│
                              │  │   requestId, 'ping', [])│
                              │  └───────┬───────────────┘
                              │          │
                              │          │ ipcMain.on('background:task-response')
                              │          │   等待回复...
                              │          │
              ═══════ 进程边界（原生 Electron IPC）═══════
                                         │
                                         ▼
                                      Preload
                                         │  ipcRenderer.on('background:task-request')
                                         ▼
                                      window.backgroundIpc.onTaskRequest()
                                         │
                                         ▼
                                      WorkerApp
                                         │  registry.get('ping')
                                         ▼
                                      TaskService.ping()
                                         │  return { pong: true, timestamp: ... }
                                         ▼
                                      window.backgroundIpc.sendTaskResponse(
                                         │  requestId, null, result)
                                         ▼
              ═══════ 进程边界（原生 Electron IPC）═══════
                                         │
                              │◀─────────┘
                              │  ipcRenderer.send('background:task-response',
                              │    requestId, null, {pong:true,...})
                              │
                            BackgroundChannel
                              │  handler 匹配 requestId
                              │  resolve(result)
                              ▼
  ◀── VSCode IPC（链路 A）──
    │
    ▼
  api.background.executeTask('ping')
    ──▶ { pong: true, timestamp: 1707... } ✓
```

---

### 链路 C：主进程 → 渲染进程（事件推送）

主进程主动向渲染进程推送事件（如日志）。

```
  Main Process                                    Renderer
  ────────────                                    ────────

  appChannel.pushLog('info', '操作完成')
    │
    ▼
  _onLog.fire({ level:'info', message:'操作完成', timestamp:... })
    │  Emitter 触发所有 listeners
    ▼
  ChannelServer
    │  序列化: [EventFire, listenId] + logEntry
    │  protocol.send(buffer)
    ▼
  ═══════════════════════ 进程边界 ═══════════════════════════
    │  webContents.send('vscode:message', buffer)
    ▼
  ElectronIPCClient.protocol
    │  onMessage → handler(listenId)
    ▼
  ChannelClient
    │  反序列化 → handler.type === EventFire
    │  listener(logEntry)
    ▼
  api.app.onLog((entry) => {
    console.log(entry)          ──▶ { level:'info', message:'操作完成', ... }
  })                                                    ✓
```

---

## IPC 协议栈分层

```
┌─────────────────────────────────────────────────────────────────┐
│                      应用层 (Application)                        │
│  AppApi / HttpApi / FileApi / BackgroundApi / WorkerApp          │
├─────────────────────────────────────────────────────────────────┤
│                      通道层 (Channel)                            │
│  AppChannel / HttpChannel / FileChannel / BackgroundChannel      │
│  ↕ BaseChannel (onCommand / onEvent 注册)                        │
├─────────────────────────────────────────────────────────────────┤
│                    多路复用层 (Multiplexer)                       │
│  ChannelServer (主进程)          ChannelClient (渲染进程)          │
│  ↕ 按 channelName + command 路由   ↕ getChannel() 代理            │
├─────────────────────────────────────────────────────────────────┤
│                      序列化层 (Serializer)                       │
│  serialize / deserialize (VQL 编码 + 类型标签)                    │
│  BufferWriter / BufferReader / VSBuffer                          │
├─────────────────────────────────────────────────────────────────┤
│                      协议层 (Protocol)                           │
│  IMessagePassingProtocol { send(buffer), onMessage(listener) }   │
├─────────────────────────────────────────────────────────────────┤
│                      传输层 (Transport)                          │
│  ElectronIPCServer ←─ ipcMain    ElectronIPCClient ←─ preload    │
│  vscode:hello → 握手              vscode:message → 收发二进制     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 两套 IPC 的关系

```
                         src/ipc/ (通用内核)
                    ┌─────────────────────────┐
                    │  IPCServer / IPCClient   │
                    │  ChannelServer/Client    │
                    │  BaseChannel / Emitter   │
                    │  Serializer / VSBuffer   │
                    └────────┬───────┬────────┘
                             │       │
              ┌──────────────┘       └──────────────┐
              ▼                                      ▼
  ┌────────────────────────┐            ┌────────────────────────┐
  │   VSCode 风格 IPC       │            │   Background Task IPC  │
  │   (二进制协议)           │            │   (原生 Electron IPC)   │
  │                        │            │                        │
  │   vscode:hello         │            │   background:task-req  │
  │   vscode:message       │            │   background:task-res  │
  │                        │            │                        │
  │   用途:                 │            │   用途:                 │
  │   渲染 ↔ 主进程         │            │   主进程 → Worker 窗口    │
  │   所有 Channel 通信      │            │   任务下发 + 结果回收     │
  │                        │            │                        │
  │   特点:                 │            │   特点:                 │
  │   • 二进制序列化         │            │   • JSON 序列化          │
  │   • 多路复用 (channel)   │            │   • 请求-响应模式         │
  │   • 事件订阅 (listen)    │            │   • requestId 匹配      │
  │   • 取消支持             │            │   • 超时 30s             │
  │                        │            │                        │
  │   类:                   │            │   类:                   │
  │   ElectronIPCServer     │            │   BackgroundChannel    │
  │   ElectronIPCClient     │            │   WorkerApp            │
  │   ChannelServer/Client  │            │   ServiceRegistry      │
  └────────────────────────┘            └────────────────────────┘
              │                                      │
              │                                      │
              └──────────── 都基于 ──────────────────┘
                    Electron ipcMain / ipcRenderer
```

---

## 文件与职责映射

```
src/
├── ipc/                              ← 通用 IPC 内核（可复用）
│   ├── common/
│   │   ├── types.ts                  ← 接口：IChannel, IServerChannel, IEvent...
│   │   ├── buffer.ts                 ← VSBuffer 二进制封装
│   │   ├── serializer.ts            ← 序列化/反序列化 (VQL)
│   │   ├── channel.ts               ← ChannelServer / ChannelClient
│   │   ├── ipc.ts                   ← IPCServer / IPCClient（握手 + 路由）
│   │   ├── event.ts                 ← Emitter / Event 工具类
│   │   └── baseChannel.ts           ← BaseChannel（onCommand/onEvent 模板）
│   ├── electron-main/
│   │   ├── server.ts                ← ElectronIPCServer（ipcMain 绑定）
│   │   └── protocol.ts             ← ElectronProtocol（WebContents 协议）
│   └── electron-browser/
│       └── client.ts                ← ElectronIPCClient（preload 绑定）
│
├── main/                             ← 主进程（使用 ipc 内核）
│   ├── index.ts                     ← 入口：单实例 → ElectronApp.create()
│   ├── ElectronApp.ts               ← 应用类：生命周期/错误/窗口状态
│   ├── WindowManager.ts             ← 窗口管理：创建/分组/关闭
│   ├── IPCChannelManager.ts         ← Channel 注册：register() → bindTo()
│   └── channels/
│       ├── AppChannel.ts            ← 应用信息 + onLog 事件推送
│       ├── HttpChannel.ts           ← Node.js http/https
│       ├── FileChannel.ts           ← Node.js fs/promises
│       └── BackgroundChannel.ts     ← Worker 任务转发（二级 IPC）
│
├── preload/
│   └── index.ts                     ← 暴露 ipcForVSCode + backgroundIpc
│
├── renderer/                         ← 渲染进程
│   ├── main.ts                      ← 主窗口入口
│   ├── background.ts                ← Worker 窗口入口（WorkerApp）
│   ├── api/
│   │   ├── createApp.ts             ← ElectronApp（DI + 工厂）
│   │   ├── appApi.ts                ← AppApi
│   │   ├── httpApi.ts               ← HttpApi
│   │   ├── fileApi.ts               ← FileApi
│   │   ├── backgroundApi.ts         ← BackgroundApi
│   │   └── index.ts                 ← 统一导出
│   └── index.html / background.html
│
└── worker/                           ← Worker 服务实现
    ├── registerServices.ts          ← ServiceRegistry（路由表）
    └── services/
        ├── taskService.ts           ← ping / processData / longRunningTask
        └── httpService.ts           ← Worker 侧 HTTP（browser fetch）
```
