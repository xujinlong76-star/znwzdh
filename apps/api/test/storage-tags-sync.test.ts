/**
 * 快照导入的标签同步（2026-11-10 审计修复）：
 * SnapshotSiteWrite 刻意不带 tags，旧实现于是让新导入站点永远无标签、
 * 文件里改标签永不生效——搜索标签通道与相似推荐对这批站点恒哑。
 * 本测试钉住新行为：
 *  1. 整包写入时，文件里的 tags 真落库；
 *  2. 只改标签（其他字段不变）再写，标签跟着变；
 *  3. 标签不变时重复写入不产生额外标签抖动（结果稳定）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { writeNavigationData } from "../src/storage.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-storage-tags-"));
let ctx: AppContext;

function snapshot(tagsA: string[], tagsB: string[]) {
  return {
    navigationItems: [
      {
        id: "cat-tags",
        title: "标签测试类目",
        items: [
          { id: "site-a", title: "站点甲", href: "https://a-tags.example.com", description: "甲", enabled: true, tags: tagsA },
          { id: "site-b", title: "站点乙", href: "https://b-tags.example.com", description: "乙", enabled: true, tags: tagsB },
        ],
      },
    ],
  } as never;
}

async function tagsOf(id: string): Promise<string[]> {
  const site = await ctx.repo.getSite(id);
  return [...(site?.tags ?? [])].sort();
}

beforeAll(async () => {
  ctx = await createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
      sqlitePath: join(dir, "tags.db"),
      corsOrigins: ["*"],
    }),
  );
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("writeNavigationData 标签同步", () => {
  it("首次整包写入：文件标签落库", async () => {
    await writeNavigationData(ctx, snapshot(["短剧", "免费"], ["ai", "视频"]));
    expect(await tagsOf("site-a")).toEqual(["免费", "短剧"]);
    expect(await tagsOf("site-b")).toEqual(["ai", "视频"]);
  });

  it("只改标签再写：标签生效（旧实现永远不生效）", async () => {
    await writeNavigationData(ctx, snapshot(["短剧", "高清"], ["ai", "视频"]));
    expect(await tagsOf("site-a")).toEqual(["短剧", "高清"]);
    expect(await tagsOf("site-b")).toEqual(["ai", "视频"]);
  });

  it("原样再写：标签稳定不抖动", async () => {
    await writeNavigationData(ctx, snapshot(["短剧", "高清"], ["ai", "视频"]));
    expect(await tagsOf("site-a")).toEqual(["短剧", "高清"]);
    expect(await tagsOf("site-b")).toEqual(["ai", "视频"]);
  });
});
