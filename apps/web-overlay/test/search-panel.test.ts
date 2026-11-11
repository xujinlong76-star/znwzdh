/**
 * 搜索面板「零结果 / 降级」的判定与出口。
 *
 * 组件自己的注释写着契约：「中枢不可用时明示降级，而不是假装『没有结果』」。
 * 修复前的实现同时违反了三处：
 *   - 降级 + 零结果时，「检索服务暂时不可用」和「未找到与 x 相关的导航」一起渲染
 *     （用户不知道该重试还是该换词）
 *   - 零结果的出口完全依赖服务端返回的 suggestions / popular，服务端没给就是死路
 *   - 命中投机 / 对比 / 配方微组件时，「导航检索为空」整块被抑制（用户看不到这个事实）
 *
 * 另外还修了两个竞态：新查询开始时没有清空旧结果（旧结果冒充新查询的答案），
 * 「加载更多」没有取消也没有查询守卫（旧查询的追加页会混进新列表并污染 offset）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { planSearchPanel } from "../src/lib/search-panel";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const base = { loading: false, degraded: false, hitCount: 0, query: "react vue", hasWidgetResult: false };

describe("planSearchPanel：检索中与有结果时不该有提示块", () => {
  it("检索中 → hidden", () => {
    expect(planSearchPanel({ ...base, loading: true }).mode).toBe("hidden");
  });

  it("有结果 → hidden（降级横幅由调用方渲染在结果上方）", () => {
    expect(planSearchPanel({ ...base, hitCount: 3 }).mode).toBe("hidden");
    expect(planSearchPanel({ ...base, hitCount: 3, degraded: true }).mode).toBe("hidden");
  });

  it("检索中优先于一切：降级 + 零结果但还在加载 → hidden", () => {
    expect(planSearchPanel({ ...base, loading: true, degraded: true }).mode).toBe("hidden");
  });
});

describe("planSearchPanel：降级不能假装「没有结果」", () => {
  const plan = planSearchPanel({ ...base, degraded: true });

  it("降级 + 零结果 → outage 模式，而不是「未找到」", () => {
    expect(plan.mode).toBe("outage");
    expect(plan.title).toBe("检索服务暂时不可用");
    expect(plan.title + plan.hint).not.toContain("未找到");
  });

  it("说清楚「无法确认」而不是「没有」，并给出重试", () => {
    expect(plan.hint).toContain("无法确认");
    expect(plan.actions.map((a) => a.kind)).toEqual(["retry", "browse-tags", "browse-hot"]);
    expect(plan.actions[0].href).toBeUndefined();
  });
});

describe("planSearchPanel：真零结果也必须有出口", () => {
  const plan = planSearchPanel(base);

  it("标题带上查询词，并给出清空/浏览出口（不依赖服务端 suggestions）", () => {
    expect(plan.mode).toBe("no-results");
    expect(plan.title).toBe("未找到与 “react vue” 相关的导航");
    // A11：两个真出口排最前（AI 找站、投稿收录），清空/浏览是次要出口
    expect(plan.actions.map((a) => a.kind)).toEqual([
      "ai-find",
      "submit-site",
      "clear",
      "browse-tags",
      "browse-hot",
    ]);
  });

  it("A11：AI 找站出口是按钮动作（无 href，组件内唤起抽屉并带词）", () => {
    const aiFind = plan.actions.find((a) => a.kind === "ai-find");
    expect(aiFind).toBeDefined();
    expect(aiFind?.href).toBeUndefined();
    expect(aiFind?.label).toContain("让 AI 帮我找");
    expect(aiFind?.label).toContain("react vue");
  });

  it("A11：投稿出口带查询词预填链接（关键词进 title）", () => {
    const submit = plan.actions.find((a) => a.kind === "submit-site");
    expect(submit?.href).toBe("/submit?title=react%20vue");
  });

  it("A11：网址形查询词进 url 参数（不硬把关键词拼成网址）", () => {
    const byDomain = planSearchPanel({ ...base, query: "example.com" });
    expect(byDomain.actions.find((a) => a.kind === "submit-site")?.href).toBe(
      "/submit?url=https%3A%2F%2Fexample.com%2F",
    );
    const byUrl = planSearchPanel({ ...base, query: "https://foo.dev/x" });
    expect(byUrl.actions.find((a) => a.kind === "submit-site")?.href).toBe(
      "/submit?url=https%3A%2F%2Ffoo.dev%2Fx",
    );
  });

  it("A11：降级（outage）不给 AI 找站/投稿出口——没问成功就别假装能问 AI", () => {
    const outage = planSearchPanel({ ...base, degraded: true });
    expect(outage.actions.map((a) => a.kind)).not.toContain("ai-find");
    expect(outage.actions.map((a) => a.kind)).not.toContain("submit-site");
  });

  it("A11：超长查询词只截断按钮文案，不截断实际发给 AI 的词（label 封顶 24 字）", () => {
    const long = planSearchPanel({ ...base, query: "免费修图工具推荐".repeat(10) });
    const aiFind = long.actions.find((a) => a.kind === "ai-find");
    expect(aiFind?.label.length).toBeLessThan(40);
    expect(aiFind?.label).toContain("…");
  });

  it("查询词两侧空白被裁掉", () => {
    expect(planSearchPanel({ ...base, query: "  pinyin  " }).title).toContain("“pinyin”");
  });

  it("默认提示引导拼音首字母", () => {
    expect(plan.hint).toContain("zgtqw");
  });

  it("命中微组件时仍然显示「导航检索为空」，只是提示措辞不同（回归：曾被整块抑制）", () => {
    const withWidget = planSearchPanel({ ...base, hasWidgetResult: true });
    expect(withWidget.mode).toBe("no-results");
    expect(withWidget.title).toContain("未找到");
    expect(withWidget.hint).toContain("上方卡片");
  });

  it("浏览类出口带站内 href（走客户端路由，不整页刷新）", () => {
    const browse = plan.actions.filter((a) => a.kind.startsWith("browse"));
    expect(browse.map((a) => a.href)).toEqual(["/tags", "/hot"]);
    for (const action of plan.actions) expect(action.label.length).toBeGreaterThan(0);
  });

  it("任意脏输入都不抛异常", () => {
    for (const dirty of [
      { ...base, query: "" },
      { ...base, query: "   " },
      { ...base, hitCount: -1 },
      { ...base, degraded: true, hasWidgetResult: true },
    ]) {
      expect(() => planSearchPanel(dirty)).not.toThrow();
    }
  });
});

describe("search-palette 源码：竞态与矛盾文案的回归守卫", () => {
  const src = overlayFile("src/components/search-palette.tsx");

  it("提示块由 planSearchPanel 决定，不再手写矛盾的双重渲染", () => {
    expect(src).toContain("planSearchPanel({");
    expect(src).toContain("panel.mode !== 'hidden'");
    // 旧的写法：零结果区块被微组件命中整块抑制
    expect(src).not.toContain("!speculativeResult && !comparisonMatrix && !architectureRecipe && (");
    expect(src).not.toContain("{hits.length === 0 && !loading ? (");
  });

  it("降级横幅覆盖 outage 之外的全部模式（零站点结果也要说明，交给横幅而非静默空列表）", () => {
    expect(src).toContain("{degraded && panel.mode !== 'outage' && (");
    // 横幅按「有没有站点结果」分两套文案：有结果是「可能不完整」，没有是「这次没问成功」
    expect(src).toContain("下面结果可能不完整");
    expect(src).toContain("站点检索这次没能问成功");
  });

  it("「加载更多」失败不等于召回池到底（按钮不能因一次网络故障永久消失）", () => {
    // catch 里只能置 moreFailed；置 hasMore=false 就是把「没拉到」说成「没有了」
    expect(src).toContain("setMoreFailed(true)");
    expect(src).toContain("再试一次（已显示 ${hits.length} 条）");
    // 精确取 loadMore 的 catch 块：置 hasMore=false 就是把「没拉到」说成「没有了」
    const moreCatch = src.match(/\.catch\(\(\) => \{[^}]*setMoreFailed\(true\)[^}]*\}\)/)
    expect(moreCatch).not.toBeNull()
    expect(moreCatch?.[0]).not.toContain("setHasMore(false)");
  });

  it("插件子检索失败单独说明（不冒充「插件市场没有匹配」）", () => {
    expect(src).toContain("pluginFailed && pluginItems.length === 0");
    expect(src).toContain("插件结果本次没有取回");
  });

  it("新查询会清空旧结果与旧提示（不再让旧结果冒充新查询的答案）", () => {
    expect(src).toContain("setHits([])");
    expect(src).toContain("setSuggestions([])");
    expect(src).toContain("setFallbackHint(undefined)");
    expect(src).toContain("setDegraded(false)");
  });

  it("加载更多带取消信号与查询守卫（不再污染分页）", () => {
    expect(src).toContain("offset: offsetRef.current, categoryId, identity }, controller.signal)");
    expect(src.match(/activeQueryRef\.current !== q/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("moreAbortRef.current.abort()");
  });

  it("降级有重试出口（重新发起同一查询）", () => {
    expect(src).toContain("setRetryToken((n) => n + 1)");
    expect(src).toContain("retryToken");
  });

  it("检索面板接入知识图谱对标方案推荐 (relationHits)", () => {
    expect(src).toContain("relationHits.length > 0");
    expect(src).toContain("setRelationHits(res.relationHits ?? [])");
  });
});

describe("A11：三处零结果入口共用同一对出口（AI 找站 + 投稿收录）", () => {
  it("首页搜索面板：ai-find 动作唤起抽屉并把完整查询词发过去", () => {
    const palette = overlayFile("src/components/search-palette.tsx");
    expect(palette).toContain("openCopilot({ query: q, source: 'programmatic' })");
    expect(palette).toContain("action.kind === 'ai-find'");
  });

  it("/search 页：零结果区渲染 ZeroResultActions（客户端岛，服务端页其余不动）", () => {
    const results = overlayFile("src/app/search/search-results.tsx");
    expect(results).toContain("ZeroResultActions");
    expect(results).toContain("{q ? <ZeroResultActions query={q} /> : null}");
    const island = overlayFile("src/components/search/zero-result-actions.tsx");
    expect(island).toContain("openCopilot({ query: q, source: 'programmatic' })");
    expect(island).toContain("submitPrefillHref(q)");
  });

  it("⌘K 超级搜索：零结果区同一对出口，点开抽屉/跳投稿时先关弹窗", () => {
    const spotlight = overlayFile("src/components/search/spotlight-modal.tsx");
    expect(spotlight).toContain("openCopilot({ query: query.trim(), source: 'spotlight' })");
    expect(spotlight).toContain("submitPrefillHref(query.trim())");
  });

  it("/submit 页：解析 ?title= / ?url= 并预填表单（非法值由 parseSubmitPrefill 滤掉）", () => {
    const page = overlayFile("src/app/submit/page.tsx");
    expect(page).toContain("parseSubmitPrefill(await searchParams)");
    expect(page).toContain("initialTitle={prefill.initialTitle}");
    expect(page).toContain("initialUrl={prefill.initialUrl}");
    const form = overlayFile("src/components/submission-form.tsx");
    expect(form).toContain("initialTitle");
    expect(form).toContain("initialUrl");
  });
});

