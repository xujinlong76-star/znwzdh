/**
 * 批次 N 回归（2026-11-06 深扫 P2-11）：Webhook 签名重放防护。
 * 旧签名只覆盖 rawBody、无时间戳 → 合法请求可被无限重放。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  signHmacSha256,
  verifyHmacSha256,
  signHmacSha256WithTimestamp,
  verifyHmacSha256WithTimestamp,
  createReplayGuard,
  WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
} from "../src/lib/webhook-signature";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(resolve(ROOT, "src/lib/webhook-signature.ts"), "utf8");
const SECRET = "test-webhook-secret-0123456789abcdef";
const BODY = JSON.stringify({ event: "harvest", items: [1, 2, 3] });
const NOW = 1800000000000;
const TS = Math.floor(NOW / 1000);

describe("v1 签名（保留兼容）", () => {
  it("正确签名通过，篡改 body 失败", () => {
    const sig = signHmacSha256(BODY, SECRET);
    expect(verifyHmacSha256(BODY, sig, SECRET)).toBe(true);
    expect(verifyHmacSha256(BODY + "x", sig, SECRET)).toBe(false);
  });
  it("定长 64 hex：短签名/非 hex 一律拒", () => {
    expect(verifyHmacSha256(BODY, "sha256=deadbeef", SECRET)).toBe(false);
    expect(verifyHmacSha256(BODY, "not-a-hex-string", SECRET)).toBe(false);
  });
});

describe("v2 带时间戳签名", () => {
  it("时间窗口内正确签名通过", () => {
    const sig = signHmacSha256WithTimestamp(BODY, SECRET, TS);
    expect(verifyHmacSha256WithTimestamp(BODY, sig, SECRET, String(TS), NOW).ok).toBe(true);
  });
  it("过期时间戳 stale 拒绝", () => {
    const oldTs = TS - WEBHOOK_TIMESTAMP_TOLERANCE_SEC - 5;
    const sig = signHmacSha256WithTimestamp(BODY, SECRET, oldTs);
    const r = verifyHmacSha256WithTimestamp(BODY, sig, SECRET, String(oldTs), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale");
  });
  it("未来时间戳 future 拒绝", () => {
    const futureTs = TS + WEBHOOK_TIMESTAMP_TOLERANCE_SEC + 5;
    const sig = signHmacSha256WithTimestamp(BODY, SECRET, futureTs);
    const r = verifyHmacSha256WithTimestamp(BODY, sig, SECRET, String(futureTs), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("future");
  });
  it("篡改时间戳签名不再匹配", () => {
    const sig = signHmacSha256WithTimestamp(BODY, SECRET, TS);
    const r = verifyHmacSha256WithTimestamp(BODY, sig, SECRET, String(TS + 1), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });
  it("缺失或畸形时间戳头 fail-closed", () => {
    const sig = signHmacSha256WithTimestamp(BODY, SECRET, TS);
    expect(verifyHmacSha256WithTimestamp(BODY, sig, SECRET, null, NOW).reason).toBe("malformed");
    expect(verifyHmacSha256WithTimestamp(BODY, sig, SECRET, "abc", NOW).reason).toBe("malformed");
  });
});

describe("重放去重守卫", () => {
  it("同一签名第二次被拒，TTL 过期后可再用", () => {
    const g = createReplayGuard(1000);
    expect(g.check("sig-1", NOW)).toBe(true);
    expect(g.check("sig-1", NOW + 500)).toBe(false);
    expect(g.check("sig-1", NOW + 1500)).toBe(true);
  });
  it("不同签名互不影响", () => {
    const g = createReplayGuard(1000);
    expect(g.check("a", NOW)).toBe(true);
    expect(g.check("b", NOW)).toBe(true);
  });
});

describe("实现约束", () => {
  it("使用 timingSafeEqual 且只接受 64 hex", () => {
    expect(SRC).toContain("timingSafeEqual");
    expect(SRC).toContain("HEX_64");
  });
  it("v2 载荷包含时间戳（防剥 ts 头退回 v1 重放）", () => {
    expect(SRC).toContain("tsRaw");
    expect(SRC).toContain(".update(tsRaw");
  });
});
