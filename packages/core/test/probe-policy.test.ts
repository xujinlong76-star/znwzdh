/**
 * 探活口径唯一事实源的契约测试。
 *
 * 锁两件事：
 *   1. **判定本身**：哪些状态码/异常算死，哪些只算「没测准」；
 *   2. **一致性**：同一份结论翻译到候选档位与深检 HTTP 结论时不得互相矛盾
 *      （历史上就是这里漂移，才出现「候选说不可达、深检说服务端异常」）。
 *
 * 全部不触网：policy 是纯函数。
 */
import { describe, expect, it } from "vitest";
import {
  BOT_BLOCKED_STATUSES,
  CONFIRMED_GONE_STATUSES,
  classifyProbeError,
  classifyProbeStatus,
  isBotBlockedStatus,
  outcomeToCandidateGrade,
  outcomeToHttpVerdict,
} from "../src/probe-policy.ts";

const TIMEOUT = 2500;

describe("状态码口径：只有页面确定不存在才算死", () => {
  it.each([404, 410, 451])("%i 判 dead", (code) => {
    const o = classifyProbeStatus(code);
    expect(o?.kind).toBe("dead");
    expect(o?.reason).toContain("不存在");
  });

  it.each([500, 502, 503, 504])("%i 判 server-error，不当成已死", (code) => {
    const o = classifyProbeStatus(code);
    expect(o?.kind).toBe("server-error");
    expect(o?.reason).toContain("不等于站点已死");
    // 关键：不能出现「不可达」这种死亡通知
    expect(o?.reason).not.toContain("不可达");
  });

  it.each([401, 403, 405, 412, 418, 429])("%i 判 blocked（活着但拒绝爬虫）", (code) => {
    const o = classifyProbeStatus(code);
    expect(o?.kind).toBe("blocked");
    expect(o?.reason).toContain("拒绝爬虫");
  });

  it("400 无法区分风控与格式错误，只算未能验证", () => {
    const o = classifyProbeStatus(400);
    expect(o?.kind).toBe("unverified");
    expect(o?.reason).toContain("未能确认可用性");
  });

  it("408 是等待超时，不算死", () => {
    expect(classifyProbeStatus(408)?.kind).toBe("unverified");
  });

  it.each([200, 204, 301, 304])("1xx–3xx 不是失败，返回 null（%i）", (code) => {
    expect(classifyProbeStatus(code)).toBeNull();
  });

  it("机器拦截状态码集合与判定函数始终同步", () => {
    for (const code of BOT_BLOCKED_STATUSES) expect(isBotBlockedStatus(code)).toBe(true);
    for (const code of CONFIRMED_GONE_STATUSES) expect(isBotBlockedStatus(code)).toBe(false);
    expect(isBotBlockedStatus(200)).toBe(false);
  });
});

describe("异常口径：慢 ≠ 死", () => {
  it("超时判 unverified，文案写清「慢不等于死」", () => {
    const o = classifyProbeError(new Error("This operation was aborted"), { elapsedMs: TIMEOUT, timeoutMs: TIMEOUT });
    expect(o.kind).toBe("unverified");
    expect(o.reason).toContain("未响应");
    expect(o.reason).toContain("慢不等于死");
  });

  it("耗时逼近上限时，即使异常文本里没有 timeout 也判超时", () => {
    const o = classifyProbeError(new Error("socket hang up"), { elapsedMs: TIMEOUT * 0.99, timeoutMs: TIMEOUT });
    expect(o.kind).toBe("unverified");
  });

  it("连接被重置不判死", () => {
    const o = classifyProbeError(new Error("fetch failed"), { elapsedMs: 120, timeoutMs: TIMEOUT });
    expect(o.kind).toBe("unverified");
    expect(o.reason).toContain("连接中断");
  });

  it("域名不解析、端口拒绝、证书无效、跳转成环、SSRF 拒绝才是死", () => {
    const cases: Array<[string, string]> = [
      ["DNS 解析失败: gone.example", "域名无法解析"],
      ["connect ECONNREFUSED 1.2.3.4:443", "连接被拒绝"],
      ["unable to verify the first certificate", "证书无效"],
      ["重定向次数超过 6 次", "重定向次数过多"],
      ["目标是受保护网段: 127.0.0.1", "拒绝探测"],
    ];
    for (const [message, expected] of cases) {
      const o = classifyProbeError(new Error(message), { elapsedMs: 60, timeoutMs: TIMEOUT });
      expect(o.kind).toBe("dead");
      expect(o.reason).toContain(expected);
    }
  });

  it("原始英文错误不外泄（原因必须是可读中文）", () => {
    const o = classifyProbeError(new Error("getaddrinfo ENOTFOUND x"), { elapsedMs: 80, timeoutMs: TIMEOUT });
    expect(o.reason).not.toMatch(/ENOTFOUND|fetch failed|aborted/i);
  });
});

describe("口径一致性：候选档位与深检结论不得互相矛盾", () => {
  const statuses = [200, 301, 400, 401, 403, 404, 405, 408, 410, 412, 418, 429, 451, 500, 502, 503, 504];

  it("同一状态码在两个消费方的翻译保持对应关系", () => {
    for (const status of statuses) {
      const outcome = classifyProbeStatus(status);
      const grade = outcome ? outcomeToCandidateGrade(outcome.kind) : "verified";
      const verdict = outcome ? outcomeToHttpVerdict(outcome.kind) : null;

      if (verdict === "server-error") {
        // 5xx：两边界都必须说「未能验证」，绝不能说死
        expect(grade).toBe("unverified");
        expect(outcome?.kind).toBe("server-error");
      }
      if (verdict === "bot-blocked") {
        expect(grade).toBe("blocked");
      }
      if (verdict === "http-error") {
        expect(["dead", "unverified"]).toContain(grade);
      }
      if (verdict === null) {
        expect(grade).toBe("verified");
      }
      // 反向：判死的档位必须能给出 http-error（否则深检会说「健康」）
      if (grade === "dead") expect(verdict).toBe("http-error");
    }
  });

  it("只有 dead 这一档代表「确认失效」，其余非 verified 档都不得使用死亡措辞", () => {
    for (const status of statuses) {
      const outcome = classifyProbeStatus(status);
      if (!outcome) continue;
      const grade = outcomeToCandidateGrade(outcome.kind);
      if (grade === "dead") continue;
      expect(outcome.reason).not.toContain("不可达");
      expect(outcome.reason).not.toContain("已下线");
    }
  });
});
