import { describe, it, expect } from "vitest";
import { P2PMeshNode } from "../src/p2p-mesh-sync.ts";
import { CrdtStore } from "../src/crdt-sync.ts";

describe("WebRTC P2P 全网拓扑漫游网络与状态向量共识 (P2P Mesh Sync Protocol)", () => {
  it("建立对端连接并发出规范 HELLO 握手报文", () => {
    const nodeA = new P2PMeshNode("node-A");
    const hello = nodeA.connectPeer("node-B");

    expect(hello.type).toBe("HELLO");
    expect(hello.senderId).toBe("node-A");
    expect(hello.targetId).toBe("node-B");
    expect(hello.payload.siteCount).toBe(0);

    const peer = nodeA.getPeer("node-B");
    expect(peer).toBeDefined();
    expect(peer?.state).toBe("HANDSHAKE");
  });

  it("两节点握手并完成双向差量同步收敛", () => {
    const storeA = new CrdtStore("node-A");
    const storeB = new CrdtStore("node-B");

    // 节点 A 本地新增站点
    storeA.addSite({
      id: "site-1",
      title: "GitHub",
      url: "https://github.com",
      categoryId: "dev",
    });

    // 节点 B 本地新增不同站点
    storeB.addSite({
      id: "site-2",
      title: "Vercel",
      url: "https://vercel.com",
      categoryId: "dev",
    });

    const nodeA = new P2PMeshNode("node-A", storeA);
    const nodeB = new P2PMeshNode("node-B", storeB);

    // 1. A 连接 B 发送 HELLO
    const helloFromA = nodeA.connectPeer("node-B");

    // 2. B 接收 A 的 HELLO 报文，发现 A 缺少 site-2，返回 DELTA_BATCH
    const replyFromB = nodeB.handleIncomingMessage(helloFromA);
    expect(replyFromB).not.toBeNull();
    expect(replyFromB?.type).toBe("DELTA_BATCH");

    // 3. A 接收 B 的 DELTA_BATCH，应用 site-2 并回传 A 的 site-1
    const replyFromA = nodeA.handleIncomingMessage(replyFromB!);
    expect(replyFromA).not.toBeNull();
    expect(replyFromA?.type).toBe("DELTA_BATCH");

    // 4. B 接收 A 的 DELTA_BATCH，应用 site-1 并发出 ACK
    const ackFromB = nodeB.handleIncomingMessage(replyFromA!);
    expect(ackFromB).not.toBeNull();
    expect(ackFromB?.type).toBe("ACK");

    // 5. A 接收 B 的最终 ACK
    const finalResult = nodeA.handleIncomingMessage(ackFromB!);
    expect(finalResult).toBeNull();

    // 最终验证：两个节点的活跃站点完全一致，达成确定性收敛！
    const sitesA = storeA.getActiveSites().map((s) => s.id).sort();
    const sitesB = storeB.getActiveSites().map((s) => s.id).sort();
    expect(sitesA).toEqual(["site-1", "site-2"]);
    expect(sitesB).toEqual(["site-1", "site-2"]);

    // 状态均收敛为 READY
    expect(nodeA.getPeer("node-B")?.state).toBe("READY");
    expect(nodeB.getPeer("node-A")?.state).toBe("READY");
  });

  it("本地发生更新时，广播增量至已连接的活跃 Peers", () => {
    const storeA = new CrdtStore("node-A");
    const nodeA = new P2PMeshNode("node-A", storeA);

    // 建立连接并将状态置为 READY
    nodeA.connectPeer("node-B");
    const peerB = nodeA.getPeer("node-B");
    if (peerB) peerB.state = "READY";

    // 产生本地写入
    storeA.addSite({
      id: "site-3",
      title: "Cloudflare",
      url: "https://cloudflare.com",
      categoryId: "dev",
    });

    const broadcasts = nodeA.broadcastLocalUpdate();
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0]!.type).toBe("DELTA_BATCH");
    expect(broadcasts[0]!.targetId).toBe("node-B");
    expect(broadcasts[0]!.payload.operations.length).toBe(1);
  });

  it("支持对端优雅断开与重连", () => {
    const nodeA = new P2PMeshNode("node-A");
    nodeA.connectPeer("node-C");
    expect(nodeA.getPeer("node-C")?.state).toBe("HANDSHAKE");

    nodeA.disconnectPeer("node-C");
    expect(nodeA.getPeer("node-C")?.state).toBe("DISCONNECTED");
  });
});
