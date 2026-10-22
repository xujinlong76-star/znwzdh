/**
 * 订阅源同步（POST /api/plugins/taps/:id/sync）的清单上限与同名去重回归。
 *
 * 为什么这两条要专门测：
 *  1. 清单长度是**远端输入**。原来没有任何上限，一个"10 万条"的订阅源会把
 *     一个 HTTP 请求变成几小时的串行导入（每条一次写库 + 一次向量化）。
 *  2. 原来的幂等判定是 `listPlugins({q: name, limit: 5})` 里找精确同名 ——
 *     plugins.name 上没有唯一约束（只有 slug 有），而 listPlugins 默认按
 *     published_at/created_at **倒序**返回。只要库里已有 5 个"名字包含它"的
 *     更新插件，真正同名的那条就落在结果窗口之外 → uniqueSlug 给它排个
 *     `-2` 后缀 → 市场里出现两个同名插件。
 *
 * guardedFetch 的 SSRF 守卫会拦掉 127.0.0.1，所以这里替换掉这一个导出
 * （其余 @navhub/ai 导出保持原样），把"远端清单"变成可控字符串。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hoisted = vi.hoisted(() => {
  process.env.NAVHUB_TAP_IMPORT_MAX = "5"; // 处理上限压到 5，测试不必造 500 条
  return { body: "[]", calls: 0 };
});

vi.mock("@navhub/ai", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    guardedFetch: async () => {
      hoisted.calls++;
      return { status: 200, body: hoisted.body, url: "mocked://tap", redirects: [], headers: {} };
    },
  };
});

const { validateAndCleanPluginManifest } = await import("@navhub/core");
const { buildServer } = await import("../src/server.ts");
const { createContext } = await import("../src/context.ts");
const { loadConfig } = await import("../src/config.ts");

let dir: string;
let ctx: any;
let app: any;

/** 最小可用主题清单（与 response-cache-headers.test.ts 同一形态） */
function themeManifest(name: string) {
  const validated = validateAndCleanPluginManifest({
    manifestVersion: 1,
    kind: "theme",
    name,
    description: "集成测试用主题",
    version: "1.0.0",
    tags: ["测试"],
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%" } },
  });
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  return validated.manifest;
}

async function seedPlugin(name: string, createdAt: number): Promise<void> {
  await ctx.repo.createPlugin({
    manifest: themeManifest(name),
    status: "published",
    source: "user",
    author: "测试",
  });
  // listPlugins 默认按 published_at/created_at 倒序：必须造出确定的新旧次序，
  // 否则"同名那条被挤出前 5"这件事本身就不可复现。
  ctx.db.sqlite!
    .prepare("UPDATE plugins SET created_at = ?, published_at = ? WHERE name = ?")
    .run(createdAt, createdAt, name);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-tap-sync-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.setSystemState("plugins:taps", [
    { id: "tap-1", name: "测试订阅源", url: "https://tap.invalid/list.json", description: "" },
  ]);
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 文件句柄异步释放
  }
});

function tapPayload(names: string[]): string {
  return JSON.stringify(
    names.map((name) => ({
      manifestVersion: 1,
      kind: "theme",
      name,
      description: "远端清单条目",
      version: "1.0.0",
      tags: ["测试"],
      payload: { accent: "violet", tokens: { "--primary": "262 83% 58%" } },
    })),
  );
}

async function sync(): Promise<any> {
  const res = await app.inject({ method: "POST", url: "/api/plugins/taps/tap-1/sync" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("订阅源同步的清单上限", () => {
  it("超过 NAVHUB_TAP_IMPORT_MAX 的条目不处理，并如实标记 truncated", async () => {
    hoisted.body = tapPayload(["上限甲", "上限乙", "上限丙", "上限丁", "上限戊", "上限己", "上限庚", "上限辛"]);
    const body = await sync();
    expect(body.fetchedCount).toBe(8); // 声明条数照实报
    expect(body.importedCount).toBe(5); // 处理条数受上限约束（缺陷版会把 8 条全导入）
    expect(body.truncated).toBe(true); // 缺陷版：字段根本不存在
  });
});

describe("订阅源同步的同名去重", () => {
  it("真同名那条被挤出前 5 时，也必须识别为已存在（缺陷版会重复导入）", async () => {
    const base = 1_700_000_000_000;
    // 最老的一条：与远端清单里的名字**精确同名**
    await seedPlugin("去重测试", base);
    // 更新的 6 条：名字都"包含"它，会全部抢在精确同名之前进入 LIKE 结果
    for (let i = 1; i <= 6; i++) {
      await seedPlugin(`去重测试 变体${i}`, base + i * 1000);
    }

    hoisted.body = tapPayload(["去重测试"]);
    const body = await sync();
    expect(body.importedCount).toBe(0);

    const rows = await ctx.repo.listPlugins({ q: "去重测试", limit: 50 });
    const exact = rows.items.filter((p: { name: string }) => p.name === "去重测试");
    expect(exact).toHaveLength(1); // 缺陷版这里是 2（uniqueSlug 排出了 -2 后缀）
    expect(hoisted.calls).toBeGreaterThan(0);
  });

  it("一份清单内部的重名只导入一次", async () => {
    hoisted.body = tapPayload(["包内重名", "包内重名", "包内重名"]);
    const body = await sync();
    expect(body.importedCount).toBe(1);
    const rows = await ctx.repo.listPlugins({ q: "包内重名", limit: 20 });
    expect(rows.items.filter((p: { name: string }) => p.name === "包内重名")).toHaveLength(1);
  });
});
