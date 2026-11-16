/**
 * A-2 复现：安装弹窗「全不选」仍装全部站点；错选静默走成功路径。
 *
 * 服务端语义（修复前）：`packages/store/src/repository/plugins.ts`
 * `selectedSites` 为空数组时按「不过滤」处理（`length > 0` 才过滤），于是
 * `{ selectedSites: [] }` 会装走全部站点；与包内无交集的 URL 列表则
 * `sitesAdded: 0` 却仍返回 `success: true`（前端据此弹成功 toast）。
 *
 * 修复后的约定（前后端一致）：
 * - `selectedSites` 省略（undefined）→ 全量安装（默认行为不变）；
 * - `selectedSites: []` → 装 0 个站点，不再等价于全量；
 * - `selectedSites` 与包内 URL 无交集 → 装 0 个站点（诚实计数，
 *   前端据此不走成功 toast，见 overlay 守卫测试）。
 * - 子集过滤与「0 选后补选仍可装」不受影响。
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

const sitePack = (name: string, sites: Array<{ url: string; title: string }>) => ({
  manifestVersion: 1,
  kind: "site-pack",
  name,
  description: "A-2 复现用网址包",
  version: "1.0.0",
  tags: ["测试"],
  payload: { categories: [{ title: "插件测试类目" }], sites },
});

async function publishPack(name: string, sites: Array<{ url: string; title: string }>): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/plugins?anonId=a2-author",
    payload: sitePack(name, sites),
  });
  expect(created.statusCode).toBe(201);
  const slug = created.json().slug as string;
  const approved = await app.inject({
    method: "POST",
    url: `/api/plugins/${encodeURIComponent(slug)}/review`,
    payload: { action: "approve", note: "A-2 复现" },
  });
  expect(approved.statusCode).toBe(200);
  return slug;
}

let slugA: string;
let slugB: string;
let slugC: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-a2-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  slugA = await publishPack("A2 审计包 A", [
    { url: "https://a1.example.com", title: "A1" },
    { url: "https://a2.example.com", title: "A2" },
    { url: "https://a3.example.com", title: "A3" },
  ]);
  slugB = await publishPack("A2 审计包 B", [
    { url: "https://b1.example.com", title: "B1" },
    { url: "https://b2.example.com", title: "B2" },
    { url: "https://b3.example.com", title: "B3" },
  ]);
  slugC = await publishPack("A2 审计包 C", [
    { url: "https://c1.example.com", title: "C1" },
    { url: "https://c2.example.com", title: "C2" },
    { url: "https://c3.example.com", title: "C3" },
  ]);
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

describe("A-2：selectedSites 空选 / 错选不再装错", () => {
  it("全不选：selectedSites: [] 只装 0 站，不再装全部 3 站", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slugA)}/install?anonId=a2-empty`,
      payload: { selectedSites: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    // 修复前：sitesAdded 为 3（空数组被当成「不过滤」）
    expect(res.json().applied.sitesAdded).toBe(0);
  });

  it("0 选安装不是死路：同一身份补选子集后能正常装入", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slugA)}/install?anonId=a2-empty`,
      payload: { selectedSites: ["https://a1.example.com", "https://a2.example.com"] },
    });
    expect(res.statusCode).toBe(200);
    // 修复前：上一条已把 3 站全装走，这里只能是 0 增 2 跳
    expect(res.json().applied.sitesAdded).toBe(2);
    expect(res.json().applied.sitesSkipped).toBe(0);
  });

  it("错选：用 A 包 URL 给 B 包安装，诚实返回 sitesAdded: 0（不装错站）", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slugB)}/install?anonId=a2-wrong`,
      payload: { selectedSites: ["https://a1.example.com", "https://a2.example.com"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().applied.sitesAdded).toBe(0);
    expect(res.json().applied.sitesSkipped).toBe(0);
  });

  it("子集过滤仍有效：selectedSites: [b1] 只装 1 站", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slugB)}/install?anonId=a2-subset`,
      payload: { selectedSites: ["https://b1.example.com"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied.sitesAdded).toBe(1);
  });

  it("默认行为不变：不传 selectedSites 仍全量安装 3 站", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slugC)}/install?anonId=a2-default`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied.sitesAdded).toBe(3);
  });
});
