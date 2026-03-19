# IPC 目录深度解析

> 完整拆解 `src/ipc/` 下每个文件的职责、数据流和类关系。

---

## 目录结构

```
src/ipc/
├── common/                      ← 与 Electron 无关的通用内核
│   ├── types.ts                 ← 接口契约（所有其他文件的基础）
│   ├── buffer.ts                ← VSBuffer：二进制封装
│   ├── serializer.ts            ← 序列化：JS 值 ↔ 二进制
│   ├── event.ts                 ← Emitter / Event：事件工具
│   ├── channel.ts               ← ChannelServer / ChannelClient：多路复用
│   ├── ipc.ts                   ← IPCServer / IPCClient：握手 + 连接管理
│   └── baseChannel.ts           ← BaseChannel：业务 Channel 基类
├── electron-main/               ← 主进程专用
│   ├── server.ts                ← ElectronIPCServer：绑定 ipcMain
│   └── protocol.ts             ← ElectronProtocol：WebContents 协议
└── electron-browser/            ← 渲染进程专用
    └── client.ts                ← ElectronIPCClient：绑定 preload
```

---

## 第 1 层：类型契约 — `types.ts`

这是所有模块的「接口合同」，不含任何实现。

```
┌─────────────────────────────────────────────────────────────────┐
│                          types.ts                               │
│                                                                 │
│  IDisposable          { dispose(): void }                       │
│  CancellationToken    { isCancellationRequested: boolean }      │
│                                                                 │
│  IEvent<T>            (listener) => IDisposable                 │
│                       一个「可订阅的事件」，调用即订阅            │
│                                                                 │
│  IMessagePassingProtocol                                        │
│    send(buffer)       发送原始二进制                              │
│    onMessage          接收原始二进制                              │
│    disconnect?()      断开连接（可选）                            │
│                                                                 │
│  IChannel (客户端视角)                                            │
│    call(command, arg?) → Promise     请求-响应                   │
│    listen(event, arg?) → IEvent      事件订阅                    │
│                                                                 │
│  IServerChannel (服务端视角)                                      │
│    call(ctx, command, arg?) → Promise                           │
│    listen(ctx, event, arg?) → IEvent                            │
│    ctx = 调用者身份（如 "window:123"）                            │
│                                                                 │
│  ClientConnectionEvent                                          │
│    protocol            该连接的消息通道                           │
│    onDidClientDisconnect  该连接的断开事件                        │
└─────────────────────────────────────────────────────────────────┘
```

**关键洞察**：`IChannel` 和 `IServerChannel` 的区别仅在于 `ctx` 参数。客户端不关心自己是谁（`IChannel`），服务端需要知道是谁在调用（`IServerChannel<TContext>`）。

---

## 第 2 层：二进制基础 — `buffer.ts`

```
┌─────────────────────────────────────────┐
│              VSBuffer                    │
│                                         │
│  内部：Uint8Array                        │
│                                         │
│  静态方法:                               │
│    alloc(n)       → 分配 n 字节          │
│    wrap(data)     → 兼容 Buffer/         │
│                     ArrayBuffer/         │
│                     Uint8Array           │
│    fromString(s)  → TextEncoder 编码     │
│    concat(arr)    → 拼接多段             │
│    isNativeBuffer → 类型守卫             │
│                                         │
│  实例方法:                               │
│    byteLength     → 长度                │
│    slice(s, e)    → 切片                │
│    writeUInt8(v,i)→ 写单字节             │
└─────────────────────────────────────────┘
```

**为什么需要 VSBuffer？** Electron 跨进程传输时，`Buffer`（Node.js）和 `Uint8Array`（浏览器）不完全兼容。`VSBuffer.wrap()` 统一处理三种输入形态。

---

## 第 3 层：序列化引擎 — `serializer.ts`

把任意 JS 值编码为二进制，再从二进制还原。

### 编码格式

每个值的编码结构为：`[类型标签 1字节] [VQL变长长度] [数据]`

```
DataType 枚举:
  0 = Undefined     →  仅标签，无数据
  1 = String        →  标签 + VQL长度 + UTF-8 字节
  2 = Buffer        →  标签 + VQL长度 + 原始字节
  3 = VSBuffer      →  同 Buffer
  4 = Array         →  标签 + VQL元素数 + 逐元素递归
  5 = Object        →  标签 + VQL长度 + JSON.stringify UTF-8
  6 = Int           →  标签 + VQL编码的整数值
```

### VQL 编码（Variable Quantity Length）

用变长字节编码整数，小数字占少字节：

```
值 0~127        →  1 字节   [0xxxxxxx]
值 128~16383    →  2 字节   [1xxxxxxx] [0xxxxxxx]
值 16384~...    →  3+ 字节  [1xxxxxxx] [1xxxxxxx] [0xxxxxxx]

每字节低 7 位存数据，最高位 1 = 还有后续字节，0 = 结束
```

### serialize 流程图

```
serialize(writer, data)
    │
    ├── data === undefined?
    │     └─ write [0x00]
    │
    ├── typeof data === 'string'?
    │     └─ write [0x01] + VQL(byteLen) + UTF-8 bytes
    │
    ├── ArrayBuffer / Uint8Array / Buffer?
    │     └─ write [0x02] + VQL(byteLen) + raw bytes
    │
    ├── VSBuffer?
    │     └─ write [0x03] + VQL(byteLen) + raw bytes
    │
    ├── Array?
    │     └─ write [0x04] + VQL(length)
    │        for each → serialize(writer, element)  ← 递归
    │
    ├── number (整数)?
    │     └─ write [0x06] + VQL(value)
    │
    └── else (Object / float / bool / ...)
          └─ write [0x05] + VQL(jsonLen) + JSON.stringify UTF-8
```

### 完整编码示例

```
serialize(['app', 'getVersion', 42])

  Array标签:   [0x04]
  VQL(3):      [0x03]               ← 3 个元素
  ├── String标签: [0x01]
  │   VQL(3):    [0x03]
  │   UTF-8:     [61 70 70]         ← "app"
  ├── String标签: [0x01]
  │   VQL(10):   [0x0A]
  │   UTF-8:     [67 65 74 56 ...]  ← "getVersion"
  └── Int标签:   [0x06]
      VQL(42):   [0x2A]             ← 42

最终二进制: 04 03 01 03 61 70 70 01 0A 67 65 74 56 ... 06 2A
```

### BufferReader / BufferWriter

```
BufferWriter                          BufferReader
  buffers: VSBuffer[]                   buf: VSBuffer
  write(buf) → push                     pos: number
  .buffer → concat all                  read(n) → slice(pos, pos+n); pos += n
```

---

## 第 4 层：事件系统 — `event.ts`

```
┌─────────────────────────────────────────────────────────────┐
│                        Emitter<T>                            │
│                                                              │
│  listeners: Array<(e: T) => void>                            │
│                                                              │
│  .event     ← IEvent<T>，外部调用此函数来订阅                  │
│               返回 IDisposable（调 dispose 取消订阅）          │
│                                                              │
│  .fire(v)   ← 触发事件，遍历 listeners 调用                   │
│  .dispose() ← 清理所有订阅者                                  │
│                                                              │
│  使用模式：                                                   │
│    private readonly _onLog = new Emitter<LogEntry>();         │
│    // 对外暴露 event（只读订阅），对内使用 fire（写入触发）     │
│    public readonly onLog = this._onLog.event;                │
│    doSomething() { this._onLog.fire({...}); }                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Event (静态工具类)                        │
│                                                              │
│  Event.None   ← 空事件，subscribe 后永远不触发                │
│  Event.once() ← 包装事件为只触发一次后自动 dispose             │
└─────────────────────────────────────────────────────────────┘
```

---

## 第 5 层：多路复用 — `channel.ts`

这是 IPC 系统的核心。一条 protocol 连接上可以跑多个 channel，每个 channel 有多个 command/event。

### 消息协议格式

```
每条消息 = header(序列化后) + body(序列化后)

请求 (Client → Server):
  header = [RequestType, requestId, channelName, commandName]
  body   = arg

响应 (Server → Client):
  header = [ResponseType, requestId]
  body   = data / error
```

### RequestType / ResponseType 枚举

```
RequestType:                    ResponseType:
  100 = Promise                   200 = Initialize      ← 握手确认
  101 = PromiseCancel             201 = PromiseSuccess   ← 调用成功
  102 = EventListen               202 = PromiseError     ← 调用失败
  103 = EventDispose              203 = PromiseErrorObj
                                  204 = EventFire        ← 事件触发
```

### ChannelServer（运行在主进程）

```
┌─────────────────────────────────────────────────────────────────┐
│                       ChannelServer                              │
│                                                                  │
│  channels: Map<string, IServerChannel>                           │
│  protocol: IMessagePassingProtocol                               │
│  ctx: TContext                                                   │
│                                                                  │
│  构造时:                                                          │
│    ① protocol.onMessage(msg => this.onMessage(msg))  ← 监听消息  │
│    ② sendResponse([Initialize])                       ← 握手确认  │
│                                                                  │
│  onMessage(msg):                                                 │
│    ① deserialize → header + body                                 │
│    ② switch(header[0]):                                          │
│       ├── Promise (100):                                         │
│       │     channel = channels.get(channelName)                  │
│       │     channel.call(ctx, name, body)                        │
│       │       .then → sendResponse([PromiseSuccess, id], data)   │
│       │       .catch → sendResponse([PromiseError, id], err)     │
│       │                                                          │
│       └── EventListen (102):                                     │
│             channel = channels.get(channelName)                  │
│             event = channel.listen(ctx, name, body)              │
│             event(data => sendResponse([EventFire, id], data))   │
│                                                                  │
│  sendResponse(header, body?):                                    │
│    serialize(header) + serialize(body) → protocol.send(buffer)   │
└─────────────────────────────────────────────────────────────────┘
```

### ChannelClient（运行在渲染进程）

```
┌─────────────────────────────────────────────────────────────────┐
│                       ChannelClient                              │
│                                                                  │
│  handlers: Map<id, callback>     ← 等待响应的回调表               │
│  lastRequestId: number           ← 自增 ID                      │
│  initPromise: Promise<void>      ← 等 Initialize 响应才能发请求   │
│                                                                  │
│  构造时:                                                          │
│    protocol.onMessage(msg => this.onMessage(msg))                │
│                                                                  │
│  getChannel(channelName) → 返回 IChannel 代理对象:                │
│    │                                                              │
│    ├── .call(command, arg):                                       │
│    │     ① 分配 id = lastRequestId++                              │
│    │     ② 等 initPromise（确保 Initialize 已收到）                │
│    │     ③ 注册 handler: handlers.set(id, callback)              │
│    │     ④ serialize [Promise, id, channelName, command] + arg   │
│    │     ⑤ protocol.send(buffer)                                 │
│    │     ⑥ callback 被调用时:                                     │
│    │        PromiseSuccess → resolve(data)                       │
│    │        PromiseError   → reject(Error)                       │
│    │                                                              │
│    └── .listen(event, arg):                                       │
│          ① 分配 id                                                │
│          ② 注册 handler: EventFire → listener(data)              │
│          ③ serialize [EventListen, id, channelName, event] + arg │
│          ④ protocol.send(buffer)                                 │
│          ⑤ 返回 IDisposable:                                     │
│             dispose → send [EventDispose, id] + handlers.delete  │
│                                                                  │
│  onMessage(msg):                                                 │
│    ① deserialize → header + body                                 │
│    ② type = header[0]                                            │
│    ③ if Initialize → initResolve()，后续请求可以发送              │
│    ④ else → handlers.get(id)?.(response)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 第 6 层：握手与连接 — `ipc.ts`

在 `ChannelServer/Client` 之上再包一层：管理**连接建立**和 **context 身份传递**。

### IPCServer（主进程总入口）

```
┌──────────────────────────────────────────────────────────────────┐
│                          IPCServer                                │
│                                                                   │
│  channels: Map<string, IServerChannel>    ← 全局 channel 注册表   │
│                                                                   │
│  构造时:                                                           │
│    onDidClientConnect(callback)                                   │
│      │                                                            │
│      └── 每当有新客户端连接:                                        │
│            ① 等待客户端发来的 第一条消息（= context 身份包）         │
│            ② deserialize(msg) → ctx                               │
│            ③ new ChannelServer(protocol, ctx)                     │
│            ④ 把所有已注册 channel 复制给这个 ChannelServer          │
│            ⑤ onDidClientDisconnect → channelServer.dispose()      │
│                                                                   │
│  registerChannel(name, channel):                                  │
│    channels.set(name, channel)                                    │
│    (新连接建立时会自动注册到对应的 ChannelServer)                   │
└──────────────────────────────────────────────────────────────────┘
```

### IPCClient（渲染进程总入口）

```
┌──────────────────────────────────────────────────────────────────┐
│                          IPCClient                                │
│                                                                   │
│  channelClient: ChannelClient                                     │
│                                                                   │
│  构造时:                                                           │
│    ① serialize(ctx) → buffer                                      │
│    ② protocol.send(buffer)         ← 发送身份包（第一条消息）       │
│    ③ new ChannelClient(protocol)   ← 此后进入正常收发模式           │
│                                                                   │
│  getChannel(name) → channelClient.getChannel(name)                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 第 7 层：Electron 绑定

### ElectronIPCServer（主进程）

```
┌──────────────────────────────────────────────────────────────────┐
│              ElectronIPCServer extends IPCServer                   │
│                                                                   │
│  static create():                                                 │
│    │                                                              │
│    └── buildConnectionListener():                                 │
│          │                                                        │
│          └── ipcMain.on('vscode:hello', event => {                │
│                │                                                  │
│                │  webContents = event.sender                      │
│                │  senderId = webContents.id                       │
│                │                                                  │
│                │  ┌────────────────────────────────────────────┐  │
│                │  │ 为该连接创建专属 protocol:                   │  │
│                │  │                                            │  │
│                │  │ send(buffer):                               │  │
│                │  │   Buffer.from(data)                         │  │
│                │  │   webContents.send('vscode:message', buf)   │  │
│                │  │                                            │  │
│                │  │ onMessage:                                  │  │
│                │  │   ipcMain.on('vscode:message', handler)     │  │
│                │  │   过滤: ev.sender.id === senderId           │  │
│                │  └────────────────────────────────────────────┘  │
│                │                                                  │
│                │  ┌────────────────────────────────────────────┐  │
│                │  │ onDidClientDisconnect:                      │  │
│                │  │   ipcMain.on('vscode:disconnect', handler)  │  │
│                │  │   过滤: ev.sender.id === senderId           │  │
│                │  │   触发时清理 msgHandler / disconnectHandler  │  │
│                │  └────────────────────────────────────────────┘  │
│                │                                                  │
│                │  通知 IPCServer: { protocol, onDidClientDisconnect }
│                │                                                  │
│              })  // end ipcMain.on('vscode:hello')                │
│                                                                   │
│  继承自 IPCServer: registerChannel(name, channel)                  │
└──────────────────────────────────────────────────────────────────┘
```

### ElectronIPCClient（渲染进程）

```
┌──────────────────────────────────────────────────────────────────┐
│              ElectronIPCClient extends IPCClient                   │
│                                                                   │
│  static create(ipc, ctx):                                         │
│    │                                                              │
│    ├── buildProtocol(ipc):                                        │
│    │     │                                                        │
│    │     │  ┌────────────────────────────────────────────────┐    │
│    │     │  │ protocol:                                       │    │
│    │     │  │                                                 │    │
│    │     │  │ send(buffer):                                   │    │
│    │     │  │   Uint8Array → ipc.send('vscode:message', buf)  │    │
│    │     │  │                                                 │    │
│    │     │  │ onMessage:                                      │    │
│    │     │  │   ipc.on('vscode:message', handler)             │    │
│    │     │  │   Buffer/ArrayBuffer → Uint8Array 转换          │    │
│    │     │  └────────────────────────────────────────────────┘    │
│    │     │                                                        │
│    │     └── return protocol                                      │
│    │                                                              │
│    ├── ipc.send('vscode:hello')        ← 握手                     │
│    │                                                              │
│    └── new ElectronIPCClient(protocol, ctx)                       │
│           │                                                       │
│           └── super(protocol, ctx)                                │
│                 │  ① serialize(ctx) → protocol.send()  ← 身份包   │
│                 │  ② new ChannelClient(protocol)                  │
│                 │     └── 等待 Initialize 响应                     │
│                                                                   │
│  继承自 IPCClient: getChannel(name), dispose()                    │
└──────────────────────────────────────────────────────────────────┘
```

### ElectronProtocol（备用协议实现）

```
┌──────────────────────────────────────────────────────────────────┐
│       ElectronProtocol implements IMessagePassingProtocol          │
│                                                                   │
│  构造时接收 webContents + onMessage (IEvent<Uint8Array>)           │
│                                                                   │
│  send(buffer):  webContents.send('vscode:message', Buffer.from()) │
│  onMessage:     透传构造参数                                       │
│                                                                   │
│  （当前 ElectronIPCServer 用内联 protocol，此类可用于独立场景）      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 第 8 层：业务 Channel 基类 — `baseChannel.ts`

```
┌──────────────────────────────────────────────────────────────────┐
│            BaseChannel (abstract) implements IServerChannel        │
│                                                                   │
│  commands: Map<string, (ctx, arg) => Promise>                     │
│  events:   Map<string, IEvent>                                    │
│                                                                   │
│  protected onCommand(name, handler)  ← 子类注册命令                │
│  protected onEvent(name, source)     ← 子类注册事件                │
│                                                                   │
│  call(ctx, command, arg):                                         │
│    commands.get(command)?.(ctx, arg) ?? reject('未知命令')          │
│                                                                   │
│  listen(ctx, event, arg):                                         │
│    events.get(event) ?? Event.None                                │
│                                                                   │
│  ─────────────────────────────────────────────────────            │
│  子类示例（AppChannel）:                                           │
│    constructor() {                                                │
│      this.onCommand('getVersion', this.handleGetVersion);         │
│      this.onCommand('ping', this.handlePing);                     │
│      this.onEvent('onLog', this._onLog.event);                    │
│    }                                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 完整生命周期流程图

### 阶段 1：应用启动 → 连接建立

```
时间线 ──────────────────────────────────────────────────────────────▶

Main Process                          Renderer Process
─────────────                         ─────────────────

① ElectronApp.create()
   └── ElectronIPCServer.create()
       └── ipcMain.on('vscode:hello')  ← 就绪，等待连接

② IPCChannelManager
     .registerDefaults(windowManager)
     .bindTo(ipcServer)
   └── ipcServer.registerChannel('app', appCh)
       ipcServer.registerChannel('http', httpCh)
       ipcServer.registerChannel('file', fileCh)
       ipcServer.registerChannel('background', bgCh)

③ WindowManager.createMainWindow()
   └── new BrowserWindow({preload})
       └── 加载 index.html + preload
                                      ④ preload 执行
                                         └── contextBridge.exposeInMainWorld(
                                               'ipcForVSCode', { send, on })

                                      ⑤ renderer main.ts 执行
                                         └── ElectronApp.create(ipc)
                                               │
                                               ├── buildProtocol(ipc)
                                               │     └── ipc.on('vscode:message', ...)
                                               │
                                               ├── ipc.send('vscode:hello')
  ┌──────────── vscode:hello ────────────────────┘
  │
  ▼
⑥ ipcMain hello handler 触发
   ├── 创建 per-connection protocol
   │   (send → webContents.send, onMessage → ipcMain.on 过滤 senderId)
   ├── 通知 IPCServer: { protocol, onDidClientDisconnect }
   └── IPCServer 等待第一条消息...
                                               │
                                               └── super(protocol, ctx)
                                                     │
                                                     ├── serialize("window:168...")
                                                     │   → protocol.send(buffer)
  ┌──────── vscode:message (身份包) ────────────────────┘
  │
  ▼
⑦ IPCServer 收到身份包
   ├── deserialize → ctx = "window:168..."
   ├── new ChannelServer(protocol, ctx)
   │     └── sendResponse([Initialize])
   │           → protocol.send(buffer)
  ┌──────── vscode:message (Initialize) ─────────────────┐
  │                                                       │
  │                                                       ▼
  │                                         ⑧ ChannelClient.onMessage
  │                                            type === Initialize
  │                                            initResolve() ← 解锁！
  │                                            后续 call/listen 可以发出
  │
  └── 把 app/http/file/background 四个 channel
      注册到该 ChannelServer

✓ 连接建立完成
```

### 阶段 2：请求-响应（call）

```
时间线 ──────────────────────────────────────────────────────────────▶

Renderer                                Main Process
────────                                ────────────

api.app.getVersion()
  │
  ▼
AppApi.getVersion()
  │ this.channel.call('getVersion')
  ▼
ChannelClient (IChannel 代理)
  │ id = 0 (自增)
  │ await initPromise  ← 已就绪
  │ handlers.set(0, callback)
  │
  │ serialize:
  │   header = [100, 0, 'app', 'getVersion']
  │   body   = undefined
  │
  │ ┌──────────────────────────────────┐
  │ │ 二进制:                           │
  │ │ [04 04 06 64 06 00 01 03 ...     │
  │ │  ^^          ^^       ^^         │
  │ │  Array(4)    100      'app'      │
  │ └──────────────────────────────────┘
  │
  │ protocol.send(buffer)
  │ → ipc.send('vscode:message', arrayBuffer)
  │
  ═══════════════════ 进程边界 ════════════════════
  │
  │ ipcMain.on('vscode:message')
  │ → msgHandler (过滤 senderId ✓)
  │ → ChannelServer.onMessage(msg)
  │
  │ deserialize:
  │   header = [100, 0, 'app', 'getVersion']
  │   body   = undefined
  │   type   = 100 (Promise)
  │
  │ channels.get('app') → AppChannel
  │ AppChannel.call(ctx, 'getVersion', undefined)
  │ → BaseChannel.call → commands.get('getVersion')
  │ → handleGetVersion() → app.getVersion()
  │ → "1.0.0"
  │
  │ .then(data):
  │   serialize:
  │     header = [201, 0]
  │     body   = "1.0.0"
  │   protocol.send(buffer)
  │   → webContents.send('vscode:message', buffer)
  │
  ═══════════════════ 进程边界 ════════════════════
  │
  │ ipc.on('vscode:message')
  │ → ChannelClient.onMessage(msg)
  │
  │ deserialize:
  │   header = [201, 0]
  │   body   = "1.0.0"
  │   type   = 201 (PromiseSuccess)
  │   id     = 0
  │
  │ handlers.get(0) → callback
  │ callback({ type: 201, data: "1.0.0" })
  │ → resolve("1.0.0")
  ▼
api.app.getVersion() ──▶ "1.0.0" ✓
```

### 阶段 3：事件订阅（listen）

```
时间线 ──────────────────────────────────────────────────────────────▶

Renderer                                Main Process
────────                                ────────────

api.app.onLog(entry => console.log(entry))
  │
  ▼
AppApi.onLog(listener)
  │ this.channel.listen('onLog')
  │ → 返回 IEvent<LogEntry>
  │ → 调用 IEvent(listener) 进行订阅
  ▼
ChannelClient (IChannel 代理) .listen('onLog')
  │ id = 1
  │ handlers.set(1, res => {
  │   if (res.type === EventFire) listener(res.data)
  │ })
  │
  │ await initPromise
  │ serialize [EventListen, 1, 'app', 'onLog'] + undefined
  │ protocol.send(buffer)
  │
  ═══════════════════ 进程边界 ════════════════════
  │
  │ ChannelServer.onMessage
  │ type = 102 (EventListen)
  │ channel = AppChannel
  │ event = AppChannel.listen(ctx, 'onLog')
  │   → BaseChannel.events.get('onLog')
  │   → _onLog.event  (Emitter 的 event 函数)
  │
  │ event(data => sendResponse([EventFire, 1], data))
  │   → Emitter 注册了一个 listener
  │
  ✓ 订阅建立完成（此时 Emitter 有一个 listener）
  │
  │                                      ... 某个时刻 ...
  │
  │ appChannel.pushLog('info', '操作完成')
  │   → _onLog.fire({ level:'info', message:'操作完成', ts:... })
  │   → Emitter 遍历 listeners
  │   → sendResponse([EventFire, 1], logEntry)
  │   → serialize + protocol.send(buffer)
  │
  ═══════════════════ 进程边界 ════════════════════
  │
  │ ChannelClient.onMessage
  │ type = 204 (EventFire), id = 1
  │ handlers.get(1) → callback
  │ callback({ type: 204, data: logEntry })
  │ → res.type === EventFire → listener(logEntry)
  ▼
entry => console.log(entry)
  ──▶ { level:'info', message:'操作完成', timestamp:... } ✓

                                         ... 取消订阅 ...
dispose()
  │ serialize [EventDispose, 1] → protocol.send
  │ handlers.delete(1)
  ═══════════════════ 进程边界 ════════════════════
  （Server 端收到后清理 Emitter listener）
```

---

## 类依赖关系图

```
                           types.ts
                        (接口 / 契约)
                     ┌───────┴────────┐
                     ▼                ▼
                 buffer.ts        event.ts
                 (VSBuffer)    (Emitter / Event)
                     │                │
                     ▼                │
               serializer.ts          │
          (serialize/deserialize)     │
          (BufferReader/Writer)       │
                     │                │
                     ▼                ▼
               ┌─────────────────────────┐
               │      channel.ts          │
               │  ChannelServer           │──── 使用 serialize/deserialize
               │  ChannelClient           │──── 使用 Event.None
               └────────────┬────────────┘
                            │
                            ▼
               ┌─────────────────────────┐
               │        ipc.ts           │
               │  IPCServer              │──── 创建 ChannelServer
               │  IPCClient              │──── 创建 ChannelClient
               └──┬─────────────────┬────┘
                  │                 │
                  ▼                 ▼
         ┌────────────────┐  ┌────────────────┐
         │ electron-main/ │  │electron-browser/│
         │  server.ts     │  │  client.ts      │
         │ElectronIPCServer│ │ElectronIPCClient│
         │extends IPCServer│ │extends IPCClient│
         └────────────────┘  └────────────────┘
                  │
                  │ (可选)
                  ▼
         ┌────────────────┐
         │ protocol.ts    │
         │ElectronProtocol│
         │implements       │
         │ IMessagePassing │
         │ Protocol        │
         └────────────────┘

               ┌─────────────────────────┐
               │    baseChannel.ts        │
               │  BaseChannel (abstract)  │──── 使用 Event.None
               │  implements IServerChannel│
               │                          │
               │  被业务 Channel 继承:      │
               │    AppChannel            │
               │    HttpChannel           │
               │    FileChannel           │
               │    BackgroundChannel     │
               └─────────────────────────┘
```

---

## 一句话总结每个文件

| 文件 | 一句话 |
|------|--------|
| `types.ts` | 定义所有接口契约，不含实现 |
| `buffer.ts` | 统一 Buffer/ArrayBuffer/Uint8Array 为 VSBuffer |
| `serializer.ts` | 用「类型标签 + VQL 变长编码」把 JS 值编码为二进制 |
| `event.ts` | Emitter（fire → 通知订阅者）+ Event.None/once 工具 |
| `channel.ts` | **核心**：ChannelServer 收请求分发到 channel，ChannelClient 发请求等响应 |
| `ipc.ts` | 在 channel 之上加**握手**：Client 发身份包，Server 为每个连接创建独立 ChannelServer |
| `baseChannel.ts` | 业务 Channel 基类：子类只需 `onCommand` + `onEvent` 注册 |
| `server.ts` | 把 IPCServer 绑定到 Electron 的 `ipcMain`（hello/message/disconnect） |
| `protocol.ts` | 把 `IMessagePassingProtocol` 绑定到 `webContents.send` |
| `client.ts` | 把 IPCClient 绑定到 preload 暴露的 `ipc.send/on` |
