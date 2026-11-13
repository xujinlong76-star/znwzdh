/**
 * CRDT presence（在线标签页计数）行为测试。
 *
 * 回归背景：胶囊「N 标签页实时协同」以前用标量 peerCount 计数——收到 PONG
 * 就 +1（不看 clientId、不去重、只加不减），收到操作广播还直接采信对方
 * 报来的 peerCount；而首页双挂 Sidebar 使同 tab 内两个胶囊实例互发
 * PING/PONG，结果只开一个标签页也显示「2 标签页」，关标签后永不回落。
 * 现按 clientId（每个标签页一个）记存活集合：peerCount = 远端存活数 + 自己。
 *
 * 注意：同 tab 双实例共享 clientId，所以「单 tab 双实例显示 1」的关键
 * 断言是——来自自己 clientId 的 PONG（哪怕 instanceId 不同）必须忽略。
 */
import { describe, expect, it } from "vitest";
import {
  CrdtPresence,
  PEER_EXPIRY_MS,
  PEER_HEARTBEAT_MS,
} from "../src/lib/crdt-presence";

const SELF = "client_self";
const OTHER = "client_other";
const THIRD = "client_third";
const T0 = 1_000_000;

const pong = (clientId: string, instanceId = "inst_a") => ({
  type: "CRDT_PONG",
  clientId,
  instanceId,
});
const ping = (clientId: string, instanceId = "inst_a") => ({
  type: "CRDT_PING",
  clientId,
  instanceId,
});
const opBroadcast = (clientId: string, peerCount: number) => ({
  type: "CRDT_OP_BROADCAST",
  clientId,
  instanceId: "inst_a",
  operations: [],
  peerCount,
});

describe("CrdtPresence", () => {
  it("初始只有自己：peerCount 为 1", () => {
    expect(new CrdtPresence(SELF).peerCount).toBe(1);
  });

  it("单 tab 双实例显示 1：来自自己 clientId 的 PONG/PING（instanceId 不同）都忽略", () => {
    const presence = new CrdtPresence(SELF);
    expect(presence.noteMessage(pong(SELF, "inst_other"), T0)).toBe(false);
    expect(presence.noteMessage(ping(SELF, "inst_other"), T0)).toBe(false);
    expect(presence.noteMessage(opBroadcast(SELF, 8), T0)).toBe(false);
    expect(presence.peerCount).toBe(1);
  });

  it("双 tab 显示 2：远端 tab 的 PONG 记一次，重复 PONG 不虚增", () => {
    const presence = new CrdtPresence(SELF);
    expect(presence.noteMessage(pong(OTHER), T0)).toBe(true);
    expect(presence.peerCount).toBe(2);
    // 同一个远端 tab 再发 5 次 PONG：只刷新时间戳，不新增、不虚增
    for (let i = 1; i <= 5; i++) {
      expect(presence.noteMessage(pong(OTHER), T0 + i * 100)).toBe(false);
    }
    expect(presence.peerCount).toBe(2);
  });

  it("三 tab 显示 3：不同 clientId 各计一个", () => {
    const presence = new CrdtPresence(SELF);
    presence.noteMessage(pong(OTHER), T0);
    presence.noteMessage(ping(THIRD), T0);
    expect(presence.peerCount).toBe(3);
  });

  it("不采信对方自报的 peerCount：操作广播带 peerCount 8 也只计 1 个远端 tab", () => {
    const presence = new CrdtPresence(SELF);
    presence.noteMessage(opBroadcast(OTHER, 8), T0);
    expect(presence.peerCount).toBe(2);
    // 没有 clientId 的广播不计数
    presence.noteMessage({ type: "CRDT_OP_BROADCAST", operations: [] }, T0);
    expect(presence.peerCount).toBe(2);
  });

  it("过期扫除后计数回落：15 秒未见即摘除，关闭的标签页不再计入", () => {
    const presence = new CrdtPresence(SELF);
    presence.noteMessage(pong(OTHER), T0);
    presence.noteMessage(pong(THIRD), T0);
    expect(presence.peerCount).toBe(3);
    // 未过期时不摘除
    expect(presence.prune(T0 + PEER_EXPIRY_MS)).toBe(false);
    expect(presence.peerCount).toBe(3);
    // 超过 15 秒未见：两个远端 tab 一起摘除，回落到 1
    expect(presence.prune(T0 + PEER_EXPIRY_MS + 1)).toBe(true);
    expect(presence.peerCount).toBe(1);
  });

  it("心跳续命：15 秒内又见到就续命，只摘除真正安静的标签页", () => {
    const presence = new CrdtPresence(SELF);
    presence.noteMessage(pong(OTHER), T0);
    presence.noteMessage(pong(THIRD), T0);
    // OTHER 在 10 秒时又发了一次 PONG（心跳续命），THIRD 再没出现
    presence.noteMessage(pong(OTHER), T0 + 10_000);
    expect(presence.prune(T0 + 20_000)).toBe(true);
    expect(presence.peerCount).toBe(2); // 只剩 OTHER
    expect(presence.prune(T0 + 26_000)).toBe(true);
    expect(presence.peerCount).toBe(1);
  });

  it("非计数消息不影响计数：未知类型、空消息、无 clientId 都忽略", () => {
    const presence = new CrdtPresence(SELF);
    presence.noteMessage({ type: "CRDT_UNKNOWN", clientId: OTHER }, T0);
    presence.noteMessage(null, T0);
    presence.noteMessage(undefined, T0);
    presence.noteMessage({ type: "CRDT_PONG" }, T0);
    expect(presence.peerCount).toBe(1);
  });

  it("节律常量：心跳 5 秒、过期 15 秒（改动需有意为之）", () => {
    expect(PEER_HEARTBEAT_MS).toBe(5_000);
    expect(PEER_EXPIRY_MS).toBe(15_000);
  });
});
