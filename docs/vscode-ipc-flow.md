# VSCode IPC 流程图

## 1. 连接建立流程

```
┌─────────────┐                                    ┌─────────────┐
│  渲染进程    │                                    │   主进程     │
└─────────────┘                                    └─────────────┘
      │                                                  │
      │  1. new IPCClient('window:1')                   │
      │     └─> createProtocol()                        │
      │         ├─> ipcRenderer.on('vscode:message')    │
      │         └─> ipcRenderer.send('vscode:hello')   │
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              vscode:hello                        │
      │                                                  │
      │                                                  │  2. ipcMain.on('vscode:hello')
      │                                                  │     └─> createScopedOnMessageEvent()
      │                                                  │         └─> onDidClientConnect.fire()
      │                                                  │
      │                                                  │  3. IPCServer 处理连接
      │                                                  │     └─> Event.once(protocol.onMessage)
      │                                                  │         (等待首消息)
      │                                                  │
      │  4. IPCClient 构造函数                           │
      │     ├─> serialize(ctx: 'window:1')              │
      │     └─> protocol.send(buffer)                   │
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              vscode:message                      │
      │              [Context: 'window:1']               │
      │                                                  │
      │                                                  │  5. 收到 Context
      │                                                  │     ├─> new ChannelServer(protocol, ctx)
      │                                                  │     │   └─> send Initialize
      │                                                  │     ├─> new ChannelClient(protocol)
      │                                                  │     └─> registerChannel('app', ...)
      │                                                  │
      │                                                  │─────────────────────────────────────>│
      │                                                  │         vscode:message              │
      │                                                  │         [Initialize]                │
      │                                                  │                                     │
      │  6. ChannelClient 收到 Initialize                │                                     │
      │     └─> state = Idle                            │                                     │
      │     └─> onDidInitialize.fire()                  │                                     │
      │                                                  │                                     │
      │  ✓ 连接建立完成，可以开始通信                    │                                     │
```

## 2. 调用流程（渲染进程 → 主进程）

```
┌─────────────┐                                    ┌─────────────┐
│  渲染进程    │                                    │   主进程     │
└─────────────┘                                    └─────────────┘
      │                                                  │
      │  appChannel.call('getVersion')                  │
      │                                                  │
      │  1. ChannelClient.requestPromise()              │
      │     ├─> id = lastRequestId++                   │
      │     ├─> handlers.set(id, handler)              │
      │     └─> whenInitialized().then(...)            │
      │                                                  │
      │  2. serialize([Promise, id, 'app', 'getVersion', undefined])
      │     └─> protocol.send(buffer)                  │
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              vscode:message                      │
      │              [Promise, 1, 'app', 'getVersion']  │
      │                                                  │
      │                                                  │  3. ChannelServer.onRawMessage()
      │                                                  │     ├─> deserialize(header)
      │                                                  │     ├─> deserialize(body)
      │                                                  │     └─> onPromise(request)
      │                                                  │
      │                                                  │  4. ChannelServer.onPromise()
      │                                                  │     ├─> channel = channels.get('app')
      │                                                  │     └─> channel.call(ctx, 'getVersion', undefined)
      │                                                  │
      │                                                  │  5. appChannel.call()
      │                                                  │     └─> return Promise.resolve('1.0.0')
      │                                                  │
      │                                                  │  6. ChannelServer.sendResponse()
      │                                                  │     ├─> serialize([PromiseSuccess, 1, '1.0.0'])
      │                                                  │     └─> protocol.send(buffer)
      │                                                  │
      │─────────────────────────────────────────────────<│
      │              vscode:message                      │
      │              [PromiseSuccess, 1, '1.0.0']       │
      │                                                  │
      │  7. ChannelClient.onBuffer()                    │
      │     ├─> deserialize(header)                     │
      │     ├─> handler = handlers.get(1)               │
      │     └─> handler({ type: PromiseSuccess, data: '1.0.0' })
      │                                                  │
      │  8. Promise resolve('1.0.0')                    │
      │                                                  │
      │  ✓ 调用完成                                     │
```

## 3. 事件订阅流程（渲染进程 ← 主进程）

```
┌─────────────┐                                    ┌─────────────┐
│  渲染进程    │                                    │   主进程     │
└─────────────┘                                    └─────────────┘
      │                                                  │
      │  appChannel.listen('onUpdate')                  │
      │                                                  │
      │  1. ChannelClient.requestEvent()                │
      │     ├─> id = lastRequestId++                   │
      │     ├─> handlers.set(id, handler)              │
      │     └─> serialize([EventListen, id, 'app', 'onUpdate'])
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              vscode:message                      │
      │              [EventListen, 2, 'app', 'onUpdate'] │
      │                                                  │
      │                                                  │  2. ChannelServer.onEventListen()
      │                                                  │     ├─> channel = channels.get('app')
      │                                                  │     └─> event = channel.listen(ctx, 'onUpdate')
      │                                                  │
      │                                                  │  3. 订阅事件
      │                                                  │     └─> event(data => {
      │                                                  │           sendResponse([EventFire, 2, data])
      │                                                  │         })
      │                                                  │
      │                                                  │  4. 事件触发（主进程内部）
      │                                                  │     └─> updateEmitter.fire('new version')
      │                                                  │
      │                                                  │  5. ChannelServer.sendResponse()
      │                                                  │     └─> serialize([EventFire, 2, 'new version'])
      │                                                  │
      │─────────────────────────────────────────────────<│
      │              vscode:message                      │
      │              [EventFire, 2, 'new version']       │
      │                                                  │
      │  6. ChannelClient.onBuffer()                    │
      │     ├─> handler = handlers.get(2)              │
      │     └─> handler({ type: EventFire, data: 'new version' })
      │                                                  │
      │  7. listener('new version')                     │
      │                                                  │
      │  ✓ 事件已接收                                   │
```

## 4. 消息序列化格式

### 4.1 请求消息结构

```
┌─────────────────────────────────────────────────────┐
│ Header (序列化)                                      │
├─────────────────────────────────────────────────────┤
│ [RequestType: Int]   100 = Promise, 102 = EventListen│
│ [id: Int]           请求唯一 ID                       │
│ [channelName: String] 'app', 'window', etc.         │
│ [command: String]    'getVersion', 'onUpdate', etc. │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ Body (序列化)                                        │
├─────────────────────────────────────────────────────┤
│ [arg: Any]          参数（undefined/String/Object等） │
└─────────────────────────────────────────────────────┘
```

### 4.2 响应消息结构

```
┌─────────────────────────────────────────────────────┐
│ Header (序列化)                                      │
├─────────────────────────────────────────────────────┤
│ [ResponseType: Int]  200=Init, 201=Success, etc.   │
│ [id: Int]           对应的请求 ID                    │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ Body (序列化)                                        │
├─────────────────────────────────────────────────────┤
│ [data: Any]         返回值或错误信息                   │
└─────────────────────────────────────────────────────┘
```

### 4.3 VQL 序列化示例

```
字符串 "hello" 的序列化：
┌──────┬──────────┬─────────────────┐
│ Type │ Length   │ Data            │
│ 0x01 │ 0x05     │ 'h','e','l','l','o' │
└──────┴──────────┴─────────────────┘

数组 [1, 2, 3] 的序列化：
┌──────┬──────────┬─────────────────────────────────────┐
│ Type │ Length   │ Elements                            │
│ 0x04 │ 0x03     │ [Int:1][Int:2][Int:3]              │
└──────┴──────────┴─────────────────────────────────────┘

对象 {a: 1} 的序列化：
┌──────┬──────────┬─────────────────┐
│ Type │ Length   │ JSON String     │
│ 0x05 │ 0x07     │ '{"a":1}'       │
└──────┴──────────┴─────────────────┘
```

## 5. 多连接管理（多窗口场景）

```
┌─────────────────────────────────────────────────────────┐
│                    IPCServer                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  channels: Map<string, IServerChannel>           │  │
│  │    'app' → appChannel                            │  │
│  │    'window' → windowChannel                      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  connections: Set<Connection>                    │  │
│  │    Connection {                                  │  │
│  │      ctx: 'window:1',                            │  │
│  │      channelServer: ChannelServer,               │  │
│  │      channelClient: ChannelClient                │  │
│  │    }                                             │  │
│  │    Connection {                                  │  │
│  │      ctx: 'window:2',                            │  │
│  │      channelServer: ChannelServer,               │  │
│  │      channelClient: ChannelClient                │  │
│  │    }                                             │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌────────┐       ┌────────┐       ┌────────┐
   │窗口 1   │       │窗口 2   │       │窗口 3   │
   │IPCClient│       │IPCClient│       │IPCClient│
   └────────┘       └────────┘       └────────┘
```

**路由机制**：
- 默认：随机选择一个连接
- 使用 Router：根据条件选择特定连接
- 事件：可以多播到所有连接

## 6. 错误处理流程

```
┌─────────────┐                                    ┌─────────────┐
│  渲染进程    │                                    │   主进程     │
└─────────────┘                                    └─────────────┘
      │                                                  │
      │  appChannel.call('unknown')                     │
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              [Promise, 1, 'app', 'unknown']       │
      │                                                  │
      │                                                  │  channel.call()
      │                                                  │    └─> throw new Error('Unknown command')
      │                                                  │
      │                                                  │  ChannelServer.catch()
      │                                                  │    └─> sendResponse({
      │                                                  │         type: PromiseError,
      │                                                  │         data: {
      │                                                  │           message: 'Unknown command',
      │                                                  │           name: 'Error',
      │                                                  │           stack: [...]
      │                                                  │         }
      │                                                  │       })
      │                                                  │
      │─────────────────────────────────────────────────<│
      │              [PromiseError, 1, {...}]            │
      │                                                  │
      │  ChannelClient.onBuffer()                       │
      │    └─> reject(new Error(data.message))         │
      │                                                  │
      │  Promise.catch()                                │
      │    └─> console.error('Unknown command')        │
```

## 7. 取消请求流程

```
┌─────────────┐                                    ┌─────────────┐
│  渲染进程    │                                    │   主进程     │
└─────────────┘                                    └─────────────┘
      │                                                  │
      │  const token = new CancellationTokenSource()    │
      │  appChannel.call('longTask', arg, token.token)  │
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              [Promise, 1, 'app', 'longTask']     │
      │                                                  │
      │                                                  │  ChannelServer.onPromise()
      │                                                  │    └─> cancellationTokenSource
      │                                                  │    └─> channel.call(..., token)
      │                                                  │
      │  token.cancel()                                 │
      │                                                  │
      │─────────────────────────────────────────────────>│
      │              [PromiseCancel, 1]                  │
      │                                                  │
      │                                                  │  ChannelServer.disposeActiveRequest()
      │                                                  │    └─> cancellationTokenSource.cancel()
      │                                                  │    └─> activeRequests.delete(1)
      │                                                  │
      │  Promise.catch(CancellationError)               │
      │                                                  │
      │  ✓ 请求已取消                                   │
```

## 8. 延迟 Channel 注册

```
时间线：
  t0: 渲染进程发送请求 [Promise, 1, 'newChannel', 'call']
      ↓
  t1: ChannelServer 收到请求
      └─> channels.get('newChannel') → undefined
      └─> collectPendingRequest()
          └─> pendingRequests.set('newChannel', [request])
          └─> setTimeout(1000ms) → 超时错误
      ↓
  t2: 主进程注册 Channel
      └─> ipcServer.registerChannel('newChannel', channel)
          └─> ChannelServer.registerChannel()
              └─> channels.set('newChannel', channel)
              └─> flushPendingRequests('newChannel')
                  └─> clearTimeout()
                  └─> onPromise(request)  ← 处理暂存的请求
      ↓
  t3: 请求成功处理
      └─> sendResponse([PromiseSuccess, 1, result])
```

这个机制确保了即使 Channel 注册顺序不确定，请求也不会丢失。
