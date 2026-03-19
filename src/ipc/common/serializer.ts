/**
 * vscode IPC 序列化/反序列化（VQL + 类型标签）
 */
import { VSBuffer } from './buffer.js';

export interface IReader {
  read(bytes: number): VSBuffer;
}

export interface IWriter {
  write(buffer: VSBuffer): void;
}

function readIntVQL(reader: IReader): number {
  let value = 0;
  for (let n = 0; ; n += 7) {
    const next = reader.read(1);
    value |= (next.buffer[0]! & 0b01111111) << n;
    if (!(next.buffer[0]! & 0b10000000)) return value;
  }
}

function writeInt32VQL(writer: IWriter, value: number): void {
  if (value === 0) {
    const z = VSBuffer.alloc(1);
    z.writeUInt8(0, 0);
    writer.write(z);
    return;
  }
  const parts: number[] = [];
  let v = value;
  while (v !== 0) {
    parts.push(v & 0b01111111);
    v = v >>> 7;
  }
  const scratch = VSBuffer.alloc(parts.length);
  for (let i = 0; i < parts.length; i++) {
    scratch.writeUInt8(i < parts.length - 1 ? parts[i]! | 0b10000000 : parts[i]!, i);
  }
  writer.write(scratch);
}

export class BufferReader implements IReader {
  private pos = 0;
  constructor(private buf: VSBuffer) {}
  read(bytes: number): VSBuffer {
    const result = this.buf.slice(this.pos, this.pos + bytes);
    this.pos += result.byteLength;
    return result;
  }
}

export class BufferWriter implements IWriter {
  private buffers: VSBuffer[] = [];
  get buffer(): VSBuffer {
    if (this.buffers.length === 0) {
      return VSBuffer.alloc(0);
    }
    return VSBuffer.concat(this.buffers);
  }
  write(buffer: VSBuffer): void {
    this.buffers.push(buffer);
  }
}

const enum DataType {
  Undefined = 0,
  String = 1,
  Buffer = 2,
  VSBuffer = 3,
  Array = 4,
  Object = 5,
  Int = 6,
}

function createOneByteBuffer(value: number): VSBuffer {
  const r = VSBuffer.alloc(1);
  r.writeUInt8(value, 0);
  return r;
}

const Presets = {
  Undefined: createOneByteBuffer(DataType.Undefined),
  String: createOneByteBuffer(DataType.String),
  Buffer: createOneByteBuffer(DataType.Buffer),
  VSBuffer: createOneByteBuffer(DataType.VSBuffer),
  Array: createOneByteBuffer(DataType.Array),
  Object: createOneByteBuffer(DataType.Object),
  Uint: createOneByteBuffer(DataType.Int),
};

export function serialize(writer: IWriter, data: unknown): void {
  if (data === undefined) {
    writer.write(Presets.Undefined);
  } else if (typeof data === 'string') {
    const b = VSBuffer.fromString(data);
    writer.write(Presets.String);
    writeInt32VQL(writer, b.byteLength);
    writer.write(b);
  } else if (VSBuffer.isNativeBuffer(data) || (data && (data as any).buffer instanceof ArrayBuffer)) {
    const b = data instanceof Uint8Array ? VSBuffer.wrap(data) : VSBuffer.wrap(new Uint8Array(data as ArrayBuffer));
    writer.write(Presets.Buffer);
    writeInt32VQL(writer, b.byteLength);
    writer.write(b);
  } else if (data instanceof VSBuffer) {
    writer.write(Presets.VSBuffer);
    writeInt32VQL(writer, data.byteLength);
    writer.write(data);
  } else if (Array.isArray(data)) {
    writer.write(Presets.Array);
    writeInt32VQL(writer, data.length);
    for (const el of data) serialize(writer, el);
  } else if (typeof data === 'number' && (data | 0) === data) {
    writer.write(Presets.Uint);
    writeInt32VQL(writer, data);
  } else {
    const b = VSBuffer.fromString(JSON.stringify(data));
    writer.write(Presets.Object);
    writeInt32VQL(writer, b.byteLength);
    writer.write(b);
  }
}

export function deserialize(reader: IReader): unknown {
  const type = reader.read(1).buffer[0]!;
  switch (type) {
    case DataType.Undefined:
      return undefined;
    case DataType.String:
      return new TextDecoder().decode(reader.read(readIntVQL(reader)).buffer);
    case DataType.Buffer:
      return reader.read(readIntVQL(reader)).buffer;
    case DataType.VSBuffer:
      return reader.read(readIntVQL(reader));
    case DataType.Array: {
      const len = readIntVQL(reader);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(deserialize(reader));
      return arr;
    }
    case DataType.Object:
      return JSON.parse(new TextDecoder().decode(reader.read(readIntVQL(reader)).buffer));
    case DataType.Int:
      return readIntVQL(reader);
    default:
      return undefined;
  }
}
