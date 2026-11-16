/**
 * F-2 服务端复现测试：`GET /api/plugins?starred=true` 必须只返回调用方已星标的插件。
 *
 * 复现（修前）：starred 参数被忽略，返回全部已上架插件——“星标视图”只是
 * 通用市场的换皮，前端再怎么加筛选入口都是假功能。
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
let slugA: string;
let slugB: string;

const sitePack = (name: string, sites: Array<{ url: string; title: string }>) => ({
  manifestVersion: 1,
  kind: "site-pack",
  name,
  description: "星标筛选测试用网址包",
  version: "1.0.0",
  tags: ["测试"],
  payload: { categories: [{ title: "插件测试类目" }], sites },
});

async function publish(name: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/plugins?anonId=author-1",
    payload: sitePack(name, [{ url: `https://star-${name}.example.com`, title: "A" }]),
  });
  expect(created.statusCode).toBe(201);
  const slug = created.json().slug as string;
  const approved = await app.inject({
    method: "POST",
    url: `/api/plugins/${encodeURIComponent(slug)}/review`,
    payload: { action: "approve", note: "测试通过" },
  });
  expect(approved.statusCode).toBe(200);
  return slug;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-starred-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  slugA = await publish("星标筛选包A");
  slugB = await publish("星标筛选包B");
  // 只有 A 被 anon-test-1 星标
  const star = await app.inject({
    method: "POST",
    url: `/api/plugins/${encodeURIComponent(slugA)}/star?anonId=anon-test-1`,
  });
  expect(star.statusCode).toBe(200);
  expect(star.json().starCount).toBe(1);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略 Windows 上 SQLite 文件 handle 异步释放产生的短暂占用
  }
});

describe("F-2 GET /api/plugins?starred=true", () => {
  it("只返回调用方已星标的插件，total 与分页一致", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins?starred=true&anonId=anon-test-1",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].slug).toBe(slugA);
    expect(body.items[0].starred).toBe(true);
  });

  it("无身份时星标视图为空（不谎称有星标，也不越权读他人星标）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?starred=true" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().items).toHaveLength(0);
  });

  it("没星过任何插件的身份看到空视图", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins?starred=true&anonId=anon-other",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });

  it("不带 starred 时行为不变：两个包都在", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?anonId=anon-test-1" });
    expect(res.statusCode).toBe(200);
    const slugs = (res.json().items as Array<{ slug: string }>).map((p) => p.slug);
    expect(slugs).toContain(slugA);
    expect(slugs).toContain(slugB);
  });

  it("starred 与 q 组合过滤", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/plugins?starred=true&q=${encodeURIComponent("星标筛选包B")}&anonId=anon-test-1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });
});
