/**
 * IPCServer（主进程）：监听客户端连接，为每个连接注册 channel。
 * IPCClient（渲染进程）：发送 context 后通过 getChannel 调用主进程 channel。
 */
import type { IChannel, IServerChannel, IDisposable } from './types.js';
import type { ClientConnectionEvent, IMessagePassingProtocol } from './types.js';
import { VSBuffer } from './buffer.js';
import { BufferReader, BufferWriter, deserialize, serialize } from './serializer.js';
import { ChannelServer, ChannelClient } from './channel.js';

export class IPCServer<TContext = string> implements IDisposable {
  private channels = new Map<string, IServerChannel<TContext>>();

  constructor(onDidClientConnect: (listener: (e: ClientConnectionEvent) => void) => IDisposable) {
    onDidClientConnect(({ protocol, onDidClientDisconnect }) => {
      let fired = false;
      const d = protocol.onMessage(msg => {
        if (fired) return;
        fired = true;
        d.dispose();
        const reader = new BufferReader(VSBuffer.wrap(msg));
        const ctx = deserialize(reader) as TContext;
        const channelServer = new ChannelServer(protocol, ctx);
        this.channels.forEach((ch, name) => channelServer.registerChannel(name, ch));
        onDidClientDisconnect(() => channelServer.dispose());
      });
    });
  }

  registerChannel(channelName: string, channel: IServerChannel<TContext>): void {
    this.channels.set(channelName, channel);
  }

  dispose(): void {}
}

export class IPCClient<TContext = string> implements IDisposable {
  private channelClient: ChannelClient;

  constructor(protocol: IMessagePassingProtocol, ctx: TContext) {
    const writer = new BufferWriter();
    serialize(writer, ctx);
    const buf = writer.buffer;
    if (!buf || !buf.buffer) {
      throw new Error('Failed to serialize context');
    }
    protocol.send(buf.buffer);
    this.channelClient = new ChannelClient(protocol);
  }

  getChannel<T extends IChannel>(channelName: string): T {
    return this.channelClient.getChannel<T>(channelName);
  }

  dispose(): void {
    this.channelClient.dispose();
  }
}
