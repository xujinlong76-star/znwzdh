/**
 * `user_data_audit` 每日巡检的站点侧核对（2026-10-24 增补）。
 *
 * 巡检的价值在于「只报不动」：它不修数据，只把看不出来的问题变成可查询的审计。
 * 新增的三项都指向同一类静默后果——
 *
 * - `orphanSiteTags`：site_tags 指向已不存在的站点或标签。批量写入时标签解析失败、
 *   或站点被物理清理但关联表漏删，都会留下悬空行。页面照常渲染，只是类目页缺条目。
 * - `sitesMissingEmbedding` / `orphanEmbeddings`：向量缺口与残留。备份恢复只写
 *   sites/site_tags，不建向量，所以「恢复完立刻搜」时语义通道是空的。
 *
 * 向量两项只在启用本地 embedding 时统计（lite 默认关闭，关闭时「每条都缺」是
 * 预期状态，报出来就是每日噪音）。因为测试环境不加载模型，本文件只覆盖
 * `orphanSiteTags` 与「向量项确实被跳过」两件事。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-user-audit-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "audit.db"),
      // 显式关闭本地向量：本文件要验证「关闭时不报向量项」这条降噪逻辑
      embedding: {
        model: "Xenova/bge-small-zh-v1.5",
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      corsOrigins: ["*"],
    }),
  );
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function lastAuditDiff(): Promise<Record<string, unknown>> {
  const rows = await ctx.repo.raw(
    "SELECT diff FROM audit_logs WHERE action = 'user_data.audit' ORDER BY created_at DESC LIMIT 1",
  );
  return JSON.parse(String(rows[0]?.diff ?? "{}"));
}

describe("user_data_audit 巡检", () => {
  it("报出悬空 site_tags，且不修改数据", async () => {
    await ctx.repo.run("DELETE FROM audit_logs");
    // 直接造一条悬空关联：站点与标签都不存在
    await ctx.repo.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?, ?)", [
      "ghost-site-未存在",
      "ghost-tag-未存在",
    ]);
    const before = await ctx.repo.raw("SELECT COUNT(*) AS c FROM site_tags WHERE site_id = ?", ["ghost-site-未存在"]);

    const runner = new JobRunner(ctx, { enableCron: false });
    await ctx.repo.enqueueJob("user_data_audit", {});
    await runner.tick();

    const diff = await lastAuditDiff();
    expect(Number(diff.orphanSiteTags ?? 0)).toBeGreaterThanOrEqual(1);
    // 只报不动：巡检跑完那条悬空行还在
    const after = await ctx.repo.raw("SELECT COUNT(*) AS c FROM site_tags WHERE site_id = ?", ["ghost-site-未存在"]);
    expect(Number(after[0]!.c)).toBe(Number(before[0]!.c));
  });

  it("未启用 embedding 时不报向量项（避免每日噪音）", async () => {
    const diff = await lastAuditDiff();
    expect(diff.sitesMissingEmbedding).toBeUndefined();
    expect(diff.orphanEmbeddings).toBeUndefined();
    // 原有的两项仍必须在（回归：新增指标不能挤掉旧指标）
    expect(typeof diff.danglingFolderRefs).toBe("number");
    expect(typeof diff.favoritesMissingSite).toBe("number");
  });
});
