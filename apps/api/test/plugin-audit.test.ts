/**
 * 插件 URL 体检核心逻辑的契约测试（P0-1）。
 *
 * 这里锁四件事，都是「看起来对、其实容易错」的地方：
 *   1. 抽样要**均匀覆盖整包**（只验前 N 条会让后半段分类的失效漏检）；
 *   2. 可达率口径：total=0 时必须是 null，不能用 0 冒充「全挂」；
 *   3. 并发编排要真的限流（并发上限被突破会在几百条探测时打爆对端）；
 *   4. 单条必须有兜底超时（探活器自己挂起时不能拖死整批体检）。
 *
 * 探活器是注入的，所以本测试**不触网**、可在 CI 里稳定跑。
 */
import { describe, expect, it } from "vitest";
import {
  auditPluginUrls,
  isBlockedByBotStatus,
  normalizeAuditUrl,
  PLUGIN_AUDIT_DEFAULTS,
  probeUrls,
  sampleUrls,
  summarizeProbes,
  type UrlProbeResult,
} from "../src/plugin-audit.ts";

function makeUrls(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `https://site-${String(i).padStart(3, "0")}.example.org/`);
}

describe("抽样：均匀覆盖整包且确定性", () => {
  it("300 条抽 30 条：数量正确、互不重复、且覆盖到尾部（不是只取前 30）", () => {
    const urls = makeUrls(300);
    const picked = sampleUrls(urls, 30);
    expect(picked).toHaveLength(30);
    expect(new Set(picked).size).toBe(30);
    // 尾部必须被覆盖到：取到过索引 >= 250 的站点
    const tailPicked = picked.some((url) => Number(/site-(\d+)/.exec(url)?.[1]) >= 250);
    expect(tailPicked, "抽样未覆盖到包的后段，后半段分类会漏检").toBe(true);
  });

  it("同一输入多次抽样结果一致（报告可复现、可对比）", () => {
    const urls = makeUrls(137);
    expect(sampleUrls(urls, 20)).toEqual(sampleUrls(urls, 20));
  });

  it("样本量大于等于总数时返回全部；limit<=0 或空输入返回空", () => {
    expect(sampleUrls(makeUrls(12), 30)).toHaveLength(12);
    expect(sampleUrls(makeUrls(12), 0)).toEqual([]);
    expect(sampleUrls([], 10)).toEqual([]);
  })
})

describe("汇总：可达率与不可达明细", () => {
  const probes: UrlProbeResult[] = [
    { url: "https://a.example/", ok: true, status: 200 },
    // 重定向：落点与声明地址归一后不同
    { url: "https://b.example/", ok: true, status: 301, finalUrl: "https://www.b.example/" },
    { url: "https://c.example/", ok: false, status: 404 },
    { url: "https://d.example/", ok: false, error: "timeout" },
  ];

  it("计数、可达率（保留 3 位）与 brokenItems 明细", () => {
    const s = summarizeProbes(probes);
    expect(s.total).toBe(4);
    expect(s.ok).toBe(2);
    expect(s.broken).toBe(2);
    expect(s.redirected).toBe(1);
    expect(s.reachability).toBe(0.5);
    expect(s.brokenItems).toEqual([
      { url: "https://c.example/", status: 404, error: undefined, failureKind: "http-error" },
      { url: "https://d.example/", status: undefined, error: "timeout", failureKind: "timeout" },
    ]);
  })

  it("空样本的可达率是 null（不能用 0 冒充「全挂」）", () => {
    const s = summarizeProbes([]);
    expect(s.total).toBe(0);
    expect(s.reachability).toBeNull();
  })

  it("重定向判定走归一化（尾斜杠/大小写/hash 不影响结论）", () => {
    expect(normalizeAuditUrl("https://B.example/x/#frag")).toBe("https://b.example/x");
    const same = summarizeProbes([{ url: "https://b.example/x/", ok: true, status: 200, finalUrl: "https://B.example/x#a" }]);
    expect(same.redirected).toBe(0);
  })
})

describe("存活但拒绝爬虫（401/403/405/412/429）不计入不可达", () => {
  /**
   * 真实背景：首轮真实体检里，前端包的「不可达」全部是 403、政务包大量是 412 ——
   * 那些站点在浏览器里完全正常，只是 WAF 拒绝了爬虫。把它们算成死链会误杀好站点。
   */
  const probes: UrlProbeResult[] = [
    { url: "https://a.example/", ok: true, status: 200 },
    { url: "https://b.example/", ok: false, blocked: true, status: 403 },
    { url: "https://c.example/", ok: false, status: 412 },
    { url: "https://d.example/", ok: false, error: "timeout" },
  ];

  it("blocked 单列且计入可达；真死链仍进 brokenItems", () => {
    const s = summarizeProbes(probes);
    expect(s.ok).toBe(1);
    expect(s.blocked).toBe(2);
    expect(s.broken).toBe(1);
    expect(s.reachability).toBe(0.75); // (1 ok + 2 blocked) / 4
    expect(s.blockedItems.map((i) => i.status).sort()).toEqual([403, 412]);
    expect(s.brokenItems).toHaveLength(1);
    expect(s.brokenItems[0].url).toBe("https://d.example/");
  })

  it("状态码归类：401/403/405/412/418/429 是「拒绝爬虫」；400/404/5xx/200 不是", () => {
    for (const status of [401, 403, 405, 412, 418, 429]) expect(isBlockedByBotStatus(status)).toBe(true);
    // 400 刻意不算：请求格式错误与风控拦截都可能返回它，无法区分 —— 宁可留人工复核，也不误判站点为活
    for (const status of [200, 400, 404, 500, 502, undefined]) expect(isBlockedByBotStatus(status)).toBe(false);
  })

  it("显式 blocked=false 时不再按状态码兜底（调用方可强制归为真不可达）", () => {
    const s = summarizeProbes([{ url: "https://e.example/", ok: false, blocked: false, status: 403 }]);
    expect(s.blocked).toBe(0);
    expect(s.broken).toBe(1);
  })

  it("疑似域名停放/软404/劫持（suspicious=true）：单独列出且不计入健康 ok", () => {
    const s = summarizeProbes([
      { url: "https://healthy.example/", ok: true, status: 200 },
      {
        url: "https://parked.example/",
        ok: false,
        status: 200,
        suspicious: true,
        suspiciousReason: "检测到域名出售停放关键词 [domain for sale]",
        extractedTitle: "Domain For Sale",
        shannonEntropy: 2.1,
        matchedKeywords: ["domain for sale"],
      },
    ]);
    expect(s.total).toBe(2);
    expect(s.ok).toBe(1);
    expect(s.suspicious).toBe(1);
    expect(s.broken).toBe(0);
    expect(s.suspiciousItems).toHaveLength(1);
    expect(s.suspiciousItems[0].title).toBe("Domain For Sale");
    expect(s.suspiciousItems[0].matchedKeywords).toEqual(["domain for sale"]);
  })
})

describe("失败原因归类：区分「我们的探针限制」与「站点真挂」", () => {
  it("按 failureKind 分布统计；探针兜底超时优先记为 timeout", () => {
    const s = summarizeProbes([
      { url: "https://a.example/", ok: false, failureKind: "redirect-limit", error: "重定向次数超过 6 次" },
      { url: "https://b.example/", ok: false, failureKind: "connect", error: "fetch failed" },
      // 探针兜底超时只给 error='timeout'（没有 failureKind），必须也能归到 timeout
      { url: "https://c.example/", ok: false, error: "timeout" },
      // 有状态码、无 failureKind → 退化为 http-error
      { url: "https://d.example/", ok: false, status: 500 },
    ]);
    expect(s.brokenByReason).toEqual({
      timeout: 1,
      "redirect-limit": 1,
      "ssrf-blocked": 0,
      connect: 1,
      "http-error": 1,
      other: 0,
    });
    expect(s.brokenItems.map((i) => i.failureKind)).toEqual(["redirect-limit", "connect", "timeout", "http-error"]);
  })
})

describe("并发编排：限流 + 兜底超时", () => {
  it("并发上限被遵守，且结果顺序与输入一致", async () => {
    const urls = makeUrls(17);
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await probeUrls(
      urls,
      async (url) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return { url, ok: true, status: 200 };
      },
      { concurrency: 4, timeoutMs: 1_000 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(results.map((r) => r.url)).toEqual(urls);
  })

  it("探活器挂起时按 broken/timeout 记录，不拖死整批", async () => {
    const results = await probeUrls(["https://hang.example/"], () => new Promise<UrlProbeResult>(() => {}), {
      concurrency: 2,
      timeoutMs: 30,
    });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toBe("timeout");
  })

  it("探活器抛错时按 broken 记录错误文本", async () => {
    const results = await probeUrls(["https://boom.example/"], async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toBe("ECONNREFUSED");
  })
})

describe("一步到位入口", () => {
  it("按 sample 抽样后探活并汇总（默认抽样 30）", async () => {
    expect(PLUGIN_AUDIT_DEFAULTS.sample).toBe(30);
    const { summary, sampledUrls } = await auditPluginUrls(makeUrls(200), async (url) => ({ url, ok: url.includes("site-01") }));
    expect(sampledUrls).toHaveLength(30);
    expect(summary.total).toBe(30);
    expect(summary.ok + summary.broken).toBe(30);
    expect(summary.reachability).toBeGreaterThan(0);
    expect(summary.reachability).toBeLessThan(1);
  })
})
