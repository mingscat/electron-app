# 待补充功能清单

> 基于当前架构分析，按优先级排列。每完成一项打 `[x]`。

---

## 🔴 高优先级（安全与稳定性）

### 1. FileChannel 路径安全

**现状**：FileChannel 接受任意绝对路径，渲染进程可读写系统任何文件。

**方案**：
- 定义沙箱根目录白名单（如 `app.getPath('userData')`、`app.getPath('documents')`）
- 在 FileChannel 每个命令中校验路径是否在白名单内
- 阻止路径穿越（`../` 跳出沙箱）
- 可选：提供 `unsafe` 模式（需显式开启）供开发/高级场景使用

**涉及文件**：
- [ ] `src/main/channels/FileChannel.ts` — 增加路径校验逻辑
- [ ] `src/types/file.d.ts` — 增加 `sandboxRoots` 配置类型

---

## 🟡 中优先级（功能完备性）

### 2. 日志服务

**现状**：全部 `console.log`，无文件持久化、无分级、无轮转。

**方案**：
- 创建 `LogChannel`，支持 `info` / `warn` / `error` / `debug` 分级
- 日志写入 `{userData}/logs/app-{date}.log`
- 单文件上限（如 10MB）自动轮转，保留最近 N 个
- 渲染进程通过 `api.log.info(...)` 调用
- 主进程内部模块也统一使用 LogService 替代 `console.log`

**涉及文件**：
- [ ] `src/types/log.d.ts`
- [ ] `src/main/channels/LogChannel.ts`
- [ ] `src/renderer/api/logApi.ts`
- [ ] `src/renderer/api/createApp.ts` — 挂载 `log: LogApi`
- [ ] `src/main/IPCChannelManager.ts` — 注册 LogChannel

---

### 3. Dialog / Shell 通道

**现状**：渲染进程无法调用原生对话框和系统功能。

**方案**：
- 打开文件选择器：`dialog.showOpenDialog`
- 保存文件对话框：`dialog.showSaveDialog`
- 消息对话框：`dialog.showMessageBox`
- 用系统浏览器打开 URL：`shell.openExternal`
- 在资源管理器/Finder 中显示文件：`shell.showItemInFolder`
- 打开文件（默认应用）：`shell.openPath`

**涉及文件**：
- [ ] `src/types/dialog.d.ts`
- [ ] `src/main/channels/DialogChannel.ts`
- [ ] `src/renderer/api/dialogApi.ts`
- [ ] `src/renderer/api/createApp.ts` — 挂载 `dialog: DialogApi`
- [ ] `src/main/IPCChannelManager.ts` — 注册 DialogChannel

---

### 4. 持久化存储通道（Settings）

**现状**：`package.json` 有 `electron-store` 依赖但未使用。

**方案**：
- 基于 `electron-store` 实现 SettingsChannel
- 支持 `get(key)` / `set(key, value)` / `getAll()` / `delete(key)` / `clear()`
- 支持 schema 校验（可选）
- 支持默认值

**涉及文件**：
- [ ] `src/types/settings.d.ts`
- [ ] `src/main/channels/SettingsChannel.ts`
- [ ] `src/renderer/api/settingsApi.ts`
- [ ] `src/renderer/api/createApp.ts` — 挂载 `settings: SettingsApi`
- [ ] `src/main/IPCChannelManager.ts` — 注册 SettingsChannel

> README 中已有 SettingsChannel 完整示例代码，可直接参考。

---

### 5. CSP（内容安全策略）

**现状**：无 CSP 头，渲染进程可加载任意外部脚本。

**方案**：
- 在 `index.html` 和 `background.html` 中添加 `<meta>` CSP
- 或在主进程通过 `session.webRequest.onHeadersReceived` 注入
- 推荐策略：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`

**涉及文件**：
- [ ] `src/renderer/index.html`
- [ ] `src/renderer/background.html`
- [ ] 或 `src/main/ElectronApp.ts`（通过 webRequest 注入）

---

## 🟢 低优先级（体验优化）

### 6. 系统托盘 + 原生菜单

**方案**：
- 创建 `TrayManager` 类，管理托盘图标和右键菜单
- 创建应用菜单栏（macOS 必须有，Windows/Linux 可选）
- 托盘菜单项：显示/隐藏窗口、退出

**涉及文件**：
- [ ] `src/main/TrayManager.ts`
- [ ] `src/main/MenuManager.ts`
- [ ] `src/main/ElectronApp.ts` — 初始化时创建
- [ ] 图标文件：`resources/icon.png` / `icon.ico`

---

### 7. 自动更新

**方案**：
- 集成 `electron-updater`
- 支持 GitHub Releases / 自建服务器
- 检查更新 → 下载 → 提示用户 → 安装重启
- 通过 Event listen 推送更新进度到渲染进程

**涉及文件**：
- [ ] `package.json` — 添加 `electron-updater` 依赖
- [ ] `src/main/UpdateManager.ts`
- [ ] `src/types/update.d.ts`
- [ ] `src/main/channels/UpdateChannel.ts`（事件：`onUpdateAvailable` / `onDownloadProgress`）
- [ ] `src/renderer/api/updateApi.ts`

---

### 8. 通知服务

**方案**：
- 封装 Electron `Notification` API
- 支持标题、正文、图标、点击回调
- 跨平台兼容处理

**涉及文件**：
- [ ] `src/types/notification.d.ts`
- [ ] `src/main/channels/NotificationChannel.ts`
- [ ] `src/renderer/api/notificationApi.ts`

---

### 9. 剪贴板操作

**方案**：
- 封装 `clipboard.readText` / `writeText` / `readImage` / `writeImage`

**涉及文件**：
- [ ] `src/types/clipboard.d.ts`
- [ ] `src/main/channels/ClipboardChannel.ts`
- [ ] `src/renderer/api/clipboardApi.ts`

---

### 10. 测试基础设施

**方案**：
- 单元测试：`vitest` — 测试 Service 逻辑、序列化层
- E2E：`playwright` / `@playwright/test` — 测试完整应用流程
- CI：GitHub Actions 运行测试

**涉及文件**：
- [ ] `vitest.config.ts`
- [ ] `tests/unit/` — 单元测试目录
- [ ] `tests/e2e/` — E2E 测试目录
- [ ] `package.json` — 添加 test 脚本和依赖

---

## 新接口通用步骤速查

每个新功能都遵循同样的 5 步流程（详见 README）：

| 步骤 | 文件 | 做什么 |
|------|------|--------|
| 1. 类型 | `src/types/xxx.d.ts` | 定义参数、响应、`IXxxChannel` 接口 |
| 2. Channel | `src/main/channels/XxxChannel.ts` | 继承 `BaseChannel`，注册 `onCommand` / `onEvent` |
| 3. 注册 | `src/main/IPCChannelManager.ts` | `ipcServer.registerChannel('xxx', ...)` |
| 4. API | `src/renderer/api/xxxApi.ts` | `class XxxApi` 封装 `channel.call()` / `channel.listen()` |
| 5. 挂载 | `src/renderer/api/createApp.ts` | `ElectronApp` 中 `new XxxApi(...)` |
| 6. 导出 | `types/index.d.ts` + `api/index.ts` | 各加一行 `export` |
