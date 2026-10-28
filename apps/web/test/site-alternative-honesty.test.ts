/**
 * 「AI 平替推荐」的诚实面守卫：后端实测出来的档位必须在界面上说得出、拦得住。
 *
 * 缺陷形态（[AI-4b] 修复前）：`/api/sites/:id/recommend-alternative` 一个探活请求都不发，
 * 模型说「知名度高、稳定可用」就当作证据返回，界面照样给一枚「一键平替」按钮 ——
 * 停放页、拼错的域名、已下线的官网都能被一键写进 `sites` 并置为 active。
 * 插件体检那条链路早就修过同样的亏（先实测再推荐），但修法留在了插件文件里，
 * 普通站点这条更常用的路没享受到。
 *
 * 本测试锁四件事，缺一件就退回「模型说什么就渲染什么」：
 *  1. 契约里有档位与实测读数（不是只有 title/url/reason 三件套）；
 *  2. 后端能给出的每一档在前端都有对应说明 —— 用「从契约解析档位」而不是写死两份，
 *     这样将来 core 新增档位而 UI 忘了处理时会变红，而不是静默渲染成空白徽章；
 *  3. 实测确认不可用的档位**拦得住**：按钮禁用 + 处理函数二次早退（禁用只防手滑）；
 *  4. 「没测准」不等于「已死」：blocked / unverified 仍可采纳，但必须带人工复核提示，
 *     而完全没实测过的候选（报告自带的建议替换）不许冒充「已验证」。
 *
 * 只锁出口与接线，不锁像素。每条断言都指定了让它变红的消融。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 真源永远是 apps/web-overlay：镜像到 apps/web 只为了被 vitest 跑到 */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const api = readFileSync(join(ROOT, "src/lib/navhub-api.ts"), "utf8");
const modal = readFileSync(join(ROOT, "src/components/ai/site-health-audit-modal.tsx"), "utf8");

/** 取 `recommendSiteAlternatives` 的函数体（到下一个顶层 export 为止），避免匹配到别处的同名调用 */
function recommendFnBody(src: string): string {
  const marker = "export async function recommendSiteAlternatives";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("navhub-api.ts 里找不到 recommendSiteAlternatives");
  const rest = src.slice(start + marker.length);
  const end = rest.search(/\nexport (async function|function|const|interface|type) /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** 契约里声明的档位全集：从源码解析，不在此处复制一份字面量 */
function gradesFromContract(src: string): string[] {
  const m = src.match(/export type HubCandidateGrade = ([^\n]+)/);
  if (!m) throw new Error("navhub-api.ts 里找不到 HubCandidateGrade 档位契约");
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
}

/** 拆出 GRADE_META 里每一档的定义块，供「这一档能不能采纳」逐档断言 */
function gradeMetaBlocks(src: string): Record<string, string> {
  const start = src.indexOf("const GRADE_META: Record<HubCandidateGrade,");
  if (start < 0) throw new Error("site-health-audit-modal.tsx 里找不到 GRADE_META 档位说明表");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end < 0 ? src.length : end);
  const keys = [...body.matchAll(/^ {2}(\w+): \{/gm)].map((m) => ({ name: m[1], at: m.index as number }));
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    out[k.name] = body.slice(k.at, i + 1 < keys.length ? keys[i + 1].at : body.length);
  });
  return out;
}

const CONTRACT_GRADES = gradesFromContract(api);

/** 从档位定义块里取出面向运营的措辞 */
function labelOf(block: string): string {
  const m = block.match(/label: '([^']+)'/);
  if (!m) throw new Error("档位定义里没有 label 字段");
  return m[1];
}

/** 候选卡片的源码区间：从 map 开始到「一键平替」按钮的 disabled 为止 */
function candidateCard(src: string): string {
  const start = src.indexOf("currentAlts.map(");
  const end = src.indexOf("disabled={!adoptable || healingId === issue.siteId}");
  if (start < 0 || end < 0 || end < start) throw new Error("定位不到候选卡片源码区间");
  return src.slice(start, end);
}

describe("契约层：候选必须带实测档位与读数", () => {
  it("五种档位都在契约里，且前端说明表逐档覆盖", () => {
    expect(new Set(CONTRACT_GRADES)).toEqual(new Set(["verified", "blocked", "unverified", "suspicious", "dead"]));
    const meta = gradeMetaBlocks(modal);
    // 契约新增档位而 UI 没处理 ⇒ 这里变红（而不是渲染出一枚空白徽章）
    expect(Object.keys(meta).sort()).toEqual([...CONTRACT_GRADES].sort());
  });

  it("候选条目暴露档位、原因、耗时与可信度分解", () => {
    const iface = api.slice(api.indexOf("export interface HubSiteAlternative"), api.indexOf("export interface HubSiteAlternativesResult"));
    for (const field of ["grade?", "gradeReason?", "verified?", "latencyMs?", "confidence?", "source?"]) {
      expect(iface, `HubSiteAlternative 缺少 ${field}`).toContain(field);
    }
    // 可信度必须是可追溯的分解，而不是一个无法解释的总分
    const confidence = api.slice(api.indexOf("export interface HubCandidateConfidence"), api.indexOf("export interface HubSiteAlternative"));
    for (const field of ["total", "reachability", "contentHealth", "domainFit"]) {
      expect(confidence, `HubCandidateConfidence 缺少 ${field}`).toContain(field);
    }
  });

  it("响应带整批实测读数，且不再用只有三件套的内联类型糊过去", () => {
    const result = api.slice(api.indexOf("export interface HubSiteAlternativesResult"), api.indexOf("export async function recommendSiteAlternatives"));
    expect(result).toContain("recommendations: HubSiteAlternative[]");
    expect(result).toContain("probe?: HubCandidateProbeSummary");
    const summary = api.slice(api.indexOf("export interface HubCandidateProbeSummary"), api.indexOf("export interface HubSiteAlternativesResult"));
    for (const field of ["checked", "verified", "unreachable", "inconclusive", "pending", "budgetMs", "hasVerified", "caveat"]) {
      expect(summary, `HubCandidateProbeSummary 缺少 ${field}`).toContain(field);
    }
    // 旧形态：函数里自带一份 `Array<{ title; url; reason }>` —— 那正是「没有档位可挂」的结构
    const body = recommendFnBody(api);
    expect(body).not.toMatch(/Array<\{\s*title/);
    expect(body).toContain("Promise<HubSiteAlternativesResult>");
  });
});

describe("界面层：档位说得出、拦得住", () => {
  it("实测确认不可用的两档禁止采纳，可达的一档允许", () => {
    const meta = gradeMetaBlocks(modal);
    for (const grade of ["dead", "suspicious"]) {
      expect(meta[grade], `档位 ${grade} 缺定义`).toContain("adoptable: false");
    }
    for (const grade of ["verified", "blocked", "unverified"]) {
      expect(meta[grade], `档位 ${grade} 缺定义`).toContain("adoptable: true");
    }
  });

  it("「没测准」不许渲染成「已失效」：blocked/unverified 用慢≠死口径并保留人工复核提示", () => {
    const meta = gradeMetaBlocks(modal);
    expect(meta.unverified).toContain("慢 ≠ 死");
    expect(labelOf(meta.unverified)).not.toMatch(/不可达|已失效|已死/);
    expect(meta.blocked).toContain("人工");
    // 禁止采纳的两档必须给出「为什么拦」，而不是只把按钮变灰
    for (const grade of ["dead", "suspicious"]) {
      expect(meta[grade]).toMatch(/hint: '[^']+'/);
    }
  });

  it("禁用真的接到档位，且处理函数二次早退", () => {
    expect(modal).toMatch(/const adoptable = !meta \|\| meta\.adoptable/);
    const btnStart = modal.indexOf("disabled={!adoptable || healingId === issue.siteId}");
    expect(btnStart).toBeGreaterThan(-1);
    // 禁用挂在「一键平替」这枚按钮上，不是别的按钮
    expect(modal.indexOf("一键平替")).toBeGreaterThan(btnStart);
    const handler = modal.slice(modal.indexOf("const handleApplyAlternative"), modal.indexOf("const handleFetchAiAlternatives"));
    expect(handler).toContain("if (meta && !meta.adoptable)");
    expect(handler).toMatch(/toast\.error\([^)]*不能直接采纳/);
    // 早退必须在真正发起写库请求之前
    expect(handler.indexOf("return")).toBeLessThan(handler.indexOf("applySiteHealingAction"));
  });

  it("整批实测读数与口径声明随列表渲染，不只在 toast 里一闪而过", () => {
    expect(modal).toContain("实测读数：");
    expect(modal).toContain("{currentProbe.caveat}");
    expect(modal).toContain("const currentProbe = altProbes[issue.siteId]");
    // 读数只在「本轮实测过」时出现：报告自带的建议替换不能借用别轮结论
    expect(modal).toContain("{currentProbe && (");
    expect(modal.indexOf("const currentProbe")).toBeLessThan(modal.indexOf("{currentProbe && ("));
  });

  it("每条候选给出实测依据与可点开的 URL，供人工复核", () => {
    const card = candidateCard(modal);
    expect(card).toContain("实测依据：{alt.gradeReason}");
    expect(card).toContain("href={safeHref(alt.url");
    expect(card).toContain('rel="noopener noreferrer"');
  });

  it("未实测的候选标注「未实测」，不冒充已验证", () => {
    const card = candidateCard(modal);
    expect(card).toContain("{meta ? meta.label : '未实测'}");
    // 缺省档位时不给「实测可达」那套绿/红样式，也不带 hint
    expect(card).toMatch(/meta \? meta\.tone : '[^']*muted/);
    expect(card).toContain("{meta?.hint &&");
  });

  it("降级列表的来源说明带上实测读数；模型候选全数不通过时不许报成功", () => {
    const handler = modal.slice(modal.indexOf("const handleFetchAiAlternatives"), modal.indexOf("if (!open) return null"));
    expect(handler).toContain("setAltProbes");
    // 兜底/额度降级：notice 后面必须拼上读数，否则「同分类兜底」会被读成「AI 精选平替 + 都测过了」
    expect(handler).toMatch(/\$\{notice\} \$\{probeLine\}/);
    // 模型参与但一条都没测通：warning 而非 success
    expect(handler).toMatch(/if \(probe && !probe\.hasVerified\) \{\s*\n\s*toast\.warning/);
    expect(handler).toContain("本轮未实测，采纳前请人工打开确认");
  });
});
