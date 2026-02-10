// 类型定义已移至 src/types/preload.d.ts
// 此文件保留用于向后兼容
export * from '../types/preload';

import type { IPreloadIPC } from '../types/preload';
declare global {
  interface Window {
    ipcForVSCode?: IPreloadIPC;
  }
}

export {};
