/**
 * 截图编辑器主逻辑
 *
 * 功能：
 * - 显示所有显示器截图作为背景
 * - 支持区域选择
 * - 支持多种标注工具（矩形、圆形、箭头、线条、画笔、文字、马赛克、模糊）
 * - 放大镜辅助精确选择
 * - 快捷键支持
 */
import type { ImageData, ScreenshotResult, Area, Annotation } from '../../types/screenshot.js';

// 工具类型
type ToolType = 'select' | 'rectangle' | 'circle' | 'arrow' | 'line' | 'brush' | 'text' | 'mosaic' | 'blur';

// 编辑器状态
interface EditorState {
  tool: ToolType;
  color: string;
  lineWidth: number;
  isDrawing: boolean;
  startX: number;
  startY: number;
  annotations: Annotation[];
  currentAnnotation: Annotation | null;
  selectedArea: Area | null;
  scale: number;
}

// DOM 元素
const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
const drawCanvas = document.getElementById('draw-canvas') as HTMLCanvasElement;
const magnifier = document.getElementById('magnifier') as HTMLDivElement;
const magnifierCanvas = document.getElementById('magnifier-canvas') as HTMLCanvasElement;
const sizeTooltip = document.getElementById('size-tooltip') as HTMLDivElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;

const bgCtx = bgCanvas.getContext('2d')!;
const drawCtx = drawCanvas.getContext('2d')!;
const magnifierCtx = magnifierCanvas.getContext('2d')!;

// 状态
const state: EditorState = {
  tool: 'select',
  color: '#ff0000',
  lineWidth: 2,
  isDrawing: false,
  startX: 0,
  startY: 0,
  annotations: [],
  currentAnnotation: null,
  selectedArea: null,
  scale: 1,
};

// 背景图像
let backgroundImage: HTMLImageElement | null = null;
let displays: Array<{ x: number; y: number; width: number; height: number; scaleFactor: number }> = [];

// 初始化
async function init() {
  setupEventListeners();
  setupKeyboardShortcuts();

  console.log('[Screenshot Editor] Waiting for screenshot data...');

  // 等待截图数据
  if (window.screenshotEditor) {
    const unsubscribe = window.screenshotEditor.onScreenshotData((data) => {
      console.log('[Screenshot Editor] Received data:', data);
      loadScreenshot(data.imageData, data.displays, data.bounds);
      unsubscribe();
    });
  } else {
    console.error('[Screenshot Editor] screenshotEditor API not available!');
  }
}

// 虚拟桌面边界
let virtualBounds = { x: 0, y: 0, width: 0, height: 0 };

// 加载截图
function loadScreenshot(imageData: ImageData, displayList: typeof displays, bounds: { x: number; y: number; width: number; height: number }) {
  displays = displayList;
  virtualBounds = bounds;

  console.log('[Screenshot Editor] Virtual bounds:', virtualBounds);
  console.log('[Screenshot Editor] Displays:', displays);
  console.log('[Screenshot Editor] Image size:', imageData.width, 'x', imageData.height);
  console.log('[Screenshot Editor] Window size:', window.innerWidth, 'x', window.innerHeight);
  console.log('[Screenshot Editor] Screen size:', window.screen.width, 'x', window.screen.height);
  console.log('[Screenshot Editor] Screen avail:', window.screen.availWidth, 'x', window.screen.availHeight);

  const img = new Image();
  img.onload = () => {
    backgroundImage = img;

    // 使用图像的实际尺寸（截图尺寸）
    const targetWidth = imageData.width;
    const targetHeight = imageData.height;

    // 设置画布尺寸为图像尺寸
    bgCanvas.width = targetWidth;
    bgCanvas.height = targetHeight;
    drawCanvas.width = targetWidth;
    drawCanvas.height = targetHeight;

    // 设置画布 CSS 尺寸 - 使用 100% 填满容器
    bgCanvas.style.width = '100%';
    bgCanvas.style.height = '100%';
    drawCanvas.style.width = '100%';
    drawCanvas.style.height = '100%';

    console.log('[Screenshot Editor] Canvas pixel size:', targetWidth, 'x', targetHeight);
    console.log('[Screenshot Editor] Canvas CSS size:', bgCanvas.style.width, 'x', bgCanvas.style.height);

    // 绘制背景 - 保持原始尺寸
    bgCtx.drawImage(img, 0, 0);

    // 应用遮罩效果
    applyMask();
  };
  img.src = `data:image/png;base64,${imageData.data}`;
}

// 计算虚拟桌面边界
function calculateVirtualBounds() {
  if (displays.length === 0) {
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  }

  const minX = Math.min(...displays.map(d => d.x));
  const minY = Math.min(...displays.map(d => d.y));
  const maxX = Math.max(...displays.map(d => d.x + d.width));
  const maxY = Math.max(...displays.map(d => d.y + d.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// 应用遮罩效果（非选中区域变暗）
function applyMask() {
  // 初始状态没有遮罩
  // 遮罩会在选择区域时动态应用
}

// 设置事件监听
function setupEventListeners() {
  // 工具按钮
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool') as ToolType;
      setTool(tool);
    });
  });

  // 颜色选择
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color')!;
      setColor(color);
    });
  });

  // 线条粗细
  document.querySelectorAll('.width-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const width = parseInt(btn.getAttribute('data-width')!);
      setLineWidth(width);
    });
  });

  // 操作按钮
  document.getElementById('btn-cancel')?.addEventListener('click', cancelScreenshot);
  document.getElementById('btn-save')?.addEventListener('click', saveScreenshot);

  // 画布鼠标事件
  canvasContainer.addEventListener('mousedown', handleMouseDown);
  canvasContainer.addEventListener('mousemove', handleMouseMove);
  canvasContainer.addEventListener('mouseup', handleMouseUp);
  canvasContainer.addEventListener('dblclick', handleDoubleClick);
}

// 设置键盘快捷键
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'v': setTool('select'); break;
      case 'r': setTool('rectangle'); break;
      case 'c': setTool('circle'); break;
      case 'a': setTool('arrow'); break;
      case 'l': setTool('line'); break;
      case 'b': setTool('brush'); break;
      case 't': setTool('text'); break;
      case 'm': setTool('mosaic'); break;
      case 'u': setTool('blur'); break;
      case 'escape': cancelScreenshot(); break;
      case 'enter': saveScreenshot(); break;
    }
  });
}

// 设置工具
function setTool(tool: ToolType) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tool') === tool);
  });

  // 更新鼠标样式
  canvasContainer.style.cursor = tool === 'select' ? 'crosshair' : 'default';
}

// 设置颜色
function setColor(color: string) {
  state.color = color;
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-color') === color);
  });
}

// 设置线条粗细
function setLineWidth(width: number) {
  state.lineWidth = width;
  document.querySelectorAll('.width-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.getAttribute('data-width')!) === width);
  });
}

// 获取鼠标在画布上的坐标
function getCanvasCoordinates(e: MouseEvent): { x: number; y: number } {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

// 鼠标按下
function handleMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;

  const { x, y } = getCanvasCoordinates(e);
  state.isDrawing = true;
  state.startX = x;
  state.startY = y;

  // 创建新标注
  if (state.tool !== 'select') {
    state.currentAnnotation = {
      id: generateId(),
      type: state.tool,
      color: state.color,
      lineWidth: state.lineWidth,
      points: [{ x, y }],
    };
  }
}

// 鼠标移动
function handleMouseMove(e: MouseEvent) {
  const { x, y } = getCanvasCoordinates(e);

  // 更新放大镜
  updateMagnifier(e.clientX, e.clientY);

  if (!state.isDrawing) return;

  if (state.tool === 'select') {
    // 绘制选择框
    drawSelectionBox(state.startX, state.startY, x, y);
    updateSizeTooltip(e.clientX, e.clientY, x - state.startX, y - state.startY);
  } else if (state.currentAnnotation) {
    // 更新当前标注
    if (state.tool === 'brush') {
      state.currentAnnotation.points.push({ x, y });
    } else {
      state.currentAnnotation.points = [
        { x: state.startX, y: state.startY },
        { x, y },
      ];
    }
    redrawCanvas();
  }
}

// 鼠标释放
function handleMouseUp(e: MouseEvent) {
  if (!state.isDrawing) return;

  const { x, y } = getCanvasCoordinates(e);
  state.isDrawing = false;

  if (state.tool === 'select') {
    // 保存选中区域
    const width = Math.abs(x - state.startX);
    const height = Math.abs(y - state.startY);

    if (width > 10 && height > 10) {
      state.selectedArea = {
        x: Math.min(state.startX, x),
        y: Math.min(state.startY, y),
        width,
        height,
      };
      drawSelectionBox(state.selectedArea.x, state.selectedArea.y,
        state.selectedArea.x + state.selectedArea.width,
        state.selectedArea.y + state.selectedArea.height);
    }
  } else if (state.currentAnnotation) {
    // 保存标注
    state.annotations.push(state.currentAnnotation);
    state.currentAnnotation = null;
  }

  hideSizeTooltip();
}

// 双击（文字输入）
function handleDoubleClick(e: MouseEvent) {
  if (state.tool !== 'text') return;

  const { x, y } = getCanvasCoordinates(e);
  const text = prompt('输入文字:');

  if (text) {
    const annotation: Annotation = {
      id: generateId(),
      type: 'text',
      color: state.color,
      lineWidth: state.lineWidth,
      points: [{ x, y }],
      text,
      fontSize: state.lineWidth * 8 + 12,
    };
    state.annotations.push(annotation);
    redrawCanvas();
  }
}

// 绘制选择框
function drawSelectionBox(x1: number, y1: number, x2: number, y2: number) {
  redrawCanvas();

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  // 绘制遮罩
  drawCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);

  // 清除选中区域
  drawCtx.clearRect(x, y, width, height);

  // 绘制边框
  drawCtx.strokeStyle = '#0d6efd';
  drawCtx.lineWidth = 2;
  drawCtx.strokeRect(x, y, width, height);

  // 绘制尺寸标签
  drawCtx.fillStyle = '#0d6efd';
  drawCtx.fillRect(x + width / 2 - 30, y - 25, 60, 20);
  drawCtx.fillStyle = '#fff';
  drawCtx.font = '12px sans-serif';
  drawCtx.textAlign = 'center';
  drawCtx.fillText(`${width} x ${height}`, x + width / 2, y - 10);
}

// 重绘画布
function redrawCanvas() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  // 绘制所有标注
  for (const annotation of state.annotations) {
    drawAnnotation(annotation);
  }

  // 绘制当前标注
  if (state.currentAnnotation) {
    drawAnnotation(state.currentAnnotation);
  }
}

// 绘制单个标注
function drawAnnotation(annotation: Annotation) {
  drawCtx.strokeStyle = annotation.color;
  drawCtx.fillStyle = annotation.color;
  drawCtx.lineWidth = annotation.lineWidth;

  const points = annotation.points;

  switch (annotation.type) {
    case 'rectangle':
      if (points.length >= 2) {
        const x = Math.min(points[0].x, points[1].x);
        const y = Math.min(points[0].y, points[1].y);
        const width = Math.abs(points[1].x - points[0].x);
        const height = Math.abs(points[1].y - points[0].y);
        drawCtx.strokeRect(x, y, width, height);
      }
      break;

    case 'circle':
      if (points.length >= 2) {
        const radius = Math.sqrt(
          Math.pow(points[1].x - points[0].x, 2) +
          Math.pow(points[1].y - points[0].y, 2)
        );
        drawCtx.beginPath();
        drawCtx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
        drawCtx.stroke();
      }
      break;

    case 'arrow':
      if (points.length >= 2) {
        drawArrow(points[0].x, points[0].y, points[1].x, points[1].y);
      }
      break;

    case 'line':
      if (points.length >= 2) {
        drawCtx.beginPath();
        drawCtx.moveTo(points[0].x, points[0].y);
        drawCtx.lineTo(points[1].x, points[1].y);
        drawCtx.stroke();
      }
      break;

    case 'brush':
      if (points.length > 1) {
        drawCtx.beginPath();
        drawCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          drawCtx.lineTo(points[i].x, points[i].y);
        }
        drawCtx.stroke();
      }
      break;

    case 'text':
      if (annotation.text && points.length > 0) {
        drawCtx.font = `${annotation.fontSize || 16}px sans-serif`;
        drawCtx.fillText(annotation.text, points[0].x, points[0].y);
      }
      break;

    case 'mosaic':
      if (points.length >= 2 && backgroundImage) {
        applyMosaic(points[0].x, points[0].y, points[1].x, points[1].y);
      }
      break;

    case 'blur':
      if (points.length >= 2 && backgroundImage) {
        applyBlur(points[0].x, points[0].y, points[1].x, points[1].y);
      }
      break;
  }
}

// 绘制箭头
function drawArrow(x1: number, y1: number, x2: number, y2: number) {
  const headLength = 15;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  drawCtx.beginPath();
  drawCtx.moveTo(x1, y1);
  drawCtx.lineTo(x2, y2);
  drawCtx.stroke();

  drawCtx.beginPath();
  drawCtx.moveTo(x2, y2);
  drawCtx.lineTo(
    x2 - headLength * Math.cos(angle - Math.PI / 6),
    y2 - headLength * Math.sin(angle - Math.PI / 6)
  );
  drawCtx.lineTo(
    x2 - headLength * Math.cos(angle + Math.PI / 6),
    y2 - headLength * Math.sin(angle + Math.PI / 6)
  );
  drawCtx.closePath();
  drawCtx.fill();
}

// 应用马赛克
function applyMosaic(x1: number, y1: number, x2: number, y2: number) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const blockSize = 10;

  for (let py = y; py < y + height; py += blockSize) {
    for (let px = x; px < x + width; px += blockSize) {
      const imageData = bgCtx.getImageData(px, py, 1, 1);
      const [r, g, b] = imageData.data;
      drawCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      drawCtx.fillRect(px, py, blockSize, blockSize);
    }
  }
}

// 应用模糊
function applyBlur(x1: number, y1: number, x2: number, y2: number) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  drawCtx.filter = 'blur(5px)';
  drawCtx.drawImage(bgCanvas, x, y, width, height, x, y, width, height);
  drawCtx.filter = 'none';
}

// 更新放大镜
function updateMagnifier(clientX: number, clientY: number) {
  if (!backgroundImage) return;

  const rect = bgCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // 显示放大镜
  magnifier.style.display = 'block';
  magnifier.style.left = `${clientX + 20}px`;
  magnifier.style.top = `${clientY + 20}px`;

  // 绘制放大区域
  const zoomLevel = 3;
  const size = 40;

  magnifierCanvas.width = 120;
  magnifierCanvas.height = 120;

  magnifierCtx.fillStyle = '#000';
  magnifierCtx.fillRect(0, 0, 120, 120);

  magnifierCtx.drawImage(
    bgCanvas,
    x - size / 2, y - size / 2, size, size,
    0, 0, 120, 120
  );
}

// 更新尺寸提示
function updateSizeTooltip(clientX: number, clientY: number, width: number, height: number) {
  sizeTooltip.style.display = 'block';
  sizeTooltip.style.left = `${clientX + 15}px`;
  sizeTooltip.style.top = `${clientY - 30}px`;
  sizeTooltip.textContent = `${Math.abs(width)} x ${Math.abs(height)}`;
}

// 隐藏尺寸提示
function hideSizeTooltip() {
  sizeTooltip.style.display = 'none';
}

// 生成唯一ID
function generateId(): string {
  return `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 取消截图
function cancelScreenshot() {
  if (window.screenshotEditor) {
    window.screenshotEditor.cancel();
  }
}

// 保存截图
async function saveScreenshot() {
  if (!backgroundImage) return;

  // 创建最终图像
  const finalCanvas = document.createElement('canvas');
  const ctx = finalCanvas.getContext('2d')!;

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = bgCanvas.width;
  let sourceHeight = bgCanvas.height;

  // 如果有选中区域，只保存选中区域
  if (state.selectedArea) {
    sourceX = state.selectedArea.x;
    sourceY = state.selectedArea.y;
    sourceWidth = state.selectedArea.width;
    sourceHeight = state.selectedArea.height;
  }

  finalCanvas.width = sourceWidth;
  finalCanvas.height = sourceHeight;

  // 绘制背景
  ctx.drawImage(
    bgCanvas,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight
  );

  // 绘制标注
  ctx.drawImage(
    drawCanvas,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight
  );

  // 转换为base64
  const dataUrl = finalCanvas.toDataURL('image/png');
  const base64Data = dataUrl.split(',')[1];

  const result: ScreenshotResult = {
    imageData: {
      data: base64Data,
      width: sourceWidth,
      height: sourceHeight,
    },
    selectedArea: state.selectedArea || undefined,
    annotations: state.annotations,
  };

  if (window.screenshotEditor) {
    window.screenshotEditor.complete(result);
  }
}

// 启动
init();
