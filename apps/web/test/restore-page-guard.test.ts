/**
 * /admin/data/restore 的结构守卫。
 *
 * 这个页面补的是一个长期缺口（恢复此前只能手工 curl），所以守卫的重点不是
 * 视觉细节，而是**三条一旦丢失就会造成真实损害的行为**：
 *
 *   1. 必须有「预演 → 确认 → 执行」三段，不能一步到位。
 *      恢复是整库写操作，直接给一个「一键恢复」按钮，误触的代价太大。
 *   2. 执行必须以 `dryRun=false` 调用、预演必须以 `dryRun=true` 调用——
 *      写反了就是「点了预演结果真写了库」，而界面上看不出来。
 *   3. 失败态要如实说明「已整体回滚」并给出原因类别，不能只说「操作失败」。
 *
 * 为什么不做 E2E：这三条都是字符串级事实，秒级可查；真跑一遍要起整套开发栈
 * （约 3 分钟），留给 CI 的既有 E2E 套件即可。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const PAGE_PATH = "src/app/admin/data/restore/page.tsx";
const PAGE = overlaySource(PAGE_PATH);

describe("恢复页面：结构与端点契约", () => {
  it("是客户端组件（要读本地文件与状态）", () => {
    expect(PAGE.startsWith("'use client'")).toBe(true);
  });

  it("预演走 dryRun=true，执行走 dryRun=false（写反等于预演就落库）", () => {
    expect(PAGE).toContain("/api/backup/restore?dryRun=true");
    expect(PAGE).toContain("/api/backup/restore?dryRun=false");
    // 两个端点各出现一次，且 dryRun=false 只能在 runRestore 里
    expect(PAGE.match(/dryRun=true/g)?.length).toBe(1);
    expect(PAGE.match(/dryRun=false/g)?.length).toBe(1);
  });

  it("执行前必须有勾选确认，且确认状态参与按钮可用性判断", () => {
    expect(PAGE).toContain('id="confirm-restore"');
    expect(PAGE).toContain("canRestore");
    expect(PAGE).toMatch(/const canRestore = Boolean\(backup && preview && confirmed\)/);
  });

  it("文件输入与确认框都有可访问名关联（field-names 守卫的同一口径）", () => {
    expect(PAGE).toContain('htmlFor="backup-file"');
    expect(PAGE).toContain('id="backup-file"');
    expect(PAGE).toContain('htmlFor="confirm-restore"');
  });

  it("失败态如实说明「已整体回滚」，并把 reason 类别翻成人话", () => {
    expect(PAGE).toContain("已整体回滚");
    expect(PAGE).toContain("REASON_TEXT");
    expect(PAGE).toContain("duplicate_key");
    expect(PAGE).toContain("foreign_key");
    // 错误必须落在 role=alert 上，读屏用户才能被通知
    expect(PAGE).toMatch(/role="alert"/);
  });

  it("成功态展示耗时与索引补齐状态（这两个字段是新加的可观测面）", () => {
    expect(PAGE).toContain("durationMs");
    expect(PAGE).toContain("reindexQueued");
  });

  it("大包给超时提示，并说明恢复幂等（重试会跳过已导入）", () => {
    expect(PAGE).toContain("5000");
    expect(PAGE).toContain("幂等");
  });
});
