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
      { url: "https://c.example/", status: 404, error: undefined },
      { url: "https://d.example/", status: undefined, error: "timeout" },
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
