/**
 * 插件网址智能体检与 AI 自愈指挥台组件契约测试。
 *
 * 验证以下核心升级能力：
 * 1. 一键全量与增量智能体检工作台与队列编排（流式进度条与取消机制）
 * 2. 批量历史快照秒级预载（/plugins/url-health/summary）
 * 3. 6 维全局实时指标大盘（已体检、累计抽样、真健康、WAF拦截、疑似停放、死链）
 * 4. L2 内容级防劫持探针集成（Shannon 信息熵、停放词、软 404）
 * 5. L3 后端 AI 模型平替与 Wayback 时光机快照自愈
 * 6. 一键净网死链剔除与 Manifest 更新闭环（/apply-health-fix）
 * 7. JSON 与 Markdown 体检快照报告导出
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

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

function readOverlay(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error("文件不存在: " + p);
  return readFileSync(p, "utf8");
}

describe("PluginUrlHealthPanel 智能体检指挥台组件契约", () => {
  const code = readOverlay("src/components/plugins/plugin-url-health-panel.tsx");

  it("声明为 use client 客户端组件并正确导出主要接口与组件", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("export function PluginUrlHealthPanel");
    expect(code).toContain("export interface SitePackListItem");
    expect(code).toContain("export interface HistoricalSummary");
    expect(code).toContain("export interface AuditResult");
    expect(code).toContain("export interface AiHealResult");
  });

  it("具备批量历史快照秒级预载（/plugins/url-health/summary）", () => {
    expect(code).toContain("/plugins/url-health/summary");
    expect(code).toContain("setHistory(summaryRes.value.summaries)");
  });

  it("支持三档抽样深度切换（15条快速 / 30条标准 / 100条全量）", () => {
    expect(code).toContain("value={15}");
    expect(code).toContain("快速抽样 (15条/包)");
    expect(code).toContain("value={30}");
    expect(code).toContain("标准体检 (30条/包)");
    expect(code).toContain("value={100}");
    expect(code).toContain("全量深度 (100条/包)");
  });

  it("具备一键全量体检与仅体检异常/未测队列编排", () => {
    expect(code).toContain("startBatchAudit(packs)");
    expect(code).toContain("startBatchAudit(issueAndUntestedPacks)");
    expect(code).toContain("stopBatch");
    expect(code).toContain("cancelBatchRef.current = true");
  });

  it("展示 6 维全局实时指标大盘", () => {
    expect(code).toContain("已体检包数");
    expect(code).toContain("累计抽样 URL");
    expect(code).toContain("真健康站点");
    expect(code).toContain("WAF 拦截放行");
    expect(code).toContain("疑似停放/软404");
    expect(code).toContain("确认死链");
  });

  it("展示 L2 内容级防劫持告警（停放黑词、Shannon 信息熵与标题）", () => {
    expect(code).toContain("L2 内容级防劫持告警");
    expect(code).toContain("shannonEntropy");
    expect(code).toContain("matchedKeywords");
    expect(code).toContain("suspiciousItems");
  });

  it("集成 L3 后端 AI 模型平替与 Wayback 时光机历史镜像", () => {
    expect(code).toContain("L3 后端 AI 模型平替与时光机自愈引擎");
    expect(code).toContain("runAiHeal");
    expect(code).toContain("/ai-heal");
    expect(code).toContain("时光机历史快照 ↗");
    expect(code).toContain("suggestedReplacements");
    expect(code).toContain("采纳平替");
  });

  it("支持一键净网修复剔除死链并持久化更新 Manifest", () => {
    expect(code).toContain("一键净网剔除死链");
    expect(code).toContain("applyHealthFix");
    expect(code).toContain("/apply-health-fix");
  });

  it("支持 JSON 与 Markdown 体检快照报告导出", () => {
    expect(code).toContain("exportReport('json')");
    expect(code).toContain("exportReport('md')");
    expect(code).toContain("navhub-plugin-health-report");
  });

  it("支持傻瓜式一键全自动体检并采纳所有最优平替（无确认弹窗直通执行）", () => {
    expect(code).toContain("startBatchAutoHeal");
    expect(code).toContain("runAutoHealPack");
    expect(code).toContain("autoApply: true");
    expect(code).toContain("markPackUrlsHealed");
    expect(code).not.toContain("pendingBatchReplacement");
    expect(code).not.toContain("pendingReplacement");
    expect(code).not.toContain("pendingRemove");
  });
});

describe("AdminPluginHealthPage 管理页面契约", () => {
  const code = readOverlay("src/app/admin/plugin-health/page.tsx");

  it("正确引用 PluginUrlHealthPanel 并展示升级后的标题与简介", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("插件网址智能体检与 AI 自愈");
    expect(code).toContain("<PluginUrlHealthPanel />");
  });
});
