/**
 * 批次 O 回归（2026-11-06 深扫 P2-11 收口）：Webhook 管理端测试旁路必须显式开启。
 *
 * 旧条件：`isAdmin && (x-admin-test === '1' || !WEBHOOK_SECRET || !signature)`
 * 意味着「管理员会话 + 没配密钥」或「管理员会话 + 没带签名头」都会静默跳过验签 ——
 * 测试旁路变成了默认路径，且「签名失败 → 401」这条可观测告警被绕过。
 * 现收紧为：只有显式 `x-admin-test: 1` 才走测试通道；其余一律真验签。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = readFileSync(resolve(ROOT, "src/app/api/videos/webhook-harvest/route.ts"), "utf8");

describe("Webhook 管理端测试旁路", () => {
  it("isTestCall 只依赖显式 x-admin-test 头，不含 !WEBHOOK_SECRET / !signature 兜底", () => {
    const line = ROUTE.split("\n").find((l) => l.includes("const isTestCall"));
    expect(line).toBeTruthy();
    expect(line).toContain("x-admin-test");
    // 这两个兜底条件是本次移除的核心：它们让「缺配置」变成「跳过验签」
    expect(line).not.toMatch(/!WEBHOOK_SECRET/);
    expect(line).not.toMatch(/!signature/);
  });

  it("非测试通道缺签名头时明确 401（不再落入测试分支）", () => {
    expect(ROUTE).toMatch(/if \(!isTestCall && !signature\)/);
    expect(ROUTE).toContain("缺少签名头");
    expect(ROUTE).toMatch(/status: 401/);
  });

  it("真正的验签路径仍调用 processWebhook（未被测试通道吞掉）", () => {
    // round 12 起 processWebhook 多了可选的第 4 参（v2 时间戳头），故用前缀匹配
    expect(ROUTE).toContain("connector.processWebhook(body, signature, rawBody");
    expect(ROUTE).toContain("connector.processAdminTestPayload(body)");
  });

  it("route 会把 v2 时间戳头透传给 processWebhook（round 12 接线）", () => {
    expect(ROUTE).toContain("x-webhook-timestamp");
    expect(ROUTE).toContain("timestampHeader");
  });
});
