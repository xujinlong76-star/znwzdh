/**
 * 搜索降级口径守卫（AI-2）。
 *
 * 两个搜索入口（SearchPalette / Spotlight）对同一故障曾有互相矛盾的结论：
 *   - navhub-api 网络失败时返回 degraded 兜底值、不抛错，只监听 catch 的
 *     Spotlight 把「中枢挂了」显示成「未找到相关结果」；
 *   - 插件检索语义不可用时服务端自动关键词回退并置 degraded，两个入口都没说。
 * 统一口径收敛在 lib/search-degrade.ts，这里锁 helper 语义 + 两个组件的接线。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { searchChannelStatus } from "@/lib/search-degrade";

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  const candidates = [resolve(HERE, "..", "..", ".."), resolve(HERE, "..", "..")];
  const hit = candidates.find((p) => existsSync(join(p, "apps", "api", "src", "routes", "copilot.ts")));
  if (!hit) throw new Error("无法定位仓库根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = repoRoot();
const palette = readFileSync(join(ROOT, "apps/web-overlay/src/components/search-palette.tsx"), "utf8");
const spotlight = readFileSync(join(ROOT, "apps/web-overlay/src/components/search/spotlight-modal.tsx"), "utf8");

describe("searchChannelStatus：失败与语义回退是两件事", () => {
  it("degraded 兜底值 = 通道不可用，即使没有抛错", () => {
    const status = searchChannelStatus({
      sites: { degraded: true, semanticAvailable: false },
      plugins: null,
    });
    expect(status.sitesUnavailable).toBe(true);
    // 通道整个挂了时不再重复说「语义未就绪」——先报大的
    expect(status.semanticUnavailable).toBe(false);
  });

  it("语义未就绪只在通道正常但模型缺席时出现", () => {
    const status = searchChannelStatus({
      sites: { degraded: false, semanticAvailable: false },
      plugins: null,
    });
    expect(status.sitesUnavailable).toBe(false);
    expect(status.semanticUnavailable).toBe(true);
  });

  it("语义可用时两条提示都不出现", () => {
    const status = searchChannelStatus({
      sites: { degraded: false, semanticAvailable: true },
      plugins: { degraded: false, mode: "semantic" },
    });
    expect(status).toEqual({
      sitesUnavailable: false,
      semanticUnavailable: false,
      pluginUnavailable: false,
      pluginSemanticFallback: false,
    });
  });

  it("插件 keyword + degraded = 语义回退提示；semantic 模式不标", () => {
    expect(
      searchChannelStatus({ sites: null, plugins: { degraded: true, mode: "keyword" } }).pluginSemanticFallback,
    ).toBe(true);
    expect(
      searchChannelStatus({ sites: null, plugins: { degraded: false, mode: "semantic" } }).pluginSemanticFallback,
    ).toBe(false);
  });

  it("onDegraded 标记的请求失败优先于语义回退（不能把『没问到』说成『关键词结果』）", () => {
    const status = searchChannelStatus({
      sites: null,
      plugins: { degraded: true, mode: "keyword" },
      pluginsFailed: true,
    });
    expect(status.pluginUnavailable).toBe(true);
    expect(status.pluginSemanticFallback).toBe(false);
  });

  it("null 结果不产生语义结论（还没返回 ≠ 模型缺席）", () => {
    const status = searchChannelStatus({ sites: null, plugins: null });
    expect(status.sitesUnavailable).toBe(false);
    expect(status.semanticUnavailable).toBe(false);
    expect(status.pluginUnavailable).toBe(false);
    expect(status.pluginSemanticFallback).toBe(false);
  });
});

describe("两个入口用同一份判断", () => {
  it("Spotlight 读响应体的 degraded，而不是只监听 catch", () => {
    expect(spotlight).toMatch(/searchChannelStatus\(\{/);
    expect(spotlight).toMatch(/sites: sitesRes/);
  });

  it("Spotlight 用 onDegraded 标记插件请求失败", () => {
    expect(spotlight).toMatch(/searchPlugins\(\{ q: trimmed, limit: 3 \}, \(\) => \{/);
    expect(spotlight).toMatch(/pluginsFailed: pluginSearchFailed/);
  });

  it("SearchPalette 同样经 onDegraded + 统一口径", () => {
    expect(palette).toMatch(/searchPlugins\(\{ q, limit: 5 \}, \(\) => \{/);
    expect(palette).toMatch(/searchChannelStatus\(\{/);
    expect(palette).toMatch(/pluginsFailed: pluginRequestFailed/);
  });

  it("零结果文案区分「插件通道不可用」，不再冒充『没有匹配』", () => {
    expect(spotlight).toMatch(/插件检索通道本次不可用，无法确认插件市场有没有相关结果/);
    expect(spotlight).toMatch(/插件检索通道暂时不可用，以下只有站点结果/);
  });

  it("插件语义回退在结果区如实标注", () => {
    expect(palette).toMatch(/语义未就绪 · 关键词匹配/);
    expect(spotlight).toMatch(/语义未就绪 · 关键词匹配/);
  });

  it("站点语义未就绪在 Spotlight 也外显（不再只由 SearchPalette 提示）", () => {
    expect(spotlight).toMatch(/语义检索未就绪（未配置本地模型），当前为关键词 \/ 拼音 \/ 全文混合召回/);
  });
});
