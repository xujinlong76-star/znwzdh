/**
 * `candidate-probe.ts` 的批量探活语义（纯逻辑，不触网）。
 *
 * 这里锁的是「抽出来之后仍然成立」的那几条判据，尤其是新加的两条：
 *  1. **标注而不是删除**：模型说「这个站很好」、实测说「这个站 404」，这个分歧本身
 *     就是要给运营看的信息；静默剔掉一条只会让列表看起来更干净、更假。
 *  2. **预算用尽 ≠ 站点已死**：整批有绝对截止点，超时的候选按「没测准」出档位，
 *     且必须**很快返回**——原来单条 2.5 秒的超时是逐跳的，重定向链最坏一条就吃掉十几秒，
 *     接口会一直挂着，前端只看到转圈。
 *  3. **探活函数抛异常 ≠ 预算用尽**：前者按探活异常口径归类（能给出真原因），
 *     后者只能说「没等够」。混成同一句文案会让人以为重试一次就有结论。
 *
 * 探活器是注入的假函数，因此档位、耗时、排序全部离线可复现。
 */
import { describe, expect, it } from "vitest";
import { probeCandidates, type CandidateProbe, type StructuredReplacementCandidate } from "../src/candidate-probe.ts";

function candidate(url: string, extra: Partial<StructuredReplacementCandidate> = {}): StructuredReplacementCandidate {
  return { title: url, url, reason: "测试候选", ...extra };
}

function probeOf(grade: CandidateProbe["grade"], reason = "实测结论"): CandidateProbe {
  return { grade, ok: grade === "verified", latencyMs: 120, reason };
}

/** 每条 URL 给一个固定档位的探活器 */
function fakeProbe(byUrl: Record<string, CandidateProbe["grade"]>): (url: string) => Promise<CandidateProbe> {
  return async (url: string) => probeOf(byUrl[url] ?? "unverified", `${url} 的实测结论`);
}

describe("候选批量探活：排序、标注与读数", () => {
  it("按实测档位重排，且不可达的候选只标注、不删除", async () => {
    const input = [
      candidate("https://gone.example/", { source: "ai" }),
      candidate("https://ok.example/", { source: "ai" }),
      candidate("https://parked.example/", { source: "ai" }),
    ];
    const { candidates, summary } = await probeCandidates(input, {
      probe: fakeProbe({
        "https://gone.example/": "dead",
        "https://ok.example/": "verified",
        "https://parked.example/": "suspicious",
      }),
    });

    expect(candidates.map((c) => c.url)).toEqual([
      "https://ok.example/",
      "https://parked.example/",
      "https://gone.example/",
    ]);
    expect(candidates.map((c) => c.grade)).toEqual(["verified", "suspicious", "dead"]);
    expect(candidates.map((c) => c.verified)).toEqual([true, false, false]);
    // 每条都带着实测原因出去，前端才不必自己猜「为什么这条排前面」
    expect(candidates.every((c) => typeof c.gradeReason === "string" && c.gradeReason.length > 0)).toBe(true);
    // 「不删除」的硬证据：条数与输入一致
    expect(summary.checked).toBe(input.length);
    expect(summary).toMatchObject({ verified: 1, unreachable: 2, inconclusive: 0, pending: 0, hasVerified: true });
  });

  it("可信度可追溯：档位决定可达性分项，来源决定领域匹配，模型自评分只做微调", async () => {
    const { candidates } = await probeCandidates(
      [
        candidate("https://ok.example/", { source: "ai", qualityScore: 99 }),
        candidate("https://gone.example/", { source: "catalog" }),
      ],
      { probe: fakeProbe({ "https://ok.example/": "verified", "https://gone.example/": "dead" }) },
    );

    const ok = candidates.find((c) => c.url === "https://ok.example/")!;
    const gone = candidates.find((c) => c.url === "https://gone.example/")!;
    // 模型来源缺省领域匹配 75，站内来源缺省 70
    expect(ok.confidence?.domainFit).toBe(75);
    expect(gone.confidence?.domainFit).toBe(70);
    // verified：可达 100 + 内容健康 100，qualityScore 99 只加 (99-92)*0.15 ≈ 1 分
    expect(ok.confidence).toMatchObject({ reachability: 100, contentHealth: 100 });
    expect(ok.confidence!.total).toBe(Math.round(100 * 0.5 + 100 * 0.3 + 75 * 0.2) + 1);
    // dead：不声称可达，分数只反映领域匹配
    expect(gone.confidence).toMatchObject({ reachability: 0, contentHealth: 0 });
    expect(gone.confidence!.total).toBe(Math.round(0 + 0 + 70 * 0.2));
    // 对外只有一个 qualityScore，必须等于合成出来的可信度，不能是模型自评分
    expect(ok.qualityScore).toBe(ok.confidence!.total);
    expect(gone.qualityScore).toBe(gone.confidence!.total);
  });

  it("预算用尽的候选按「没测准」标注，并且接口不无限期挂着", async () => {
    const started = Date.now();
    const { candidates, summary } = await probeCandidates(
      [candidate("https://slow-a.example/", { source: "ai" }), candidate("https://slow-b.example/", { source: "ai" })],
      {
        // 永不落地的探活：真实 guardedFetch 的超时是逐跳的，这里专门验证「批次级」截止点
        probe: () => new Promise<CandidateProbe>(() => undefined),
        budgetMs: 80,
      },
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000);
    expect(summary.pending).toBe(2);
    expect(summary.inconclusive).toBe(2);
    expect(summary.unreachable).toBe(0);
    expect(summary.hasVerified).toBe(false);
    for (const c of candidates) {
      expect(c.grade).toBe("unverified");
      expect(c.verified).toBe(false);
      // 文案里必须写「预算内未给出结论 + 慢不等于死」，不能写成不可达
      expect(c.gradeReason).toContain("预算");
      expect(c.gradeReason).toContain("慢 ≠ 死");
    }
  });

  it("探活函数抛真异常时按异常口径归类，不冒充「预算用尽」", async () => {
    const { candidates, summary } = await probeCandidates(
      [candidate("https://flaky.example/"), candidate("https://internal.example/")],
      {
        budgetMs: 5_000,
        probe: async (url: string) => {
          // 与真实链路一致的两种抛错：抖动 / 被 SSRF 守卫拒绝
          if (url.includes("flaky")) throw new Error("抓取失败 https://flaky.example/: This operation was aborted");
          throw new Error("目标是受保护网段: 127.0.0.1");
        },
      },
    );

    expect(summary.pending).toBe(0);
    const flaky = candidates.find((c) => c.url === "https://flaky.example/")!;
    const internal = candidates.find((c) => c.url === "https://internal.example/")!;
    // 超时属于「没测准」，且不得出现「预算」字样（那是另一件事）
    expect(flaky.grade).toBe("unverified");
    expect(flaky.gradeReason).not.toContain("预算");
    // 内网目标是我方主动拒绝探测，按口径属于「已确认不可用」
    expect(internal.grade).toBe("dead");
    expect(internal.gradeReason).toContain("内网");
  });

  it("空候选集不报错，读数全为 0", async () => {
    const { candidates, summary } = await probeCandidates([]);
    expect(candidates).toEqual([]);
    expect(summary).toMatchObject({ checked: 0, verified: 0, unreachable: 0, inconclusive: 0, pending: 0, hasVerified: false });
    expect(summary.caveat).toContain("本机");
  });
});
