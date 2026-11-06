/**
 * 批次 P 回归（2026-11-06 深扫 P2-11 收口）：connector.processWebhook 的 v2 接线。
 *
 * round 10 只做了库函数（时间戳签名 + 重放守卫），round 12 把它接进真正的处理入口。
 * 本测试直接驱动 MultiSourceConnector，验证：
 *  ① 带 ts 头走 v2：正确签名通过；
 *  ② 同一请求重放 → 被去重守卫拒；
 *  ③ 过期 ts → 拒；
 *  ④ 不带 ts 头退回 v1（兼容现网发送方）；
 *  ⑤ 剥掉 ts 头退回 v1 会因载荷不同而验签失败（无降级绕过）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MultiSourceConnector } from "../src/lib/video-multi-source-connector";
import { signHmacSha256, signHmacSha256WithTimestamp } from "../src/lib/webhook-signature";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(resolve(ROOT, "src/lib/video-multi-source-connector.ts"), "utf8");
const SECRET = 'round12-webhook-secret-0123456789abcdef';
const PAYLOAD = {
  data: {
    id: 'bv1round12test',
    title: '深入理解 TypeScript 类型系统',
    description: '讲解泛型、条件类型与类型推导的工程实践，适合中级前端。',
    author: '测试作者',
    durationSec: 1200,
    url: 'https://www.bilibili.com/video/BV1round12test',
    domain: 'bilibili.com',
  },
};
const RAW = JSON.stringify(PAYLOAD);
const NOW = Date.now(); // 与 connector 内部 Date.now() 对齐，避免被判 future/stale
const TS = Math.floor(NOW / 1000);

describe("connector v2 签名接线", () => {
  it("源码确实导入了 v2 校验与去重守卫", () => {
    expect(SRC).toContain("verifyHmacSha256WithTimestamp");
    expect(SRC).toContain("createReplayGuard");
    expect(SRC).toContain("webhookReplayGuard");
  });

  it("带合法 ts 头的正确签名可以通过验签阶段（不因签名被拒）", () => {
    const c = new MultiSourceConnector(SECRET);
    const sig = signHmacSha256WithTimestamp(RAW, SECRET, TS);
    const res = c.processWebhook(PAYLOAD as never, sig, RAW, String(TS));
    // 签名阶段应通过；若后续 AI 审核未过，message 不会是「签名验证失败」
    expect(res.message).not.toContain("签名验证失败");
  });

  it("同一请求重放第二次被拒（去重守卫生效）", () => {
    const c = new MultiSourceConnector(SECRET);
    // 去重守卫是**模块级**的（跨用例共享），所以这里必须用全用例唯一的载荷/时间，
    // 否则前一个用例已登记相同 (ts+sig)，本用例「第一次」就会被判重放。
    const uniquePayload = {
      data: { ...PAYLOAD.data, id: 'bv1round12replay', url: 'https://www.bilibili.com/video/BV1round12replay' },
    };
    const uniqueRaw = JSON.stringify(uniquePayload);
    const uniqueTs = TS + 1;
    const sig = signHmacSha256WithTimestamp(uniqueRaw, SECRET, uniqueTs);
    const first = c.processWebhook(uniquePayload as never, sig, uniqueRaw, String(uniqueTs));
    const second = c.processWebhook(uniquePayload as never, sig, uniqueRaw, String(uniqueTs));
    expect(first.message).not.toContain("重放");
    expect(second.message).toContain("重放");
  });

  it("过期 ts 被拒", () => {
    const c = new MultiSourceConnector(SECRET);
    const oldTs = TS - 3600;
    const sig = signHmacSha256WithTimestamp(RAW, SECRET, oldTs);
    const res = c.processWebhook(PAYLOAD as never, sig, RAW, String(oldTs));
    expect(res.message).toContain("签名验证失败");
    expect(res.message).toContain("stale");
  });

  it("不带 ts 头退回 v1（兼容现网发送方）", () => {
    const c = new MultiSourceConnector(SECRET);
    const sig = signHmacSha256(RAW, SECRET);
    const res = c.processWebhook(PAYLOAD as never, sig, RAW);
    expect(res.message).not.toContain("签名验证失败");
  });

  it("剥掉 ts 头退回 v1 无法通过（v2 签名含 ts，无降级绕过）", () => {
    const c = new MultiSourceConnector(SECRET);
    const sigV2 = signHmacSha256WithTimestamp(RAW, SECRET, TS);
    const res = c.processWebhook(PAYLOAD as never, sigV2, RAW); // 故意不传 ts
    expect(res.message).toContain("签名验证失败");
  });
});
