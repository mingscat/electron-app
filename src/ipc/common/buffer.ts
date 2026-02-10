/**
 * 最小化 VSBuffer，与 Electron IPC 传递的 Buffer 兼容
 */
export class VSBuffer {
  constructor(public readonly buffer: Uint8Array) {}

  static alloc(byteLength: number): VSBuffer {
    return new VSBuffer(new Uint8Array(byteLength));
  }

  static wrap(actual: Uint8Array | Buffer | { buffer: ArrayBuffer; byteOffset: number; byteLength: number } | ArrayBuffer): VSBuffer {
    // 处理 Uint8Array
    if (actual instanceof Uint8Array) {
      return new VSBuffer(actual);
    }
    // 处理 ArrayBuffer
    if (actual instanceof ArrayBuffer) {
      return new VSBuffer(new Uint8Array(actual));
    }
    // 检查是否是 Node.js Buffer 或类似结构（有 buffer、byteOffset、byteLength 属性）
    // 在渲染进程中，Buffer 不可用，但主进程发送的 Buffer 会有这些属性
    if (actual && typeof actual === 'object' && 'buffer' in actual && 'byteOffset' in actual && 'byteLength' in actual) {
      const buf = actual as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
      if (buf.buffer instanceof ArrayBuffer) {
        return new VSBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      }
    }
    // 默认尝试转换为 Uint8Array
    return new VSBuffer(new Uint8Array(actual as ArrayBuffer));
  }

  static fromString(source: string): VSBuffer {
    return new VSBuffer(new TextEncoder().encode(source));
  }

  get byteLength(): number {
    return this.buffer.byteLength;
  }

  slice(start?: number, end?: number): VSBuffer {
    return new VSBuffer(this.buffer.slice(start, end));
  }

  static concat(buffers: VSBuffer[]): VSBuffer {
    const total = buffers.reduce((s, b) => s + b.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const b of buffers) {
      out.set(b.buffer, offset);
      offset += b.byteLength;
    }
    return new VSBuffer(out);
  }

  writeUInt8(value: number, offset: number): void {
    this.buffer[offset] = value & 0xff;
  }

  static isNativeBuffer(obj: unknown): obj is ArrayBuffer | Uint8Array {
    return obj instanceof ArrayBuffer || obj instanceof Uint8Array;
  }
}
