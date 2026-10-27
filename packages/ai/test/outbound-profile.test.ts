/**
 * profile 表的漂移测试。
 *
 * 允许不同的只有「超时 / 体积 / 跳数」三项；UA 必须一致（同一台爬虫不该有两副面孔），
 * 且候选探活必须比抽样体检更严格（更短超时、更小体积）——方向反了说明谁抄错了。
 */
import { describe, expect, it } from "vitest";
import { OUTBOUND_PROFILES, outboundProfile } from "../src/outbound.ts";

const names = Object.keys(OUTBOUND_PROFILES) as Array<keyof typeof OUTBOUND_PROFILES>;

describe("出站 profile", () => {
  it("三个 profile 都存在，且字段完整", () => {
    for (const name of names) {
      const p = outboundProfile(name);
      expect(p.timeoutMs).toBeGreaterThan(0);
      expect(p.maxBytes).toBeGreaterThan(0);
      expect(p.maxRedirects).toBeGreaterThanOrEqual(0);
      expect(p.userAgent).toContain("NavHubBot");
    }
  });

  it("UA 完全一致（同一台爬虫不该有两副面孔）", () => {
    const uas = new Set(names.map((n) => OUTBOUND_PROFILES[n].userAgent));
    expect(uas.size).toBe(1);
  });

  it("候选探活比抽样体检更严格，抽样体检比正文抓取更严格", () => {
    const { candidate, probe, fetch } = OUTBOUND_PROFILES;
    expect(candidate.timeoutMs).toBeLessThan(probe.timeoutMs);
    expect(probe.timeoutMs).toBeLessThan(fetch.timeoutMs);
    expect(candidate.maxBytes).toBeLessThan(probe.maxBytes);
    expect(probe.maxBytes).toBeLessThan(fetch.maxBytes);
  });

  it("除三项之外没有任何字段差异（防止悄悄加出第四个可调项）", () => {
    const allowed = new Set(["timeoutMs", "maxBytes", "maxRedirects"]);
    const allKeys = new Set(names.flatMap((n) => Object.keys(OUTBOUND_PROFILES[n])));
    const differing = [...allKeys].filter((k) => new Set(names.map((n) => String((OUTBOUND_PROFILES[n] as never)[k]))).size > 1);
    for (const key of differing) expect(allowed.has(key)).toBe(true);
  });
});
