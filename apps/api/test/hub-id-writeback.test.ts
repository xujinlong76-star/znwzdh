/**
 * hubId 写回回归门禁（03 §2.3 步骤 5、§9 第 3 条）。
 *
 * NavSphere 写回是整包覆盖：前端把 navigation.json 整体 PUT 回来，
 * writeNavigationData 全量对齐进库，读回（buildNavigationData /
 * readStoragePath raw 视图）再拼回快照。写回逻辑丢字段即丢映射——
 * 测试失败即修写回逻辑，不接受「丢字段但先上线」。
 *
 * 实测根因（W2b，2026-11-20）：snapshotSiteWrite 只把 id/url/title 等写进
 * 站点行，读回的 toItem 也不出 hubId —— 写回一轮即丢映射。修法：
 * 情况一 hubId = id（W1 实测），站点行 id 本身就是 hubId，读回由行 id 派生，
 * 不新增列、不改写路径。以下测试锁的就是这条派生语义。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { buildNavigationData, readStoragePath, writeNavigationData } from "../src/storage.ts";
import { slimNavigationItem } from "../src/navigation-shards.ts";

function collectHubIds(doc: { navigationItems: Array<Record<string, unknown>> }): Array<{ id: string; hubId: unknown }> {
  const out: Array<{ id: string; hubId: unknown }> = [];
  for (const cat of doc.navigationItems) {
    for (const item of (cat.items as Array<Record<string, unknown>>) ?? []) {
      out.push({ id: item.id as string, hubId: item.hubId });
    }
    for (const sub of (cat.subCategories as Array<Record<string, unknown>>) ?? []) {
      for (const item of (sub.items as Array<Record<string, unknown>>) ?? []) {
        out.push({ id: item.id as string, hubId: item.hubId });
      }
    }
  }
  return out;
}

describe("hubId 写回回归（整包覆盖写回再读回）", () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-hub-id-writeback-"));
  let ctx: AppContext;

  // 顶级条目 + 子分类条目各一，含 1 条 16 位 hex id（Portainer）
  const docV1 = {
    navigationItems: [
      {
        id: "cat-hub",
        title: "Hub 测试类",
        items: [{ id: "nav-da02af4f6414", title: "ChatGPT", href: "https://chatgpt.com", enabled: true, hubId: "nav-da02af4f6414" }],
        subCategories: [
          {
            id: "sub-hub",
            title: "Hub 测试子类",
            parentId: "cat-hub",
            enabled: true,
            items: [{ id: "nav-037d194bcc9a5df7", title: "Portainer", href: "https://www.portainer.io", enabled: true, hubId: "nav-037d194bcc9a5df7" }],
          },
        ],
      },
    ],
    replacementHistory: [],
  };

  beforeAll(async () => {
    ctx = await createContext(
      loadConfig({
        mode: "lite" as const,
        embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
        sqlitePath: join(dir, "hub-id.db"),
        corsOrigins: ["*"],
      }),
    );
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("整包写回再读回：全部条目 hubId 原样保留（hubId = id）", async () => {
    await writeNavigationData(ctx, docV1 as never);
    const back = await buildNavigationData(ctx);
    const pairs = collectHubIds(back as never);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.hubId, `${p.id} 写回后 hubId 丢失`).toBe(p.id);
    }
  });

  it("经 /api/storage 读路径（raw 视图）同样保留 hubId", async () => {
    const back = (await readStoragePath(ctx, "src/navsphere/content/navigation.json", { view: "raw" })) as {
      navigationItems: Array<Record<string, unknown>>;
    };
    const pairs = collectHubIds(back);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.hubId, `${p.id} 读路径 hubId 丢失`).toBe(p.id);
    }
  });

  it("旧客户端写回（输入不带 hubId）：读回仍由行 id 派生 hubId，不丢映射", async () => {
    const legacy = structuredClone(docV1);
    for (const cat of legacy.navigationItems) {
      for (const item of cat.items ?? []) delete (item as Record<string, unknown>).hubId;
      for (const sub of cat.subCategories ?? []) {
        for (const item of sub.items ?? []) delete (item as Record<string, unknown>).hubId;
      }
    }
    await writeNavigationData(ctx, legacy as never);
    const back = await buildNavigationData(ctx);
    const pairs = collectHubIds(back as never);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.hubId, `${p.id} 旧客户端写回后 hubId 丢失`).toBe(p.id);
    }
  });
});

describe("slimNavigationItem：hubId 进白名单（03 §2.3 步骤 2）", () => {
  it("带 hubId 的条目瘦身后仍含 hubId（放 health 之前）", () => {
    const out = slimNavigationItem({
      id: "nav-da02af4f6414",
      title: "ChatGPT",
      href: "https://chatgpt.com",
      description: "AI 对话",
      hubId: "nav-da02af4f6414",
      health: { ok: true, httpStatus: 200 },
      weight: 999,
    });
    expect(out.hubId).toBe("nav-da02af4f6414");
    expect(out.health).toEqual({ ok: true, httpStatus: 200 });
    // 重字段仍被裁掉
    expect(out.weight).toBeUndefined();
    // 字段顺序：hubId 在 health 之前（与 RENDER_ITEM_FIELDS 白名单一致）
    const keys = Object.keys(out);
    expect(keys.indexOf("hubId")).toBeLessThan(keys.indexOf("health"));
  });

  it("无 hubId 的条目瘦身后不硬造该字段", () => {
    const out = slimNavigationItem({ id: "nav-aaaaaaaaaaaa", title: "示例", href: "https://example.com/" });
    expect(out.hubId).toBeUndefined();
    expect("hubId" in out).toBe(false);
  });
});
