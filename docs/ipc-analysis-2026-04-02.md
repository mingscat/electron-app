# IPC 系统完整分析文档

> 基于代码逐行分析，生成日期：2026-04-02

---

## 一、架构总览

本项目实现了一套 **VSCode 风格的 IPC 架构**，在 Electron 原生 `ipcMain`/`ipcRenderer` 之上构建了二进制序列化的请求/响应多路复用层。同时，截图编辑器使用了另一套**直接 Electron IPC** 通道。

项目存在 **两套并行的 IPC 机制**：

| 机制 | 传输方式 | 使用场景 |
|------|----------|----------|
| VSCode 风格二进制 IPC | `vscode:message` 通道 + VQL 序列化 | 主窗口/后台窗口 <-> 主进程的业务通信 |
| 直接 Electron IPC | `ipcMain.handle`/`ipcMain.on`/`ipcRenderer.send`/`ipcRenderer.invoke` | 截图编辑器 <-> 主进程 |

---

## 二、IPC 框架核心层 (`src/ipc/common/`)

### 2.1 类型定义 -- `types.ts`

```
CancellationToken    -- 取消令牌（None / Cancelled）
IDisposable          -- dispose() 接口
IChannel             -- 客户端通道接口：call<T>(command, arg?, token?) + listen<T>(event, arg?)
IServerChannel<TContext> -- 服务端通道接口：call<T>(ctx, command, arg?, token?) + listen<T>(ctx, event, arg?)
IEvent<T>            -- 事件订阅函数签名：(listener: (e: T) => void) => IDisposable
IMessagePassingProtocol -- 底层传输协议：send(buffer) + onMessage 事件
ClientConnectionEvent -- 客户端连接事件：{ protocol, onDidClientDisconnect }
```

### 2.2 二进制缓冲区 -- `buffer.ts`

`VSBuffer` 类：对 `Uint8Array` 的统一封装，兼容 Node.js `Buffer` 和浏览器 `Uint8Array`。

关键方法：
- `alloc(byteLength)` -- 分配新缓冲区
- `wrap(actual)` -- 包装现有 Buffer/Uint8Array/ArrayBuffer/Buffer-like 对象
- `fromString(source)` -- 字符串转 UTF-8 缓冲区
- `concat(buffers)` -- 拼接多个缓冲区
- `isNativeBuffer(obj)` -- 检查是否为 ArrayBuffer 或 Uint8Array

`wrap()` 有三种分支：
1. `Uint8Array` -> 直接包装
2. `ArrayBuffer` -> `new Uint8Array(arrayBuffer)` 包装
3. 有 `buffer`/`byteOffset`/`byteLength` 属性的对象（Node.js Buffer 在渲染进程的表现形式）-> 用 `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)` 包装

### 2.3 序列化器 -- `serializer.ts`

采用 **类型标签 + VQL 变长整数 + 载荷** 的二进制格式。

**数据类型标签**（`DataType` 枚举）：

| 值 | 类型 | 编码方式 |
|----|------|----------|
| 0 | Undefined | 仅 1 字节标签 |
| 1 | String | 标签 + VQL长度 + UTF-8 字节 |
| 2 | Buffer | 标签 + VQL长度 + 原始字节（ArrayBuffer/Uint8Array） |
| 3 | VSBuffer | 标签 + VQL长度 + 原始字节 |
| 4 | Array | 标签 + VQL元素数 + 递归序列化每个元素 |
| 5 | Object | 标签 + VQL长度 + JSON.stringify 后的 UTF-8 字节 |
| 6 | Int | 标签 + VQL编码的整数值（仅32位整数） |

**VQL (Variable Quantity Length)** 编码：每字节低 7 位为数据，最高位为延续标志。与 protobuf varint 相同。

`BufferReader` / `BufferWriter` 分别提供从 `VSBuffer` 顺序读取和写入的能力。

### 2.4 事件系统 -- `event.ts`

- `Emitter<T>` -- 事件发射器，维护 `listeners[]` 数组，`fire()` 通知所有订阅者
- `Event` 静态工具类：
  - `Event.None` -- 永远不会触发的事件
  - `Event.once(event)` -- 包装为只触发一次的事件

### 2.5 Channel 多路复用 -- `channel.ts`

这是 IPC 的核心，实现了在单一传输通道上多路复用多个逻辑 Channel 的请求/响应。

**请求类型**（客户端 -> 服务端）：

| 值 | 类型 | 格式 |
|----|------|------|
| 100 | `Promise` | header: `[100, id, channelName, command]`, body: `arg` |
| 101 | `PromiseCancel` | header: `[101, id]` |
| 102 | `EventListen` | header: `[102, id, channelName, event]`, body: `arg` |
| 103 | `EventDispose` | header: `[103, id]` |

**响应类型**（服务端 -> 客户端）：

| 值 | 类型 | 格式 |
|----|------|------|
| 200 | `Initialize` | header: `[200]` -- 连接建立确认 |
| 201 | `PromiseSuccess` | header: `[201, id]`, body: `data` |
| 202 | `PromiseError` | header: `[202, id]`, body: `{ message, name, stack? }` |
| 203 | `PromiseErrorObj` | （代码中未发送此类型） |
| 204 | `EventFire` | header: `[204, id]`, body: `data` |

**ChannelServer**（主进程侧）：
1. 构造时监听 `protocol.onMessage`，立即发送 `[200]`（Initialize）确认连接
2. `registerChannel(name, channel)` 注册 IServerChannel
3. 收到请求时：反序列化 header+body -> 根据 `channelName` 查找 `IServerChannel` -> 调用 `channel.call(ctx, command, body)` -> 序列化响应发回
4. 收到 `EventListen` 请求时：调用 `channel.listen(ctx, name, body)` -> 订阅事件 -> 事件触发时发送 `[204, id, data]`

**ChannelClient**（渲染进程侧）：
1. 构造时监听 `protocol.onMessage`，等待 `[200]`（Initialize）后 `resolve initPromise`
2. `getChannel<T>(channelName)` 返回一个 `IChannel` 对象：
   - `call(command, arg)` -> 分配递增 `id`，序列化 `[100, id, channelName, command]` + `arg`，发送，等待 handlers[id] 回调
   - `listen(event, arg)` -> 分配 `id`，发送 `[102, id, channelName, event]` + `arg`，handlers[id] 收到 `[204]` 时触发 listener
3. 所有 `call` 调用都先 `await initPromise`，确保连接已建立

### 2.6 IPC Server/Client 高层封装 -- `ipc.ts`

**IPCServer**：
- 构造时接收 `onDidClientConnect` 事件源
- 每当客户端连接：读取第一条消息作为 `ctx`（上下文），创建 `ChannelServer` 并注册所有已注册的 channel
- `registerChannel(name, channel)` -- 注册到全局 Map，后续新连接也会自动获得

**IPCClient**：
- 构造时：序列化 `ctx` 发送作为首条消息 -> 创建 `ChannelClient`
- `getChannel<T>(name)` -- 委托给 `ChannelClient.getChannel()`

### 2.7 Channel 基类 -- `baseChannel.ts`

`BaseChannel` 抽象类，消除 `IServerChannel` 实现的模板代码：
- 子类在构造函数中通过 `this.onCommand('cmd', handler)` 注册命令
- 子类通过 `this.onEvent('evt', emitter.event)` 注册事件源
- `call()` 自动分发到对应 `CommandHandler`
- `listen()` 自动分发到对应 `IEvent` 源

---

## 三、Electron 传输层

### 3.1 主进程 IPC Server -- `electron-main/server.ts`

`ElectronIPCServer` 继承 `IPCServer`，绑定到 Electron 的 `ipcMain`。

使用三个 Electron IPC 通道：

| 通道名 | 方向 | 用途 |
|--------|------|------|
| `vscode:hello` | renderer -> main | 渲染进程发起连接握手 |
| `vscode:message` | 双向 | 二进制帧传输 |
| `vscode:disconnect` | renderer -> main | 断开连接通知 |

**连接建立流程**：
1. 渲染进程通过 `ipcRenderer.send('vscode:hello')` 发起连接
2. `ipcMain.on('vscode:hello')` 收到后，用 `event.sender.id` 标识连接
3. 为该连接创建独立的 `messageListeners[]` 和 `disconnectListeners[]`
4. 在 `ipcMain` 上注册 `vscode:message` 和 `vscode:disconnect` 的处理器，按 `senderId` 过滤
5. 构造 `IMessagePassingProtocol`：`send()` 调用 `webContents.send('vscode:message', nodeBuffer)`，`onMessage` 转发 `messageListeners`
6. 构造 `onDidClientDisconnect` 事件
7. 通知所有 `IPCServer` 的订阅者（触发 ctx 读取和 `ChannelServer` 创建）

### 3.2 主进程 Protocol -- `electron-main/protocol.ts`

`ElectronProtocol`：直接持有 `WebContents` 引用的 `IMessagePassingProtocol` 实现。
- `send(buffer)` -> `webContents.send('vscode:message', Buffer.from(data))`
- `onMessage` 通过构造函数注入

**注意**：此文件存在但当前代码中 `ElectronIPCServer` 内联构建了 `protocol`，`ElectronProtocol` 类可能未在主流程中使用。

### 3.3 渲染进程 IPC Client -- `electron-browser/client.ts`

`ElectronIPCClient` 继承 `IPCClient`。

**工厂方法 `create(ipc, ctx)`**：
1. 调用 `buildProtocol(ipc)` 构造 `IMessagePassingProtocol`
2. 调用 `ipc.send('vscode:hello')` 发起握手
3. 用 `protocol` 和 `ctx` 构造 `ElectronIPCClient`（-> `IPCClient`）

**`buildProtocol(ipc)`** 返回的对象：
- `send(buffer)` -> 将 `ArrayBuffer`/`Uint8Array` 转为 `Uint8Array` -> `ipc.send('vscode:message', d.buffer)`（注意：发送的是底层 `ArrayBuffer`）
- `onMessage(listener)` -> 通过 `ipc.on('vscode:message', ...)` 监听，将 `Buffer` 转为 `Uint8Array` 后通知 listeners

**缓冲区转换细节**：渲染进程收到的 `Buffer` 类型数据，通过 `new Uint8Array(b.buffer, b.byteOffset, b.byteLength)` 转换。

---

## 四、Preload 脚本

### 4.1 主 Preload -- `src/preload/index.ts`

通过 `contextBridge.exposeInMainWorld` 暴露两个全局对象：

**`window.ipcForVSCode`**（VSCode 风格 IPC）：
- `send(channel, ...args)` -- 白名单检查：只允许 `vscode:hello` 和 `vscode:message`。将 `ArrayBuffer`/`Uint8Array` 参数转为 Node.js `Buffer` 后调用 `ipcRenderer.send()`
- `on(channel, listener)` -- 白名单检查：只允许 `vscode:message`。通过 `ipcRenderer.on()` 监听，透传 `(event, ...args)` 给 listener

**`window.backgroundIpc`**（后台窗口任务 IPC）：
- `onTaskRequest(listener)` -- 监听 `background:task-request` 通道，解构 `(requestId, taskName, args)` 传给 listener
- `sendTaskResponse(requestId, error, result)` -- 通过 `background:task-response` 通道回复

### 4.2 截图编辑器 Preload -- `src/preload/screenshot-editor.ts`

通过 `contextBridge.exposeInMainWorld` 暴露 `window.screenshotEditor`：

| 方法 | Electron IPC | 方向 |
|------|-------------|------|
| `onScreenshotData(callback)` | `ipcRenderer.on('screenshot:data')` | main -> renderer |
| `complete(result)` | `ipcRenderer.send('screenshot:complete', result)` | renderer -> main |
| `cancel()` | `ipcRenderer.send('screenshot:cancel')` | renderer -> main |
| `copyToClipboard(dataUrl)` | `ipcRenderer.invoke('screenshot:copy', dataUrl)` | renderer <-> main |
| `saveToFile(dataUrl, filePath)` | `ipcRenderer.invoke('screenshot:save', dataUrl, filePath)` | renderer <-> main |

---

## 五、Channel 注册与初始化

### 5.1 初始化链路

```
src/main/index.ts
  -> ElectronApp.create()                    // new ElectronApp(WindowManager, IPCChannelManager)
  -> app.whenReady().then(() =>
      electronApp.initialize()
    )

ElectronApp.initialize() 顺序：
  1. setupGlobalErrorHandlers()              // uncaughtException, unhandledRejection, render-process-gone
  2. setupAppLifecycle()                     // before-quit, window-all-closed, activate
  3. initializeIPCServer()                   // 创建 ElectronIPCServer，注册 channels
  4. createMainWindowWithState()             // 创建主窗口（加载 index.html + preload/index.js）
  5. createDefaultBackgroundWindow()         // 创建后台窗口（加载 background.html + preload/index.js）
  6. setupScreenshotShortcut()              // 注册 Ctrl/Cmd+Shift+D 快捷键
  7. setupScreenshotIPC()                   // 注册 screenshot:save-file, screenshot:copy-clipboard 的 ipcMain.handle
```

### 5.2 IPCChannelManager -- `src/main/IPCChannelManager.ts`

`registerDefaults(windowManager)` 注册 5 个 Channel 工厂（延迟创建）：

| 注册名 | 工厂函数 | Channel 类 |
|--------|----------|-----------|
| `app` | `createAppChannel()` | `AppChannel` (extends BaseChannel) |
| `http` | `createHttpChannel()` | `HttpChannel` (extends BaseChannel) |
| `file` | `createFileChannel()` | `FileChannel` (extends BaseChannel) |
| `background` | `createBackgroundChannel(windowManager)` | `BackgroundChannel` (extends BaseChannel) |
| `screenshot` | `createScreenshotChannel()` | `ScreenshotChannel` (implements IServerChannel) |

`bindTo(ipcServer)` 遍历所有已注册的工厂，实例化并调用 `ipcServer.registerChannel(name, channel)`。

---

## 六、各 Channel 详细分析

### 6.1 AppChannel -- `src/main/channels/AppChannel.ts`

继承 `BaseChannel`。

| 类型 | 名称 | 签名 | 实现 |
|------|------|------|------|
| 命令 | `getVersion` | `() => Promise<string>` | 返回 `app.getVersion()` |
| 命令 | `ping` | `(arg?) => Promise<{ pong: true, arg }>` | 回显参数 |
| 事件 | `onLog` | `IEvent<LogEntry>` | 通过 `_onLog.fire()` 推送，外部可调用 `pushLog(level, message)` |

`LogEntry` 结构：`{ level: 'info'|'warn'|'error', message: string, timestamp: number }`

### 6.2 HttpChannel -- `src/main/channels/HttpChannel.ts`

继承 `BaseChannel`。

| 类型 | 名称 | 签名 |
|------|------|------|
| 命令 | `request` | `(arg: HttpRequestOptions) => Promise<HttpResponse>` |

使用 Node.js 原生 `http`/`https` 模块，支持：
- 所有 HTTP 方法
- 自定义 headers
- 请求体（字符串或对象，对象自动 JSON.stringify 并添加 Content-Type）
- 超时控制（默认 30s）
- 响应类型：`json`（默认，解析失败返回文本）、`text`、`buffer`（返回 `number[]`）
- **mTLS 支持**：`cert`/`key`/`ca` 参数支持 PEM 字符串或文件路径
- `rejectUnauthorized` 选项

### 6.3 FileChannel -- `src/main/channels/FileChannel.ts`

继承 `BaseChannel`。

| 类型 | 名称 | 输入类型 | 返回类型 |
|------|------|----------|----------|
| 命令 | `readFile` | `ReadFileOptions` | `string | number[]` |
| 命令 | `writeFile` | `WriteFileOptions` | `void` |
| 命令 | `exists` | `ExistsOptions` | `boolean` |
| 命令 | `stat` | `ExistsOptions` | `FileInfo` |
| 命令 | `listDir` | `ListDirOptions` | `FileInfo[]` |
| 命令 | `mkdir` | `MkdirOptions` | `void` |
| 命令 | `remove` | `RemoveOptions` | `void` |

实现细节：
- `readFile`：`encoding=null` 时返回二进制 `Array.from(buffer)`，否则返回字符串
- `writeFile`：`content` 为数组时视为二进制 Buffer；`append=true` 时追加；自动创建父目录
- `listDir`：支持 `recursive`，递归时递归调用自身
- `remove`：使用 `fs.rm({ recursive, force: true })`

### 6.4 BackgroundChannel -- `src/main/channels/BackgroundChannel.ts`

继承 `BaseChannel`。依赖 `WindowManager`。

| 类型 | 名称 | 返回类型 |
|------|------|----------|
| 命令 | `createBackgroundWindow` | `{ success: true, windowId: number, isNew: boolean }` |
| 命令 | `executeTask` | `unknown`（动态） |
| 命令 | `destroyBackgroundWindow` | `{ success: true }` |

**任务执行机制**（不同于 VSCode IPC，使用直接 Electron IPC）：

```
渲染进程 -> VSCode IPC -> BackgroundChannel.executeTask(taskName, args)
  -> 生成 requestId: `bg_${seq}_${timestamp}`
  -> ipcMain.on('background:task-response', handler) 注册一次性监听
  -> win.webContents.send('background:task-request', requestId, taskName, args)
  -> 等待响应（30秒超时）
  -> 后台窗口 Worker -> backgroundIpc.sendTaskResponse(requestId, error, result)
  -> handler 匹配 requestId -> resolve/reject Promise
```

### 6.5 ScreenshotChannel -- `src/main/channels/ScreenshotChannel.ts`

**直接实现 `IServerChannel`**，不继承 `BaseChannel`。

| 类型 | 名称 | 输入 | 返回 |
|------|------|------|------|
| 命令 | `getDisplays` | -- | `DisplayInfo[]` |
| 命令 | `captureDisplay` | `string` (displayId) | `ImageData` |
| 命令 | `captureArea` | `Area` | `ImageData` |
| 命令 | `captureAllDisplays` | -- | `ImageData` |
| 命令 | `saveToFile` | `{ data: string, path: string }` | `void` |
| 命令 | `copyToClipboard` | `string` (base64) | `void` |
| 事件 | -- | -- | `throw new Error('Events not supported')` |

依赖原生 N-API 模块，根据平台加载：
- Windows: `screenshot-native.win32-${arch}-msvc.node`
- macOS: `screenshot-native.darwin-${arch}.node`
- Linux: `screenshot-native.linux-${arch}-gnu.node`

图像数据统一转为 base64 编码传输。

---

## 七、渲染进程 API 层 (`src/renderer/api/`)

### 7.1 ElectronApp 工厂 -- `createApp.ts`

`ElectronApp.create(ipc, clientId?)`：
1. 用 `clientId`（默认 `window:${Date.now()}`）调用 `ElectronIPCClient.create(ipc, id)`
2. 通过 `client.getChannel<T>(name)` 获取 4 个 typed channel
3. 构造 `AppApi`/`BackgroundApi`/`HttpApi`/`FileApi` 实例
4. 提供 `call(channel, command, arg)` 通用调用（逃生口）

### 7.2 各 API 模块

**AppApi** -- 封装 `app` channel：
- `getVersion()` -> `channel.call('getVersion')`
- `ping(arg?)` -> `channel.call('ping', arg)`
- `onLog(listener)` -> `channel.listen<LogEntry>('onLog')(listener)` -> 返回 `IDisposable`

**BackgroundApi** -- 封装 `background` channel：
- `createWindow()` -> `channel.call('createBackgroundWindow')`
- `executeTask(taskName, args)` -> `channel.call('executeTask', { taskName, args })`
- `destroyWindow()` -> `channel.call('destroyBackgroundWindow')`

**HttpApi** -- 封装 `http` channel：
- `request(options)` -> `channel.call('request', options)`
- `get/post/put/delete/patch(url, ...)` -- 便捷方法，调用 `request()`

**FileApi** -- 封装 `file` channel：
- `readText(path, encoding?)` / `readBinary(path)` / `readFile(options)`
- `writeText(path, content, encoding?)` / `appendText(...)` / `writeBinary(path, content)` / `writeFile(options)`
- `exists(path)` / `stat(path)` / `listDir(path, recursive?)` / `mkdir(path, recursive?)` / `remove(path, recursive?)`

---

## 八、后台 Worker 系统

### 8.1 Worker 入口 -- `src/renderer/background.ts`

`WorkerApp` 类：
1. 创建 `ServiceRegistry`（注册所有服务）
2. 获取 `window.backgroundIpc`
3. 调用 `bgIpc.onTaskRequest(handler)` 监听任务
4. 收到任务 -> 查注册表 -> 执行 handler -> `bgIpc.sendTaskResponse(requestId, error, result)`

### 8.2 服务注册 -- `src/worker/registerServices.ts`

`ServiceRegistry` 维护 `Map<string, BackgroundTaskHandler>`，`registerAll()` 注册：

| 任务名 | 实现 | 说明 |
|--------|------|------|
| `ping` | `TaskService.ping()` | 返回 `{ pong: true, timestamp }` |
| `processData` | `TaskService.processData(...args)` | 数据包装 |
| `longRunningTask` | `TaskService.longRunningTask()` | 5秒延迟 |
| `http:request` | `HttpService.request(options)` | 浏览器 `fetch` |
| `http:get` | `HttpService.get(url, options)` | 浏览器 `fetch` |
| `http:post` | `HttpService.post(url, body, options)` | 浏览器 `fetch` |

**注意**：Worker 侧的 `HttpService` 使用浏览器 `fetch` API，与主进程的 `HttpChannel`（Node.js `http`/`https`）是**两套独立的 HTTP 实现**。

---

## 九、截图编辑器 IPC

截图编辑器使用完全独立的 IPC 路径，不走 VSCode 二进制协议。

### 9.1 触发入口

`ElectronApp.setupScreenshotShortcut()` 注册 `Ctrl+Shift+D`/`Cmd+Shift+D` 快捷键 -> `startScreenshot()`：
1. 加载原生 N-API 模块
2. 调用 `nativeModule.getDisplays()` 获取显示器信息
3. 调用 `nativeModule.captureAllDisplays()` 截图
4. 创建 `ScreenshotEditorWindow` 实例
5. 调用 `editor.open()` -> 创建全屏无边框窗口 -> 加载 `screenshot-editor.html` + `screenshot-editor.js` preload
6. 页面加载完成后通过 `webContents.send('screenshot:data', ...)` 发送截图数据
7. 等待编辑器返回结果（Promise）
8. 结果自动复制到剪贴板，通过 `mainWin.webContents.send('screenshot:completed', ...)` 通知主窗口

### 9.2 截图编辑器 IPC 通道

**ScreenshotEditorWindow.setupIPC()** 注册：

| 通道 | 方法 | 触发时机 |
|------|------|----------|
| `screenshot:complete` | `ipcMain.once` | 编辑器确认截图（一次性） |
| `screenshot:cancel` | `ipcMain.once` | 编辑器取消截图（一次性） |
| `screenshot:copy` | `ipcMain.handle` | 编辑器请求复制到剪贴板 |
| `screenshot:save` | `ipcMain.handle` | 编辑器请求保存文件 |

**注意**：`screenshot:copy` 和 `screenshot:save` 的 `handle` 回调直接返回 `{ success: true }`，**实际保存/复制逻辑不在这里**。编辑器的复制操作实际发生在 `startScreenshot()` 的结果处理中（自动复制到剪贴板）。

### 9.3 ElectronApp.setupScreenshotIPC()

额外注册了两个 `ipcMain.handle`：

| 通道 | 功能 |
|------|------|
| `screenshot:save-file` | 弹出保存对话框，将 `dataUrl` 写入文件 |
| `screenshot:copy-clipboard` | 将 `dataUrl` 解码为图片写入剪贴板 |

**注意**：这两个通道在 `preload/screenshot-editor.ts` 中**未被使用**。preload 使用的是 `screenshot:save` 和 `screenshot:copy`（在 `ScreenshotEditorWindow.setupIPC()` 中注册）。存在通道名不一致的情况。

---

## 十、完整 IPC 通道映射表

### 10.1 VSCode 风格二进制通道（通过 `vscode:message` 传输）

| Channel 名 | 主进程处理 | 渲染进程 API | 支持的命令 | 支持的事件 |
|------------|-----------|-------------|-----------|-----------|
| `app` | `AppChannel` | `AppApi` | `getVersion`, `ping` | `onLog` |
| `http` | `HttpChannel` | `HttpApi` | `request` | -- |
| `file` | `FileChannel` | `FileApi` | `readFile`, `writeFile`, `exists`, `stat`, `listDir`, `mkdir`, `remove` | -- |
| `background` | `BackgroundChannel` | `BackgroundApi` | `createBackgroundWindow`, `executeTask`, `destroyBackgroundWindow` | -- |
| `screenshot` | `ScreenshotChannel` | **未封装 API** | `getDisplays`, `captureDisplay`, `captureArea`, `captureAllDisplays`, `saveToFile`, `copyToClipboard` | -- |

### 10.2 直接 Electron IPC 通道

| 通道名 | 注册位置 | 方向 | 方法 | 用途 |
|--------|----------|------|------|------|
| `vscode:hello` | `ElectronIPCServer` | renderer -> main | `ipcRenderer.send` / `ipcMain.on` | 连接握手 |
| `vscode:message` | `ElectronIPCServer` + `preload/index.ts` | 双向 | `ipcRenderer.send` / `webContents.send` / `ipcMain.on` | 二进制帧 |
| `vscode:disconnect` | `ElectronIPCServer` | renderer -> main | `ipcRenderer.send` / `ipcMain.on` | 断开连接 |
| `background:task-request` | `BackgroundChannel` | main -> background | `webContents.send` / `ipcRenderer.on` | 任务下发 |
| `background:task-response` | `BackgroundChannel` | background -> main | `ipcRenderer.send` / `ipcMain.on` | 任务结果 |
| `screenshot:data` | `ScreenshotEditorWindow` | main -> editor | `webContents.send` / `ipcRenderer.on` | 截图数据 |
| `screenshot:complete` | `ScreenshotEditorWindow` | editor -> main | `ipcRenderer.send` / `ipcMain.once` | 确认截图 |
| `screenshot:cancel` | `ScreenshotEditorWindow` | editor -> main | `ipcRenderer.send` / `ipcMain.once` | 取消截图 |
| `screenshot:copy` | `ScreenshotEditorWindow` | editor <-> main | `ipcRenderer.invoke` / `ipcMain.handle` | 复制请求 |
| `screenshot:save` | `ScreenshotEditorWindow` | editor <-> main | `ipcRenderer.invoke` / `ipcMain.handle` | 保存请求 |
| `screenshot:save-file` | `ElectronApp` | -- | `ipcMain.handle` | 保存对话框（未使用） |
| `screenshot:copy-clipboard` | `ElectronApp` | -- | `ipcMain.handle` | 剪贴板写入（未使用） |
| `screenshot:completed` | `ElectronApp` | main -> main renderer | `webContents.send` | 截图完成通知 |

---

## 十一、数据流图

### 11.1 VSCode IPC 调用流（以 `api.app.getVersion()` 为例）

```
渲染进程 (main.ts)
  | api.app.getVersion()
  | AppApi.getVersion()
  | channel.call('getVersion')
  | ChannelClient.call()
  | new BufferWriter -> serialize header [100, id, 'app', 'getVersion'] + serialize body undefined
  | protocol.send(buf.buffer)
  | ipc.send('vscode:message', d.buffer)
  | (Electron IPC)
  v
Preload (index.ts)
  | ipcForVSCode.send('vscode:message', Buffer.from(d))
  | ipcRenderer.send('vscode:message', nodeBuffer)
  | (Electron IPC)
  v
主进程 (ElectronIPCServer)
  | ipcMain.on('vscode:message', msgHandler)
  | 转换为 Uint8Array
  | messageListeners.forEach(l => l(buf))
  v
IPCServer (ipc.ts)
  | 首条消息 -> 读取 ctx -> 创建 ChannelServer（仅首次）
  | ChannelServer.onMessage()
  | deserialize header + body
  | channels.get('app').call(ctx, 'getVersion', undefined)
  v
AppChannel (BaseChannel)
  | commands.get('getVersion') -> handleGetVersion()
  | return app.getVersion() -> "1.0.0"
  v
ChannelServer
  | sendResponse([201, id], "1.0.0")
  | serialize header + body -> protocol.send()
  | webContents.send('vscode:message', nodeBuffer)
  | (Electron IPC)
  v
Preload (index.ts)
  | ipcRenderer.on('vscode:message', ...) -> listener(event, message)
  v
ElectronIPCClient (client.ts)
  | ipc.on('vscode:message', ...) -> Buffer -> Uint8Array 转换
  | listeners.forEach(l => l(buf))
  v
ChannelClient.onMessage()
  | deserialize header [201, id] + body "1.0.0"
  | handlers.get(id)({ type: 201, id, data: "1.0.0" })
  | resolve("1.0.0")
  v
渲染进程 Promise resolve -> 得到版本号
```

### 11.2 后台任务执行流

```
渲染进程
  | api.background.executeTask('ping')
  | VSCode IPC -> BackgroundChannel.executeTask
  | 生成 requestId
  | ipcMain.on('background:task-response', handler)
  | win.webContents.send('background:task-request', requestId, 'ping', [])
  v
后台窗口 Preload
  | ipcRenderer.on('background:task-request', ...)
  | backgroundIpc.onTaskRequest handler(requestId, 'ping', [])
  v
Worker (background.ts)
  | registry.get('ping') -> TaskService.ping()
  | bgIpc.sendTaskResponse(requestId, null, { pong: true, timestamp })
  | ipcRenderer.send('background:task-response', requestId, null, result)
  v
主进程 BackgroundChannel
  | ipcMain.on('background:task-response', handler)
  | 匹配 requestId -> resolve(result)
  v
渲染进程 Promise resolve -> 得到 { pong: true, timestamp }
```

---

## 十二、窗口安全配置

所有窗口均使用以下安全设置：

```typescript
webPreferences: {
  contextIsolation: true,   // 上下文隔离
  nodeIntegration: false,   // 禁止 Node.js
  sandbox: false,           // sandbox 关闭（preload 需要 Buffer）
}
```

`preload` 路径：
- 主窗口/后台窗口：`path.join(__dirname, '../preload/index.js')`
- 截图编辑器：`path.join(__dirname, '../../preload/screenshot-editor.js')`

---

## 十三、类型定义文件索引

| 文件路径 | 关键类型 |
|---------|---------|
| `src/ipc/common/types.ts` | `CancellationToken`, `IDisposable`, `IChannel`, `IServerChannel<TContext>`, `IEvent<T>`, `IMessagePassingProtocol`, `ClientConnectionEvent` |
| `src/types/ipc.d.ts` | `IIPCClient`, `IIPCServer`, `IAppChannel`, `IMainProcessService` |
| `src/types/preload.d.ts` | `IPreloadIPC`, `IBackgroundIpc`, `ElectronAPI`; 扩展 `Window` 添加 `ipcForVSCode`, `backgroundIpc`, `electronAPI` |
| `src/types/background.d.ts` | `BackgroundTaskResult`, `BackgroundTaskRequest`, `CreateBackgroundWindowResult`, `DestroyBackgroundWindowResult`, `BackgroundTaskHandler`, `IBackgroundWindowManager`, `IBackgroundChannel` |
| `src/types/http.d.ts` | `HttpMethod`, `HttpRequestOptions`, `HttpResponse<T>`, `IHttpChannel` |
| `src/types/file.d.ts` | `FileEncoding`, `ReadFileOptions`, `WriteFileOptions`, `FileInfo`, `ListDirOptions`, `ExistsOptions`, `RemoveOptions`, `MkdirOptions`, `IFileChannel` |
| `src/types/screenshot.d.ts` | `DisplayInfo`, `ImageData`, `Area`, `AnnotationType`, `Annotation`, `ScreenshotResult`, `ScreenshotConfig`, `ScreenshotChannelCommands`, `ScreenshotChannelEvents` |
| `src/types/electron.d.ts` | `ExtendedBrowserWindow`, `WindowConfig` |
| `src/types/index.d.ts` | 重新导出所有类型 |
| `src/renderer/env.d.ts` | 从 `preload.d.ts` 向后兼容的重新导出，扩展 `Window` 添加 `ipcForVSCode` |

---

## 十四、文件索引

### IPC 框架核心（7 个文件）

| 文件 | 职责 |
|------|------|
| `src/ipc/common/types.ts` | 核心接口定义 |
| `src/ipc/common/buffer.ts` | `VSBuffer` 二进制缓冲区 |
| `src/ipc/common/serializer.ts` | VQL 二进制序列化/反序列化 |
| `src/ipc/common/event.ts` | `Emitter` 事件发射器 + `Event` 工具 |
| `src/ipc/common/channel.ts` | `ChannelServer` / `ChannelClient` 请求/响应多路复用 |
| `src/ipc/common/ipc.ts` | `IPCServer` / `IPCClient` 高层封装 |
| `src/ipc/common/baseChannel.ts` | `BaseChannel` 抽象基类 |

### Electron 传输层（3 个文件）

| 文件 | 职责 |
|------|------|
| `src/ipc/electron-main/server.ts` | `ElectronIPCServer` 绑定 `ipcMain` |
| `src/ipc/electron-main/protocol.ts` | `ElectronProtocol` 基于 `WebContents` |
| `src/ipc/electron-browser/client.ts` | `ElectronIPCClient` 渲染进程客户端 |

### 主进程 Channel 处理器（5 个文件）

| 文件 | 命令 | 事件 |
|------|------|------|
| `src/main/channels/AppChannel.ts` | `getVersion`, `ping` | `onLog` |
| `src/main/channels/BackgroundChannel.ts` | `createBackgroundWindow`, `executeTask`, `destroyBackgroundWindow` | -- |
| `src/main/channels/FileChannel.ts` | `readFile`, `writeFile`, `exists`, `stat`, `listDir`, `mkdir`, `remove` | -- |
| `src/main/channels/HttpChannel.ts` | `request` | -- |
| `src/main/channels/ScreenshotChannel.ts` | `getDisplays`, `captureDisplay`, `captureArea`, `captureAllDisplays`, `saveToFile`, `copyToClipboard` | -- |

### 主进程编排（5 个文件）

| 文件 | 职责 |
|------|------|
| `src/main/index.ts` | 主进程入口，单实例锁 |
| `src/main/ElectronApp.ts` | 中央编排器 |
| `src/main/IPCChannelManager.ts` | Channel 注册管理 |
| `src/main/WindowManager.ts` | 窗口生命周期管理 |
| `src/main/windows/ScreenshotEditorWindow.ts` | 截图编辑器窗口 |

### Preload 脚本（2 个文件）

| 文件 | 暴露对象 | 使用的通道 |
|------|---------|-----------|
| `src/preload/index.ts` | `window.ipcForVSCode`, `window.backgroundIpc` | `vscode:hello`, `vscode:message`, `background:task-request`, `background:task-response` |
| `src/preload/screenshot-editor.ts` | `window.screenshotEditor` | `screenshot:data`, `screenshot:complete`, `screenshot:cancel`, `screenshot:copy`, `screenshot:save` |

### 渲染进程 API 层（6 个文件）

| 文件 | 职责 |
|------|------|
| `src/renderer/api/createApp.ts` | `ElectronApp` 工厂，组装所有 API 模块 |
| `src/renderer/api/appApi.ts` | `AppApi` -- 封装 app channel |
| `src/renderer/api/backgroundApi.ts` | `BackgroundApi` -- 封装 background channel |
| `src/renderer/api/httpApi.ts` | `HttpApi` -- 封装 http channel |
| `src/renderer/api/fileApi.ts` | `FileApi` -- 封装 file channel |
| `src/renderer/api/index.ts` | 重新导出所有 API 模块 |

### 渲染进程入口（3 个文件）

| 文件 | 职责 |
|------|------|
| `src/renderer/main.ts` | 主窗口入口 |
| `src/renderer/background.ts` | Worker 窗口入口 |
| `src/renderer/screenshot-editor/main.ts` | 截图编辑器入口 |

### Worker 服务（3 个文件）

| 文件 | 注册的任务 |
|------|-----------|
| `src/worker/registerServices.ts` | `ServiceRegistry` 注册所有 Worker 任务 |
| `src/worker/services/taskService.ts` | `ping`, `processData`, `longRunningTask` |
| `src/worker/services/httpService.ts` | `http:request`, `http:get`, `http:post`（浏览器 `fetch`） |

---

## 十五、发现的潜在问题

1. **通道名不一致**：`ElectronApp.setupScreenshotIPC()` 注册了 `screenshot:save-file` 和 `screenshot:copy-clipboard`，但 `preload/screenshot-editor.ts` 使用的是 `screenshot:save` 和 `screenshot:copy`。前者从未被调用。

2. **ScreenshotChannel 已注册但无渲染端 API**：`ScreenshotChannel` 在 `IPCChannelManager` 中注册到了 VSCode IPC 框架，但渲染进程没有对应的 `Api` 类来使用它。当前的截图流程（`startScreenshot()`）直接在主进程中调用原生模块，不经过 VSCode IPC。

3. **BackgroundChannel 的任务监听器泄漏风险**：`ipcMain.on(BG_TASK_RESPONSE, handler)` 在超时时执行 `removeListener`，但如果 `ipcMain.on` 的 `handler` 被后续请求的 `handler` 覆盖（因为 `ipcMain.on` 是添加式的），不会产生覆盖问题，但每个任务的 `handler` 在超时前一直留在 `ipcMain` 上。

4. **ChannelServer 不维护 EventDispose**：`channel.ts:105` 注释明确指出"简单起见不维护 activeRequests 的 dispose"，意味着事件监听的 dispose 请求不被处理，连接断开时也不会清理。

5. **`ElectronProtocol` 类未被使用**：`electron-main/protocol.ts` 定义了 `ElectronProtocol` 类，但 `ElectronIPCServer` 内联构建了 `protocol` 对象，该类是冗余的。
