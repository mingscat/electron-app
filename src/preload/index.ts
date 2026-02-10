/**
 * Preload：暴露 vscode 风格 IPC 通道给渲染进程（仅安全 channel：vscode:hello / vscode:message）
 */
import { contextBridge, ipcRenderer } from 'electron';

// ─── vscode 风格 IPC ─────────────────────────────────

const HELLO = 'vscode:hello';
const MESSAGE = 'vscode:message';

const ipc = {
  send(channel: string, ...args: unknown[]) {
    if (channel !== HELLO && channel !== MESSAGE) return;
    // 将 ArrayBuffer/Uint8Array 转换为 Buffer（Electron IPC 需要）
    const convertedArgs = args.map(arg => {
      if (arg instanceof ArrayBuffer) {
        return Buffer.from(arg);
      } else if (arg instanceof Uint8Array) {
        return Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength);
      }
      return arg;
    });
    ipcRenderer.send(channel, ...convertedArgs);
  },
  on(channel: string, listener: (...args: unknown[]) => void) {
    if (channel !== MESSAGE) return;
    const fn = (event: unknown, ...args: unknown[]) => {
      // 保持与 ipcRenderer.on 一致的签名：第一个参数是 event，后面是 payload
      // 这里直接把 event + args 透传给 listener，方便像 ipcRenderer 那样解构参数
      listener(event, ...args);
    };
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
};

contextBridge.exposeInMainWorld('ipcForVSCode', ipc);

// ─── 后台窗口任务 IPC ────────────────────────────────

const BG_TASK_REQUEST = 'background:task-request';
const BG_TASK_RESPONSE = 'background:task-response';

const backgroundIpc = {
  /** 监听主进程发来的任务请求 */
  onTaskRequest(listener: (requestId: string, taskName: string, args: unknown[]) => void) {
    const fn = (_event: Electron.IpcRendererEvent, requestId: string, taskName: string, args: unknown[]) => {
      listener(requestId, taskName, args);
    };
    ipcRenderer.on(BG_TASK_REQUEST, fn);
    return () => ipcRenderer.removeListener(BG_TASK_REQUEST, fn);
  },

  /** 向主进程回复任务执行结果 */
  sendTaskResponse(requestId: string, error: string | null, result: unknown) {
    ipcRenderer.send(BG_TASK_RESPONSE, requestId, error, result);
  },
};

contextBridge.exposeInMainWorld('backgroundIpc', backgroundIpc);
