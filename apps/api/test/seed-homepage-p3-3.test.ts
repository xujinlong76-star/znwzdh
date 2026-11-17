/**
 * P3-3（2026-11-18）：种子插件官网覆盖率防回归。
 *
 * 背景：42 条种子插件作者全是「山羊胡官方」（站内原创），移植类主题 4 条
 * 早有上游官网（Nord / Gruvbox / Catppuccin / Dracula），其余 38 条
 * 无第三方官网可填。本轮给其中 33 条（主题 10 + 预设 8 + 组合包 15）
 * 补了作者官网 https://www.shanyanghu.com/（2026-11-18 curl 实测 200，
 * 返回山羊胡网真实首页），覆盖率 4/42 → 37/42。
 *
 * 尾巴（2026-11-18）：剩余 5 条搜索包（cn / academic / dev / ai-deep /
 * code-search）已补同一作者官网（P3-1/P3-2 提交落地后补，curl 复核
 * https://www.shanyanghu.com/ 200、0 跳转），覆盖率 37/42 → 42/42，
 * 豁免清单随之撤掉——此后任一 42 条种子缺 homepage 即红灯。
 *
 * 截图与捐赠链接本轮 0 条：站内无真实官方截图文件、作者无公开捐赠
 * 链接，图标铁律同样适用——没有真实图/真实链接就不硬补，不编造。
 * 因此这里不锁 screenshots / donateUrl 为 0（以后作者提交真实
 * 截图/捐赠链接时应能加上），只锁 homepage 的真实性与覆盖率。
 */
import { describe, expect, it } from "vitest";
import {
  validateAndCleanPluginManifest,
  type PluginManifest,
} from "@navhub/core";
import { seedPluginDefs } from "../src/seed-plugins.ts";

/** 作者官网：唯一真实、可达的站内原创插件主页（curl 200 已验证） */
const SITE_HOMEPAGE = "https://www.shanyanghu.com/";

function collectValidated(): { slug: string; manifest: PluginManifest }[] {
  const items: { slug: string; manifest: PluginManifest }[] = [];
  for (const def of seedPluginDefs()) {
    const result = validateAndCleanPluginManifest(def.manifest);
    expect(
      result.ok,
      `${def.slug}: 清单未通过 core 校验：${result.ok ? "" : result.errors.join("; ")}`,
    ).toBe(true);
    if (result.ok) items.push({ slug: def.slug, manifest: result.manifest });
  }
  return items;
}

describe("P3-3：种子插件官网覆盖率", () => {
  it("全部 42 条种子有 homepage（无豁免）", () => {
    const missing: string[] = [];
    for (const { slug, manifest } of collectValidated()) {
      if (!manifest.homepage) missing.push(slug);
    }
    expect(missing, `以下种子缺 homepage：${missing.join(", ")}`).toEqual([]);
  });

  it("全部已填 homepage 均为 https 绝对地址，且站内原创插件指向作者官网", () => {
    const bad: string[] = [];
    for (const { slug, manifest } of collectValidated()) {
      const homepage = manifest.homepage;
      if (!homepage) continue;
      if (!/^https:\/\//.test(homepage)) bad.push(`${slug}: ${homepage}`);
      // 4 条移植类主题保留上游官网；其余站内原创插件只认作者官网，不认编造地址
      const upstream = new Set([
        "nord-frost",
        "gruvbox-retro",
        "catppuccin-mocha",
        "dracula-dark",
      ]);
      if (!upstream.has(slug) && homepage !== SITE_HOMEPAGE) {
        bad.push(`${slug}: 非上游主题却未指向作者官网：${homepage}`);
      }
    }
    expect(bad, `homepage 不合规：\n${bad.join("\n")}`).toEqual([]);
  });

  it("homepage 覆盖率 42/42（只许升不许降）", () => {
    const items = collectValidated();
    const covered = items.filter((i) => Boolean(i.manifest.homepage)).length;
    expect(covered).toBe(42);
    expect(items.length).toBe(42);
  });
});
