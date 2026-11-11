/**
 * 冷启动基线导入（DEV_BACKLOG A1）。
 *
 * 锁的是三条纪律：
 *  1. 空库才灌：导航看站点数、视频看 KV 文档是否存在，各自独立设闸；
 *  2. 幂等：灌过之后再跑只跳过、不覆盖、不产生副本，运营改过的数据不动；
 *  3. 结论有账：每次检查都把结果写成 baseline-import.json 标记文档，
 *     文件缺失/导入失败如实记 status，不静默装作灌好了。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countNavigationDoc, runBaselineImport } from "../src/baseline.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { buildNavigationData, countVideoDocItems, readKv, readStoragePath, writeNavigationData } from "../src/storage.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-baseline-"));
const contentDir = join(dir, "content");
import { mkdirSync } from "node:fs";
mkdirSync(contentDir, { recursive: true });

const NAV_FIXTURE = {
  navigationItems: [
    {
      id: "reg-ai-tools",
      title: "AI 工具",
      enabled: true,
      subCategories: [
        {
          id: "reg-chat-assistants",
          title: "对话助手",
          parentId: "reg-ai-tools",
          enabled: true,
          items: [
            { id: "nav-fix-1", title: "示例甲", href: "https://example-a.com", description: "甲站", enabled: true, tags: ["对话"] },
            { id: "nav-fix-2", title: "示例乙", href: "https://example-b.com", description: "乙站", enabled: true, tags: [] },
          ],
        },
      ],
      items: [{ id: "nav-fix-3", title: "示例丙", href: "https://example-c.com", description: "丙站", enabled: true, tags: [] }],
    },
  ],
};

const VIDEOS_FIXTURE = {
  navigationItems: [
    {
      id: "cat_fix",
      title: "示例分类",
      enabled: true,
      items: [
        { id: "video_fix_1", title: "视频一", href: "https://www.bilibili.com/video/BV1fix1" },
        { id: "video_fix_2", title: "视频二", href: "https://www.bilibili.com/video/BV1fix2" },
      ],
      subCategories: [
        {
          id: "cat_fix_sub",
          title: "子分类",
          items: [{ id: "video_fix_3", title: "视频三", href: "https://www.bilibili.com/video/BV1fix3" }],
        },
      ],
    },
  ],
};

writeFileSync(join(contentDir, "navigation.json"), JSON.stringify(NAV_FIXTURE));
writeFileSync(join(contentDir, "videos.json"), JSON.stringify(VIDEOS_FIXTURE));

function makeCtx(dbName: string): Promise<AppContext> {
  return createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
      sqlitePath: join(dir, dbName),
      corsOrigins: ["*"],
    }),
  );
}

const prevBaselineDir = process.env.NAVHUB_BASELINE_DIR;
const prevBaselineImport = process.env.NAVHUB_BASELINE_IMPORT;

beforeAll(() => {
  process.env.NAVHUB_BASELINE_DIR = contentDir;
  delete process.env.NAVHUB_BASELINE_IMPORT;
});

afterAll(() => {
  if (prevBaselineDir === undefined) delete process.env.NAVHUB_BASELINE_DIR;
  else process.env.NAVHUB_BASELINE_DIR = prevBaselineDir;
  if (prevBaselineImport === undefined) delete process.env.NAVHUB_BASELINE_IMPORT;
  else process.env.NAVHUB_BASELINE_IMPORT = prevBaselineImport;
  rmSync(dir, { recursive: true, force: true });
});

describe("countNavigationDoc", () => {
  it("顶级 items 与二级 items 都计数，类目含两级", () => {
    expect(countNavigationDoc(NAV_FIXTURE)).toEqual({ categories: 2, sites: 3 });
    expect(countNavigationDoc(null)).toEqual({ categories: 0, sites: 0 });
    expect(countNavigationDoc({})).toEqual({ categories: 0, sites: 0 });
  });
});

describe("runBaselineImport：空库导入与幂等", () => {
  let ctx: AppContext;
  beforeAll(async () => {
    ctx = await makeCtx("fresh.db");
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("空库首次：导航与视频都导入，条数与文件一致", async () => {
    const result = await runBaselineImport(ctx, () => undefined, { dirs: [contentDir] });
    expect(result.navigation.status).toBe("imported");
    expect(result.navigation.count).toBe(3);
    expect(result.navigation.categories).toBe(2);
    expect(result.videos.status).toBe("imported");
    expect(result.videos.count).toBe(3);
    expect(result.markerWritten).toBe(true);

    // 注意：快照总类目数不做精确断言——createContext 的迁移会先行补入几个
    // 分类法类目（如 reg-prompt-engineering），那是既有行为、与基线无关；
    // 基线要钉住的是「文件里的类目与站点都真进了库」。
    const snapshot = await buildNavigationData(ctx);
    expect(countNavigationDoc(snapshot).sites).toBe(3);
    const aiTools = (snapshot.navigationItems ?? []).find((c: any) => c.id === "reg-ai-tools") as any;
    expect(aiTools).toBeTruthy();
    expect((aiTools.items ?? []).map((i: any) => i.id)).toContain("nav-fix-3");
    const chatSub = (aiTools.subCategories ?? []).find((c: any) => c.id === "reg-chat-assistants") as any;
    expect((chatSub?.items ?? []).map((i: any) => i.id).sort()).toEqual(["nav-fix-1", "nav-fix-2"]);
    const videos = await readKv(ctx, "videos");
    expect(countVideoDocItems(videos)).toBe(3);
  });

  it("结论标记落库且口径一致", async () => {
    const marker = (await readStoragePath(ctx, "baseline-import.json")) as any;
    expect(marker?.navigation?.status).toBe("imported");
    expect(marker?.videos?.status).toBe("imported");
    expect(marker?.videos?.count).toBe(3);
  });

  it("再跑一次：全部跳过，条数不变、不产生副本", async () => {
    const result = await runBaselineImport(ctx, () => undefined, { dirs: [contentDir] });
    expect(result.navigation.status).toBe("skipped_existing");
    expect(result.navigation.count).toBe(3);
    expect(result.videos.status).toBe("skipped_existing");
    expect(result.videos.count).toBe(3);

    const snapshot = await buildNavigationData(ctx);
    expect(countNavigationDoc(snapshot).sites).toBe(3);
  });
});

describe("runBaselineImport：已有数据的库只跳过导航、视频照常", () => {
  let ctx: AppContext;
  beforeAll(async () => {
    ctx = await makeCtx("existing.db");
    // 模拟运营已手工维护的库：先经正规通道写一个站进去
    await writeNavigationData(ctx, {
      navigationItems: [
        {
          id: "reg-ops",
          title: "运营类目",
          enabled: true,
          items: [{ id: "ops-1", title: "运营站", href: "https://ops.example.com", description: "运营手工维护", enabled: true, tags: [] }],
        },
      ],
    } as never);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("导航 skipped_existing 且原数据不被基线覆盖", async () => {
    const result = await runBaselineImport(ctx, () => undefined, { dirs: [contentDir] });
    expect(result.navigation.status).toBe("skipped_existing");
    expect(result.navigation.count).toBe(1);
    expect(result.videos.status).toBe("imported");

    const snapshot = await buildNavigationData(ctx);
    const counts = countNavigationDoc(snapshot);
    expect(counts.sites).toBe(1);
    const titles = (snapshot.navigationItems ?? []).map((c: any) => c.title);
    expect(titles).toContain("运营类目");
  });
});

describe("runBaselineImport：基线文件缺失时如实记账、不抛错", () => {
  let ctx: AppContext;
  const emptyDir = join(dir, "empty-content");
  mkdirSync(emptyDir, { recursive: true });

  beforeAll(async () => {
    process.env.NAVHUB_BASELINE_DIR = emptyDir;
    ctx = await makeCtx("missing.db");
  });
  afterAll(async () => {
    process.env.NAVHUB_BASELINE_DIR = contentDir;
    await ctx.close();
  });

  it("两份都记 missing_file，库保持空", async () => {
    const result = await runBaselineImport(ctx, () => undefined, { dirs: [emptyDir] });
    expect(result.navigation.status).toBe("missing_file");
    expect(result.videos.status).toBe("missing_file");
    const snapshot = await buildNavigationData(ctx);
    expect(countNavigationDoc(snapshot).sites).toBe(0);
    expect(await readKv(ctx, "videos")).toBeNull();
  });
});
