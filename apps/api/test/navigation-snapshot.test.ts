/**
 * navigation.json 快照层的回归测试。
 *
 * 快照（NavSphere 兼容层）有一条铁律：**读出来的是什么，写回去的就是什么**。
 * 因为「写」用的是全量对齐语义 —— 快照里没有的记录 = 用户删了。
 * 于是任何读侧投影不完整（预过滤 / 分页截断）都会在写侧变成数据丢失或写入失败：
 *
 *   1. repo.listSites 默认 limit 100：>100 站点时快照被静默截断；
 *      而写侧匹配不到存量行时会走 createSiteWithId 直接撞同 id 主键冲突（500）。
 *   2. 类目 enabled 预过滤：后台（NavSphere 原版后台按快照读改写）看不到停用类目，
 *      下一次保存把「缺席」当「已删除」→ 类目被硬删、站点进回收站。
 *   3. 快照模型只有两级：三级类目/孤儿记录本就不在快照里，不能被写回顺手清掉。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const NAV = "src/navsphere/content/navigation.json";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-snapshot-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function getSnapshot(): Promise<any> {
  const res = await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV) });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function putSnapshot(data: unknown) {
  return app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV, content: JSON.stringify(data) } });
}

/** 快照里的全部站点项（一级 items + 二级子类目 items） */
function snapshotItems(data: any): any[] {
  return (data.navigationItems ?? []).flatMap((c: any) => [
    ...(c.items ?? []),
    ...((c.subCategories ?? []).flatMap((s: any) => s.items ?? [])),
  ]);
}

/**
 * 把数据库当前状态投影成一份「完整的」两级快照（等价于 NavSphere 导出的 navigation.json）。
 * 用于模拟外部通道产出的快照写回。
 */
async function buildFullSnapshot() {
  const cats = (await app.inject({ method: "GET", url: "/api/categories" })).json() as any[];
  const sites = (await app.inject({ method: "GET", url: "/api/sites?limit=1000" })).json() as any[];
  const itemOf = (s: any) => ({ id: s.id, title: s.title, href: s.url, enabled: s.enabled !== false });
  const tops = cats.filter((c) => !c.parentId);
  return {
    navigationItems: tops.map((c) => {
      const node: any = {
        id: c.id,
        title: c.title,
        enabled: c.enabled !== false,
        items: sites.filter((s) => s.categoryId === c.id).map(itemOf),
      };
      const children = cats.filter((x) => x.parentId === c.id);
      if (children.length > 0) {
        node.subCategories = children.map((sc) => ({
          id: sc.id,
          title: sc.title,
          enabled: sc.enabled !== false,
          items: sites.filter((s) => s.categoryId === sc.id).map(itemOf),
        }));
      }
      return node;
    }),
  };
}

describe("navigation.json 快照：全量投影与写回一致性", () => {
  it("超过 100 个站点不被静默截断，完整快照可原样写回（不撞主键）", async () => {
    const total = 120;
    await ctx.repo.createCategory({ id: "bulk", title: "批量站点", source: "seed" });
    for (let i = 0; i < total; i++) {
      await ctx.repo.createSite({
        url: `https://bulk-${i}.example.com`,
        title: `批量站点 ${i}`,
        description: `第 ${i} 个批量站点`,
        categoryId: "bulk",
        source: "seed",
      });
    }

    // 读侧：快照必须包含全部 120 条（repo.listSites 默认 limit 100 的老坑）
    const snap = await getSnapshot();
    expect(snapshotItems(snap).filter((i: any) => String(i.href).includes("bulk-")).length).toBe(total);

    // 写侧：完整快照原样写回。若存量站点匹配不全，超出部分会走 createSiteWithId
    // 对活行执行 INSERT -> 同 id 主键冲突 -> 整个保存 500。
    const put = await putSnapshot(await buildFullSnapshot());
    expect(put.statusCode).toBe(200);

    const again = await getSnapshot();
    expect(snapshotItems(again).filter((i: any) => String(i.href).includes("bulk-")).length).toBe(total);
  });

  it("停用类目保留在快照里：后台看得见、写回不丢（预过滤会导致硬删）", async () => {
    await ctx.repo.createCategory({ id: "hidden", title: "已停用类目", source: "seed" });
    await ctx.repo.createSite({ url: "https://hidden-a.example.com", title: "停用类目站点 A", categoryId: "hidden", source: "seed" });
    await ctx.repo.createSite({ url: "https://hidden-b.example.com", title: "停用类目站点 B", categoryId: "hidden", source: "seed" });
    await ctx.repo.updateCategory("hidden", { enabled: false });

    const snap = await getSnapshot();
    const node = (snap.navigationItems ?? []).find((c: any) => c.id === "hidden");
    expect(node).toBeTruthy();
    expect(node.enabled).toBe(false);
    expect((node.items ?? []).length).toBe(2);

    // 原样写回（等价于后台一次普通保存）：停用类目与其站点必须原样保留
    expect((await putSnapshot(snap)).statusCode).toBe(200);

    const cats = (await app.inject({ method: "GET", url: "/api/categories" })).json() as any[];
    expect(cats.some((c) => c.id === "hidden")).toBe(true);
    const sites = (await app.inject({ method: "GET", url: "/api/sites?limit=1000" })).json() as any[];
    expect(sites.some((s) => s.url === "https://hidden-a.example.com")).toBe(true);
    expect(sites.some((s) => s.url === "https://hidden-b.example.com")).toBe(true);
  });

  it("快照看不见的记录不因写回被清掉：三级类目与孤儿站点", async () => {
    await ctx.repo.createCategory({ id: "deep-top", title: "深层层级", source: "seed" });
    await ctx.repo.createCategory({ id: "deep-child", title: "二级类目", parentId: "deep-top", source: "seed" });
    await ctx.repo.createCategory({ id: "deep-grand", title: "三级类目", parentId: "deep-child", source: "seed" });
    await ctx.repo.createSite({ url: "https://deep.example.com", title: "三级类目站点", categoryId: "deep-grand", source: "seed" });
    await ctx.repo.createSite({ url: "https://orphan.example.com", title: "孤儿站点", categoryId: "no-such-category", source: "seed" });

    const snap = await getSnapshot();
    // 快照模型只有两级：三级类目与孤儿站点本就不在快照的可见集里
    expect(snapshotItems(snap).some((i: any) => i.href === "https://orphan.example.com")).toBe(false);
    expect((snap.navigationItems ?? []).some((c: any) => c.id === "deep-grand")).toBe(false);
    // 二级类目仍在
    const top = (snap.navigationItems ?? []).find((c: any) => c.id === "deep-top");
    expect((top?.subCategories ?? []).some((s: any) => s.id === "deep-child")).toBe(true);

    expect((await putSnapshot(snap)).statusCode).toBe(200);

    // 「快照里没有」不能推出「已删除」：看不见的记录必须原样保留
    const cats = (await app.inject({ method: "GET", url: "/api/categories" })).json() as any[];
    expect(cats.some((c) => c.id === "deep-grand")).toBe(true);
    const sites = (await app.inject({ method: "GET", url: "/api/sites?limit=1000" })).json() as any[];
    expect(sites.some((s) => s.url === "https://deep.example.com")).toBe(true);
    expect(sites.some((s) => s.url === "https://orphan.example.com")).toBe(true);
  });
});
