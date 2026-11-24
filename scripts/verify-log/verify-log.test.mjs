/**
 * 公开核验日志 PoC — 探针与记录格式的回归测试（不发真实网络请求）。
 *
 * 依据：每日战略研究 2026-11-24 20:00 门禁底稿 §3.4 T1/T3：
 *   T1：每条记录含全部 5 要素（时间戳、方法、证据、结论三态、下次复检日）；
 *   T3：0 条“已核实”结论缺证据或方法——已核实必须同时有 2xx 与第二种方法通过。
 * 真实网络请求不在本测试里；20 站实测由 run-probe.mjs 单独跑。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  VERDICTS,
  extractTitle,
  nextReviewDate,
  probeSite,
  validateRecord,
} from "./probe-site.mjs";

const FIXED_NOW = new Date("2026-11-24T20:15:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status, html) {
  const body = new TextEncoder().encode(html);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    })),
  );
}

function goodRecord() {
  return {
    siteId: "nav-da02af4f6414",
    title: "ChatGPT",
    url: "https://chatgpt.com",
    checkedAt: FIXED_NOW.toISOString(),
    methods: [
      { name: "http-probe", status: 200, byteLength: 1234, error: null },
      { name: "official-domain-match", canonicalDomain: "chatgpt.com", host: "chatgpt.com", matched: true },
    ],
    evidence: { url: "https://chatgpt.com", httpStatus: 200, responseBytes: 1234, sourceLinks: ["https://chatgpt.com"] },
    verdict: "verified",
    verdictLabel: "已核实",
    nextReviewAt: "2026-12-01",
  };
}

describe("validateRecord：5 要素与三态取值", () => {
  it("完整记录 0 错误", () => {
    expect(validateRecord(goodRecord())).toEqual([]);
  });

  it("缺时间戳 / 方法不足 2 种 / 缺证据 / 缺下次复检日均报错", () => {
    const noTime = goodRecord();
    delete noTime.checkedAt;
    expect(validateRecord(noTime).some((e) => e.includes("checkedAt"))).toBe(true);

    const oneMethod = goodRecord();
    oneMethod.methods = oneMethod.methods.slice(0, 1);
    expect(validateRecord(oneMethod).some((e) => e.includes("methods"))).toBe(true);

    const noEvidence = goodRecord();
    delete noEvidence.evidence;
    expect(validateRecord(noEvidence).some((e) => e.includes("evidence"))).toBe(true);

    const noReview = goodRecord();
    delete noReview.nextReviewAt;
    expect(validateRecord(noReview).some((e) => e.includes("nextReviewAt"))).toBe(true);
  });

  it("结论三态取值合法，非法值报错", () => {
    for (const v of VERDICTS) {
      const r = goodRecord();
      r.verdict = v;
      expect(validateRecord(r)).toEqual([]);
    }
    const bad = goodRecord();
    bad.verdict = "trusted";
    expect(validateRecord(bad).some((e) => e.includes("verdict"))).toBe(true);
  });

  it("时间戳须为合法 ISO，下次复检日须为 YYYY-MM-DD", () => {
    const badTime = goodRecord();
    badTime.checkedAt = "not-a-date";
    expect(validateRecord(badTime).some((e) => e.includes("checkedAt"))).toBe(true);

    const badReview = goodRecord();
    badReview.nextReviewAt = "2026/12/01";
    expect(validateRecord(badReview).some((e) => e.includes("nextReviewAt"))).toBe(true);
  });
});

describe("nextReviewDate / extractTitle", () => {
  it("下次复检日 = 核验日 + 7 天", () => {
    expect(nextReviewDate("2026-11-24T20:15:00.000Z")).toBe("2026-12-01");
  });

  it("抽得到 <title>，抽不到返回空串", () => {
    expect(extractTitle("<html><head><title> ChatGPT </title></head></html>")).toBe("ChatGPT");
    expect(extractTitle("<html><body>no title</body></html>")).toBe("");
  });
});

describe("probeSite：结论三态只由证据决定", () => {
  it("200 + 标题命中 → 已核实，且记录含 5 要素", async () => {
    stubFetch(200, "<title>ChatGPT — OpenAI</title>");
    const rec = await probeSite(
      { siteId: "nav-da02af4f6414", title: "ChatGPT", url: "https://chatgpt.com", canonicalDomain: "chatgpt.com" },
      { now: FIXED_NOW },
    );
    expect(rec.verdict).toBe("verified");
    expect(rec.methods.length).toBeGreaterThanOrEqual(2);
    expect(rec.evidence.httpStatus).toBe(200);
    expect(rec.nextReviewAt).toBe("2026-12-01");
    expect(validateRecord(rec)).toEqual([]);
  });

  it("404 → 未核实（探针跑通但证据不符，不猜已核实）", async () => {
    stubFetch(404, "<title>Not Found</title>");
    const rec = await probeSite(
      { siteId: "nav-9e9db2e08ffe", title: "Suno", url: "https://suno.com" },
      { now: FIXED_NOW },
    );
    expect(rec.verdict).toBe("unverified");
    expect(validateRecord(rec)).toEqual([]);
  });

  it("网络错 / 超时 → 未知（无证据可判断，不编结论）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
    const rec = await probeSite(
      { siteId: "nav-9e9db2e08ffe", title: "Suno", url: "https://suno.com" },
      { now: FIXED_NOW },
    );
    expect(rec.verdict).toBe("unknown");
    expect(rec.evidence.httpError).toBeTruthy();
    expect(validateRecord(rec)).toEqual([]);
  });
});

describe("poc-sites.json：20 站清单齐备", () => {
  it("20 站：官方 10 + 随机 10，siteId 唯一，URL 合法，官方站有规范域名", () => {
    const list = JSON.parse(readFileSync(resolve("scripts/verify-log/poc-sites.json"), "utf8"));
    expect(list.totalSites).toBe(20);
    expect(list.sites).toHaveLength(20);
    const official = list.sites.filter((s) => s.stratum === "official-50");
    const random = list.sites.filter((s) => s.stratum === "random-sample");
    expect(official).toHaveLength(10);
    expect(random).toHaveLength(10);
    expect(new Set(list.sites.map((s) => s.siteId)).size).toBe(20);
    for (const s of list.sites) {
      expect(() => new URL(s.url)).not.toThrow();
      expect(s.title).toBeTruthy();
    }
    for (const s of official) {
      expect(s.canonicalDomain).toBeTruthy();
    }
    // 两层不重叠：随机层不得含官方域名
    expect(random.every((s) => !s.canonicalDomain)).toBe(true);
  });
});
