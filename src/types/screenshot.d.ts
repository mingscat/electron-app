/**
 * 截图功能类型定义
 */

/** 显示器信息 */
export interface DisplayInfo {
  /** 显示器唯一ID */
  id: string;
  /** 显示器名称 */
  name: string;
  /** 显示器左上角X坐标 */
  x: number;
  /** 显示器左上角Y坐标 */
  y: number;
  /** 显示器宽度 */
  width: number;
  /** 显示器高度 */
  height: number;
  /** 缩放因子 (DPI缩放) */
  scaleFactor: number;
  /** 是否为主显示器 */
  isPrimary: boolean;
}

/** 图像数据 */
export interface ImageData {
  /** PNG编码的图像数据 (Base64) */
  data: string;
  /** 图像宽度 */
  width: number;
  /** 图像高度 */
  height: number;
}

/** 区域参数 */
export interface Area {
  /** 左上角X坐标 */
  x: number;
  /** 左上角Y坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/** 标注类型 */
export type AnnotationType =
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'line'
  | 'brush'
  | 'text'
  | 'mosaic'
  | 'blur';

/** 标注数据 */
export interface Annotation {
  /** 唯一ID */
  id: string;
  /** 标注类型 */
  type: AnnotationType;
  /** 颜色 (hex格式) */
  color: string;
  /** 线条粗细 */
  lineWidth: number;
  /** 坐标点 */
  points: Array<{ x: number; y: number }>;
  /** 文本内容 (仅text类型) */
  text?: string;
  /** 字体大小 (仅text类型) */
  fontSize?: number;
}

/** 截图结果 */
export interface ScreenshotResult {
  /** 图像数据 */
  imageData: ImageData;
  /** 选中的区域 */
  selectedArea?: Area;
  /** 标注列表 */
  annotations: Annotation[];
}

/** 截图配置 */
export interface ScreenshotConfig {
  /** 快捷键 */
  shortcut?: string;
  /** 默认保存路径 */
  defaultSavePath?: string;
  /** 截图后自动复制到剪贴板 */
  autoCopyToClipboard?: boolean;
  /** 截图后自动保存 */
  autoSave?: boolean;
}

/** Screenshot Channel 命令 */
export interface ScreenshotChannelCommands {
  /** 获取所有显示器信息 */
  getDisplays(): Promise<DisplayInfo[]>;
  /** 截图指定显示器 */
  captureDisplay(displayId: string): Promise<ImageData>;
  /** 截图指定区域 */
  captureArea(area: Area): Promise<ImageData>;
  /** 截图所有显示器 */
  captureAllDisplays(): Promise<ImageData>;
  /** 保存截图到文件 */
  saveToFile(data: string, path: string): Promise<void>;
  /** 复制图像到剪贴板 */
  copyToClipboard(data: string): Promise<void>;
  /** 打开截图编辑器 */
  openEditor(imageData: ImageData): Promise<ScreenshotResult | null>;
  /** 关闭截图编辑器 */
  closeEditor(): Promise<void>;
}

/** Screenshot Channel 事件 */
export interface ScreenshotChannelEvents {
  /** 截图完成事件 */
  onScreenshotComplete(callback: (result: ScreenshotResult) => void): () => void;
  /** 截图取消事件 */
  onScreenshotCancel(callback: () => void): () => void;
}

declare global {
  interface Window {
    screenshot: ScreenshotChannelCommands & ScreenshotChannelEvents;
  }
}
