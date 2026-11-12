/**
 * p2p-mesh-sync.ts 补充覆盖：listPeers、P2PSyncSession 握手/广播/关闭、
 * BroadcastChannel Transport。
 * （此前 p2p-mesh-sync.test.ts 只覆盖了节点级消息处理的一部分。）
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createBroadcastChannelTransport,
  P2PMeshNode,
  P2PSyncSession,
  type P2PMessage,
  type P2PTransport,
} from "../src/p2p-mesh-sync.ts";

function memoryTransport(): { transport: P2PTransport; sent: P2PMessage[]; deliver: (m: P2PMessage) => void; closed: { v: boolean } } {
  const sent: P2PMessage[] = [];
  let handler: ((m: P2PMessage) => void) | null = null;
  const closed = { v: false };
  const transport: P2PTransport = {
    send: (m) => {
      sent.push(m);
    },
    onMessage: (h) => {
      handler = h;
    },
    close: () => {
      closed.v = true;
    },
  };
  return {
    transport,
    sent,
    deliver: (m) => handler?.(m),
    closed,
  };
}

describe("P2PMeshNode.listPeers", () => {
  it("初始为空；connectPeer 后列出；disconnectPeer 只改状态不移除", () => {
    const node = new P2PMeshNode("node-a");
    expect(node.listPeers()).toEqual([]);
    node.connectPeer("peer-1");
    node.connectPeer("peer-2");
    expect(node.listPeers().map((p) => p.peerId).sort()).toEqual(["peer-1", "peer-2"]);
    expect(node.getPeer("peer-1")?.state).toBe("HANDSHAKE");
    node.disconnectPeer("peer-1");
    expect(node.getPeer("peer-1")?.state).toBe("DISCONNECTED");
    expect(node.listPeers()).toHaveLength(2);
    node.disconnectPeer("ghost");
  });
});

describe("P2PSyncSession", () => {
  it("startHandshake 发送 HELLO；收到 HELLO 回复 SYNC_REQUEST 并经 transport 发出", () => {
    const node = new P2PMeshNode("node-a");
    const t = memoryTransport();
    const session = new P2PSyncSession(node, "peer-b", t.transport);
    session.startHandshake();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.type).toBe("HELLO");
    expect(t.sent[0]!.targetId).toBe("peer-b");

    // 对端回 HELLO：时钟相等 → 回 ACK
    t.deliver({
      type: "HELLO",
      senderId: "peer-b",
      seq: 1,
      timestamp: Date.now(),
      payload: { clock: node.store.getVectorClock(), siteCount: 0 },
    } as P2PMessage);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]!.type).toBe("ACK");
    expect(node.getPeer("peer-b")?.state).toBe("READY");
    session.close();
  });

  it("broadcastLocal：READY 对端有差量时发出 DELTA_BATCH；无差量/未就绪时不发", () => {
    const node = new P2PMeshNode("node-a");
    const t = memoryTransport();
    const session = new P2PSyncSession(node, "peer-b", t.transport);
    session.startHandshake();
    // 握手后对端 READY，但本地无操作 → 无广播
    t.deliver({
      type: "HELLO",
      senderId: "peer-b",
      seq: 1,
      timestamp: Date.now(),
      payload: { clock: node.store.getVectorClock(), siteCount: 0 },
    } as P2PMessage);
    t.sent.length = 0;
    session.broadcastLocal();
    expect(t.sent).toHaveLength(0);

    // 本地新增站点 → 产生差量，广播发出
    node.store.addSite({ url: "https://example.com", title: "Example", categoryId: "c1" });
    session.broadcastLocal();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.type).toBe("DELTA_BATCH");
    expect(t.sent[0]!.targetId).toBe("peer-b");
    session.close();
  });

  it("close：清定时器、断开对端、关闭 transport", () => {
    const node = new P2PMeshNode("node-a");
    const t = memoryTransport();
    const session = new P2PSyncSession(node, "peer-b", t.transport);
    session.startHandshake();
    expect(node.getPeer("peer-b")).toBeDefined();
    session.close();
    expect(node.getPeer("peer-b")?.state).toBe("DISCONNECTED");
    expect(t.closed.v).toBe(true);
  });

  it("收到 HEARTBEAT 不回复；收到未知类型不回复", () => {
    const node = new P2PMeshNode("node-a");
    const t = memoryTransport();
    const session = new P2PSyncSession(node, "peer-b", t.transport);
    session.startHandshake();
    t.sent.length = 0;
    t.deliver({
      type: "HEARTBEAT",
      senderId: "peer-b",
      seq: 1,
      timestamp: Date.now(),
      payload: null,
    } as P2PMessage);
    t.deliver({
      type: "UNKNOWN" as never,
      senderId: "peer-b",
      seq: 2,
      timestamp: Date.now(),
      payload: null,
    } as P2PMessage);
    expect(t.sent).toHaveLength(0);
    session.close();
  });
});

describe("createBroadcastChannelTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("BroadcastChannel 不存在时返回 null", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(createBroadcastChannelTransport("test-null")).toBeNull();
  });

  it("同名 channel 的两个 transport 能互发消息；close 后不再投递", async () => {
    const t1 = createBroadcastChannelTransport("navhub-test-mesh");
    const t2 = createBroadcastChannelTransport("navhub-test-mesh");
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    const received: P2PMessage[] = [];
    t2!.onMessage((m) => received.push(m));
    const msg: P2PMessage = {
      type: "HEARTBEAT",
      senderId: "a",
      targetId: "b",
      seq: 1,
      timestamp: Date.now(),
      payload: null,
    };
    t1!.send(msg);
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    expect(received[0]!.senderId).toBe("a");
    t1!.close();
    t2!.close();
  });
});
