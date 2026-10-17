/**
 * WebRTC DataChannel 点对点分布式书签共识流 (P2P Mesh Sync Protocol)
 *
 * 核心设计目标：
 * 基于本地 CRDT 状态向量引擎，构建去中心化 P2P 网格共识通道。
 * 支持局域网/互联网多设备无中心直连，在离线重连、网络分区下
 * 自动交换 Delta 增量并在数学上确定性收敛。
 */
import {
  CrdtStore,
  type CrdtOperation,
  type VectorClock,
  compareVectorClocks,
} from "./crdt-sync.ts";

export type P2PMessageType =
  | "HELLO"
  | "SYNC_REQUEST"
  | "DELTA_BATCH"
  | "ACK"
  | "HEARTBEAT";

export interface P2PMessage<T = unknown> {
  type: P2PMessageType;
  senderId: string;
  targetId?: string;
  seq: number;
  timestamp: number;
  payload: T;
}

export interface HelloPayload {
  clock: VectorClock;
  siteCount: number;
}

export interface SyncRequestPayload {
  sinceClock: VectorClock;
}

export interface DeltaBatchPayload {
  operations: CrdtOperation[];
  finalClock: VectorClock;
}

export interface AckPayload {
  receivedClock: VectorClock;
  appliedCount: number;
}

export type PeerState = "IDLE" | "HANDSHAKE" | "SYNCING" | "READY" | "DISCONNECTED";

export interface PeerInfo {
  peerId: string;
  state: PeerState;
  remoteClock: VectorClock;
  lastSeenAt: number;
}

export class P2PMeshNode {
  readonly nodeId: string;
  readonly store: CrdtStore;
  private peers = new Map<string, PeerInfo>();
  private messageSeq = 0;
  private pendingOutgoingQueue = new Map<string, P2PMessage[]>();

  constructor(nodeId: string, initialStore?: CrdtStore) {
    this.nodeId = nodeId;
    this.store = initialStore || new CrdtStore(nodeId);
  }

  /**
   * 注册对端节点
   */
  connectPeer(peerId: string): P2PMessage<HelloPayload> {
    const peer: PeerInfo = {
      peerId,
      state: "HANDSHAKE",
      remoteClock: {},
      lastSeenAt: Date.now(),
    };
    this.peers.set(peerId, peer);

    // 发送初始握手报文
    return this.createMessage<HelloPayload>("HELLO", {
      clock: this.store.getVectorClock(),
      siteCount: this.store.getActiveSites().length,
    }, peerId);
  }

  /**
   * 标记对端断开
   */
  disconnectPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.state = "DISCONNECTED";
    }
  }

  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  listPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * 生成规范协议报文
   */
  private createMessage<T>(
    type: P2PMessageType,
    payload: T,
    targetId?: string
  ): P2PMessage<T> {
    this.messageSeq++;
    return {
      type,
      senderId: this.nodeId,
      targetId,
      seq: this.messageSeq,
      timestamp: Date.now(),
      payload,
    };
  }

  /**
   * 核心报文接收与状态机处理流
   */
  handleIncomingMessage(msg: P2PMessage): P2PMessage | null {
    const peer = this.peers.get(msg.senderId);
    if (!peer) {
      // 隐式自动接纳对端
      this.peers.set(msg.senderId, {
        peerId: msg.senderId,
        state: "HANDSHAKE",
        remoteClock: {},
        lastSeenAt: Date.now(),
      });
    }

    const currentPeer = this.peers.get(msg.senderId)!;
    currentPeer.lastSeenAt = Date.now();

    switch (msg.type) {
      case "HELLO": {
        const payload = msg.payload as HelloPayload;
        currentPeer.remoteClock = payload.clock;
        currentPeer.state = "SYNCING";

        // 比对双方时钟关系
        const relation = compareVectorClocks(this.store.getVectorClock(), payload.clock);

        if (relation === "EQUAL") {
          currentPeer.state = "READY";
          return this.createMessage<AckPayload>("ACK", {
            receivedClock: this.store.getVectorClock(),
            appliedCount: 0,
          }, msg.senderId);
        }

        // 需要同步：请求或推送差量
        const myOps = this.store.getDeltaSince(payload.clock);
        if (myOps.length > 0) {
          return this.createMessage<DeltaBatchPayload>("DELTA_BATCH", {
            operations: myOps,
            finalClock: this.store.getVectorClock(),
          }, msg.senderId);
        } else {
          return this.createMessage<SyncRequestPayload>("SYNC_REQUEST", {
            sinceClock: this.store.getVectorClock(),
          }, msg.senderId);
        }
      }

      case "SYNC_REQUEST": {
        const payload = msg.payload as SyncRequestPayload;
        const diffOps = this.store.getDeltaSince(payload.sinceClock);
        return this.createMessage<DeltaBatchPayload>("DELTA_BATCH", {
          operations: diffOps,
          finalClock: this.store.getVectorClock(),
        }, msg.senderId);
      }

      case "DELTA_BATCH": {
        const payload = msg.payload as DeltaBatchPayload;
        const applied = this.store.applyRemoteBatch(payload.operations);
        currentPeer.remoteClock = payload.finalClock;
        currentPeer.state = "READY";

        // 若应用完后我方有其缺少的新增变更，顺道回传
        const myExtra = this.store.getDeltaSince(payload.finalClock);
        if (myExtra.length > 0) {
          return this.createMessage<DeltaBatchPayload>("DELTA_BATCH", {
            operations: myExtra,
            finalClock: this.store.getVectorClock(),
          }, msg.senderId);
        }

        return this.createMessage<AckPayload>("ACK", {
          receivedClock: this.store.getVectorClock(),
          appliedCount: applied,
        }, msg.senderId);
      }

      case "ACK": {
        const payload = msg.payload as AckPayload;
        currentPeer.remoteClock = payload.receivedClock;
        currentPeer.state = "READY";
        return null;
      }

      case "HEARTBEAT": {
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * 本地发生修改时，广播给所有已就绪连接的 Peers
   */
  broadcastLocalUpdate(): Array<P2PMessage<DeltaBatchPayload>> {
    const messages: Array<P2PMessage<DeltaBatchPayload>> = [];
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.state !== "READY" && peer.state !== "SYNCING") continue;
      const deltas = this.store.getDeltaSince(peer.remoteClock);
      if (deltas.length > 0) {
        messages.push(
          this.createMessage<DeltaBatchPayload>("DELTA_BATCH", {
            operations: deltas,
            finalClock: this.store.getVectorClock(),
          }, peerId)
        );
      }
    }
    return messages;
  }
}

export interface P2PTransport {
  send(message: P2PMessage): void | Promise<void>;
  onMessage(handler: (message: P2PMessage) => void): void;
  close(): void;
}

/**
 * P2P 会话管理器，连接底层 Transport（如 WebRTC DataChannel、BroadcastChannel 或 WebSocket）
 * 并驱动 P2PMeshNode 状态机自动响应
 */
export class P2PSyncSession {
  readonly node: P2PMeshNode;
  readonly peerId: string;
  readonly transport: P2PTransport;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(node: P2PMeshNode, peerId: string, transport: P2PTransport) {
    this.node = node;
    this.peerId = peerId;
    this.transport = transport;

    this.transport.onMessage((msg) => {
      const reply = this.node.handleIncomingMessage(msg);
      if (reply) {
        void this.transport.send(reply);
      }
    });

    this.heartbeatTimer = setInterval(() => {
      void this.transport.send({
        type: "HEARTBEAT",
        senderId: this.node.nodeId,
        targetId: this.peerId,
        seq: Date.now(),
        timestamp: Date.now(),
        payload: null,
      });
    }, 15_000);
    if (typeof this.heartbeatTimer?.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  startHandshake(): void {
    const hello = this.node.connectPeer(this.peerId);
    void this.transport.send(hello);
  }

  broadcastLocal(): void {
    const msgs = this.node.broadcastLocalUpdate();
    for (const msg of msgs) {
      if (!msg.targetId || msg.targetId === this.peerId) {
        void this.transport.send(msg);
      }
    }
  }

  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.node.disconnectPeer(this.peerId);
    this.transport.close();
  }
}

/**
 * 浏览器多 Tab / 多窗口本地无后台漫游 Transport（基于 BroadcastChannel）
 */
export function createBroadcastChannelTransport(channelName = "navhub-crdt-mesh"): P2PTransport | null {
  if (typeof globalThis.BroadcastChannel === "undefined") return null;
  const channel = new globalThis.BroadcastChannel(channelName);
  let listener: ((msg: P2PMessage) => void) | null = null;

  channel.onmessage = (event) => {
    if (listener && event.data) {
      listener(event.data as P2PMessage);
    }
  };

  return {
    send(msg: P2PMessage) {
      channel.postMessage(msg);
    },
    onMessage(handler: (msg: P2PMessage) => void) {
      listener = handler;
    },
    close() {
      channel.close();
    },
  };
}
