/**
 * Screenshot IPC Channel
 *
 * 提供截图相关的IPC功能：
 * - 获取显示器信息
 * - 捕获屏幕/区域
 * - 保存截图
 * - 复制到剪贴板
 */
import { clipboard, nativeImage, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { IPCServer } from '../../ipc/common/ipc.js';
import type { IServerChannel } from '../../ipc/common/types.js';
import type { CancellationToken } from '../../ipc/common/types.js';
import type { DisplayInfo, Area, ImageData } from '../../types/screenshot.js';

// 动态导入原生模块
let nativeModule: typeof import('../../../native/index.js') | null = null;

function getNativeModule(): typeof import('../../../native/index.js') {
  if (!nativeModule) {
    try {
      // 根据平台加载对应的原生模块
      const platform = process.platform;
      const arch = process.arch;

      let binaryName: string;
      if (platform === 'win32') {
        binaryName = `screenshot-native.win32-${arch}-msvc.node`;
      } else if (platform === 'darwin') {
        binaryName = `screenshot-native.darwin-${arch}.node`;
      } else {
        binaryName = `screenshot-native.linux-${arch}-gnu.node`;
      }

      // 在开发环境中直接从native目录加载
      // 在生产环境中从extraResources加载
      const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_VITE_DEV_URL;

      let modulePath: string;
      if (isDev) {
        // 开发环境：从项目根目录的native文件夹加载
        const projectRoot = path.join(__dirname, '../../../..');
        modulePath = path.join(projectRoot, 'native', binaryName);
      } else {
        // 生产环境：从app.asar.unpacked或resources加载
        const resourcesPath = process.resourcesPath;
        modulePath = path.join(resourcesPath, 'native', binaryName);
      }

      // 检查文件是否存在
      if (!fs.existsSync(modulePath)) {
        // 尝试备用路径
        const altPaths = [
          path.join(__dirname, '..', '..', '..', 'native', binaryName),
          path.join(__dirname, '..', '..', 'native', binaryName),
          path.join(app.getAppPath(), 'native', binaryName),
        ];

        for (const altPath of altPaths) {
          if (fs.existsSync(altPath)) {
            modulePath = altPath;
            break;
          }
        }
      }

      console.log('[ScreenshotChannel] Loading native module from:', modulePath);
      nativeModule = require(modulePath);
    } catch (error) {
      console.error('[ScreenshotChannel] Failed to load native module:', error);
      throw new Error(`Failed to load screenshot native module: ${error}`);
    }
  }
  return nativeModule;
}

export class ScreenshotChannel implements IServerChannel<string> {
  async call<T>(
    ctx: string,
    command: string,
    arg?: unknown,
    _cancellationToken?: CancellationToken
  ): Promise<T> {
    const native = getNativeModule();

    switch (command) {
      case 'getDisplays': {
        const displays = native.getDisplays();
        return displays.map(d => ({
          id: d.id,
          name: d.name,
          x: d.x,
          y: d.y,
          width: d.width,
          height: d.height,
          scaleFactor: d.scaleFactor,
          isPrimary: d.isPrimary,
        })) as T;
      }

      case 'captureDisplay': {
        const displayId = arg as string;
        const result = native.captureDisplay(displayId);
        if (!result) {
          throw new Error(`Display not found: ${displayId}`);
        }
        return {
          data: Buffer.from(result.data).toString('base64'),
          width: result.width,
          height: result.height,
        } as T;
      }

      case 'captureArea': {
        const area = arg as Area;
        const result = native.captureArea({
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
        });
        return {
          data: Buffer.from(result.data).toString('base64'),
          width: result.width,
          height: result.height,
        } as T;
      }

      case 'captureAllDisplays': {
        const result = native.captureAllDisplays();
        return {
          data: Buffer.from(result.data).toString('base64'),
          width: result.width,
          height: result.height,
        } as T;
      }

      case 'saveToFile': {
        const { data, path } = arg as { data: string; path: string };
        const buffer = Buffer.from(data, 'base64');
        native.saveToFile(buffer, path);
        return undefined as T;
      }

      case 'copyToClipboard': {
        const data = arg as string;
        const buffer = Buffer.from(data, 'base64');
        const image = nativeImage.createFromBuffer(buffer);
        clipboard.writeImage(image);
        return undefined as T;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  listen<T>(_ctx: string, _event: string, _arg?: unknown): import('../../ipc/common/types.js').IEvent<T> {
    throw new Error('Events not supported in ScreenshotChannel');
  }
}

export function createScreenshotChannel(): ScreenshotChannel {
  return new ScreenshotChannel();
}
