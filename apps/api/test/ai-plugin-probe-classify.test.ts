/**
 * 外链探活的「三分类」回归。
 *
 * 为什么要有这层：探活结果直接决定插件能否自动上架（AI 严审的 25% 权重
 * + 低于阈值时扣合规/相关性分）。旧实现把**所有**非 2xx/3xx 都算失败，
 * 于是超时、403 反爬、429 限流、502 源站抖动都会被当成「站点已死」，
 * 在负载高的机器上把完全正常的插件自动驳回——作者看不到原因，只看到
 * 一句「存活率 43%」。这与仓库链接体检的口径也不一致
 * （scripts/audit-plugin-urls.mjs：DNS 失败 / 404 / 5xx 连击才算失效）。
 *
 * 现在：只有「确认失效」（非法 URL、404、410、451）进分母，
 * 其余网络侧不确定一律 inconclusive —— 未知不等于失效。
 */
import { describe, expect, it } from "vitest";
import { classifyProbe } from "../src/ai-plugin-auditor.ts";

describe("classifyProbe：探活结论三分类", () => {
  it("2xx/3xx → ok", () => {
    expect(classifyProbe(200, true, true)).toBe("ok");
    expect(classifyProbe(301, true, true)).toBe("ok");
  });

  it("确认失效：404 / 410 / 451", () => {
    expect(classifyProbe(404, false, true)).toBe("dead");
    expect(classifyProbe(410, false, true)).toBe("dead");
    expect(classifyProbe(451, false, true)).toBe("dead");
  });

  it("网络侧不确定：超时(0) / 403 / 429 / 5xx → inconclusive", () => {
    expect(classifyProbe(0, false, true)).toBe("inconclusive");
    expect(classifyProbe(403, false, true)).toBe("inconclusive");
    expect(classifyProbe(429, false, true)).toBe("inconclusive");
    expect(classifyProbe(500, false, true)).toBe("inconclusive");
    expect(classifyProbe(503, false, true)).toBe("inconclusive");
  });

  it("非法 URL 是清单错误，判死而不是不可判定", () => {
    expect(classifyProbe(0, false, false)).toBe("dead");
  });
});
