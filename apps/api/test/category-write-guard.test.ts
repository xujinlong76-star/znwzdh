/**
 * P1-3 类目写入口的命名与 slug 校验（2026-10-22 类目树升级方案 §5.3）。
 *
 * 锁三件事：
 * 1. 命名规则（宽度 / 禁用轴）在 HTTP 口子上生效 —— 这五个轴一旦写进树，
 *    同一需求会长出近义根（实测 `图标与插画素材`/`图标字体与素材`/`图标素材`）。
 * 2. 仓储层守卫（同级重名、slug 撞库）报 **400 而不是 500**。
 *    这条是真出过事的形态：P1-2 加了每父唯一标题校验后，POST 没接住异常。
 * 3. 创建返回体带服务端生成的 slug，且 PATCH 改名不会重写它。
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-cat-guard-"));
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
  await ctx.repo.createCategory({ id: "guard-parent", title: "守卫父级" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function postCategory(payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/categories", payload });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}

describe("命名规则", () => {
  it("时效轴词被拒，并说明该用什么替代", async () => {
    const res = await postCategory({ title: "热门AI工具" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/freshness/);
    expect(res.body.error).toMatch(/编辑精选/);
  });

  it("受众轴词被拒", async () => {
    const res = await postCategory({ title: "投资者工具包" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/audience/);
  });

  it("视觉宽度超限被拒", async () => {
    const res = await postCategory({ title: "企业级协同办公与项目管理平台" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/视觉宽度/);
  });

  it("英文名过长被拒（中文名合规也一样拒）", async () => {
    const res = await postCategory({ title: "效率办公", titleEn: "Enterprise Collaboration And Project Management Productivity Suite" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/英文名/);
  });

  it("主题名「海外」不受语言轴误伤", async () => {
    const res = await postCategory({ title: "海外与远程" });
    expect(res.status).toBe(201);
  });
});

describe("仓储层守卫映射成 400", () => {
  it("同级重名不返回 500", async () => {
    const first = await postCategory({ title: "重名子级", parentId: "guard-parent" });
    expect(first.status).toBe(201);
    const dup = await postCategory({ title: "重名子级", parentId: "guard-parent" });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/同级/);
    // 跨父同名仍然允许（每父唯一，不是全局唯一）
    expect((await postCategory({ title: "重名子级" })).status).toBe(201);
  });

  it("PATCH 改成同级已有名 → 400", async () => {
    const parent = await postCategory({ title: "改名父级" });
    await postCategory({ title: "甲子", parentId: parent.body.id });
    const b = await postCategory({ title: "乙子", parentId: parent.body.id });
    const res = await app.inject({ method: "PATCH", url: `/api/categories/${b.body.id}`, payload: { title: "甲子" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/同级/);
  });

  it("PATCH 带违规名 → 400（改名要过命名规则）", async () => {
    const created = await postCategory({ title: "待规范类目" });
    const res = await app.inject({ method: "PATCH", url: `/api/categories/${created.body.id}`, payload: { title: "常用推荐" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/freshness/);
  });
});

describe("slug 由服务端生成", () => {
  it("创建返回体带 slug，英文名优先", async () => {
    const res = await postCategory({ title: "资讯媒体", titleEn: "News & Media" });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("news-and-media");
    const zh = await postCategory({ title: "金融财经" });
    expect(zh.body.slug).toBe("jinrongcaijing");
    const list = (await app.inject({ method: "GET", url: "/api/categories" })).json() as Array<Record<string, any>>;
    expect(list.find((c) => c.id === res.body.id)?.slug).toBe("news-and-media");
  });

  it("客户端传 slug 不生效（口子只认服务端生成）", async () => {
    const res = await postCategory({ title: "影音娱乐", slug: "hijacked-url" });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("yingyinyule");
  });

  it("PATCH 改名不重写 slug，也不接受外部 slug", async () => {
    const created = await postCategory({ title: "游戏电竞" });
    const res = await app.inject({ method: "PATCH", url: `/api/categories/${created.body.id}`, payload: { title: "游戏与电竞" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("youxidianjing");
    const hijack = await app.inject({ method: "PATCH", url: `/api/categories/${created.body.id}`, payload: { slug: "nope" } });
    // schema 里没有 slug 字段 → 被剥离；只剩 updated_at 的更新仍然成功
    expect(hijack.statusCode).toBe(200);
    expect(hijack.json().slug).toBe("youxidianjing");
  });

  it("只改图标不会被命名规则挡住（存量旧名可继续维护）", async () => {
    // 「开源」是禁用轴，但仓储层不跑命名校验（市场安装路径要保持宽松），
    // 所以这条模拟「规则之前就已存在」的旧行；只改 icon 不该被拒。
    const legacy = await ctx.repo.createCategory({ id: "legacy-banned", title: "开源自托管" });
    expect(legacy.title).toBe("开源自托管");
    const res = await app.inject({ method: "PATCH", url: "/api/categories/legacy-banned", payload: { icon: "github" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().icon).toBe("github");
  });
});
