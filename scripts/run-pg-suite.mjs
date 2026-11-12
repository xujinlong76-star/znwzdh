#!/usr/bin/env node
/**
 * 跨方言套件的显式入口：**没有 DATABASE_URL 就直接失败**。
 *
 * 背景：`pg-dialect` / `rollup-pg` / `llm-quota-reservation-pg` 在没有 `NAVHUB_TEST_DATABASE_URL`
 * 时会整体 skip。这是本地开发的正确默认（没 PG 也能跑绿），但也制造了一种假象——
 * 开发者以为「我跑了 PG 套件」，实际 0 条用例执行。2026-10-24 实测：
 * 前两个套件当时在 CI 上其实是红的（`catId is not defined` + 非幂等夹具），
 * 因为本地一直跳过而没人发现。
 *
 * 这个入口把「跳过」变成「报错」，并给出可直接复制的最小启动方式。
 *
 * 套件清单必须在此显式登记：漏登记的文件在 CI 上**根本不会被执行**，
 * 连「跳过」的信号都没有。这条由 pg-suite-entry.test.ts 用目录扫描钉住。
 *
 * pg_trgm 预装（2026-11-12）：spawn vitest 之前，先把 pg_trgm 装进 public。
 * DDL 里那句裸 `CREATE EXTENSION IF NOT EXISTS pg_trgm` 只保证「扩展存在」，
 * 不保证「装在哪个 schema」——Postgres 把它装进当前 search_path 的首位。
 * 三个 e2e 套件并行跑同一库时，rollup-pg 先 `SET search_path TO rollup_e2e, public`
 * 再跑 DDL，扩展就落在 rollup_e2e；pg-dialect 随后那句 CREATE EXTENSION 是
 * no-op，gin_trgm_ops 对 public 不可见，CREATE INDEX 就报
 * `operator class "gin_trgm_ops" does not exist for access method "gin"`，
 * createContext 在 DDL 处抛错、ctx 为空，红在 pg-dialect 的连接断言上。
 * 更糟的是 rollup-pg 结束时 `DROP SCHEMA rollup_e2e CASCADE` 会把装在里面的
 * 扩展一起删掉——先跑后跑、跑几次，结果都不一样，是纯时序 flake。
 * 所以扩展必须在任何 worker 启动前就钉在 public：已存在但装错 schema 时
 * IF NOT EXISTS 同样是 no-op，必须用 ALTER EXTENSION 显式搬家。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const url = process.env.NAVHUB_TEST_DATABASE_URL;

if (!url) {
  console.error(
    [
      "",
      "❌ 未设置 NAVHUB_TEST_DATABASE_URL —— 拒绝执行。",
      "",
      "   这两个套件在缺少连接串时会整体 skip；用本入口跑就是为了避免",
      "   「以为跑了 PG，实际一条没跑」。请先启动 PostgreSQL（需 pgvector）：",
      "",
      "     docker run --rm -d --name navhub-pg -p 5432:5432 \\",
      "       -e POSTGRES_USER=navhub -e POSTGRES_PASSWORD=navhub \\",
      "       -e POSTGRES_DB=navhub_test pgvector/pgvector:pg17",
      "",
      "     export NAVHUB_TEST_DATABASE_URL=postgres://navhub:navhub@127.0.0.1:5432/navhub_test",
      "     pnpm test:pg:suite",
      "",
      "   pgvector/pgvector:pg17 自带 pg_trgm（Postgres contrib），本入口在跑套件前",
      "   会把它装进 public schema；不需要另外给镜像加扩展。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * 把 pg_trgm 钉在 public schema，并校验 gin_trgm_ops 可见。
 *
 * 幂等：已在 public 时全程 no-op，可反复跑。失败时直接抛错——调用方把它变成
 * 退出码 1，而不是留给 DDL 去报一句看不懂的 gin_trgm_ops 不存在。
 */
async function ensurePgTrgmInPublic(connectionString) {
  let pg;
  try {
    // pnpm 严格布局下 pg 是 packages/store 的依赖，从本文件位置回退解析
    //（与 rollup-pg.e2e.test.ts 同款取法，根 node_modules 里没有 pg）。
    const require = createRequire(import.meta.url);
    pg = require(path.join(process.cwd(), "packages/store/node_modules/pg"));
  } catch {
    throw new Error(
      "找不到 pg 客户端（packages/store/node_modules/pg），请先 pnpm install --frozen-lockfile",
    );
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    const schema = existing.rows[0]?.schema ?? null;
    if (!schema) {
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public");
    } else if (schema !== "public") {
      // 扩展已存在时 CREATE EXTENSION IF NOT EXISTS 是 no-op，不会挪位置。
      await client.query("ALTER EXTENSION pg_trgm SET SCHEMA public");
    }
    const check = await client.query(
      "SELECT extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    if (check.rows[0]?.schema !== "public") {
      throw new Error(
        "pg_trgm 不在 public schema（实际在 " +
          (check.rows[0]?.schema ?? "未知") +
          "），gin_trgm_ops 仍对 public 不可见",
      );
    }
    const opclass = await client.query(
      "SELECT COUNT(*)::int AS n FROM pg_opclass WHERE opcname = 'gin_trgm_ops'",
    );
    if (Number(opclass.rows[0]?.n ?? 0) === 0) {
      throw new Error("pg_trgm 已装进 public，但 gin_trgm_ops 操作符类仍不存在（扩展安装不完整？）");
    }
    console.log("[pg-suite] pg_trgm 已就绪（public schema，gin_trgm_ops 可见）");
  } finally {
    await client.end();
  }
}

// --provision-only：只预装扩展，不跑套件。CI 的 test-postgres 作业用它当独立步骤，
// 让「扩展没装好」和「套件红了」是两处不同的红；本入口 spawn vitest 前同样会装一次。
const provisionOnly = process.argv.includes("--provision-only");
try {
  await ensurePgTrgmInPublic(url);
} catch (err) {
  console.error(
    "[pg-suite] ❌ pg_trgm 预装失败：" + (err instanceof Error ? err.message : String(err)),
  );
  console.error(
    "   否则 DDL 里的 CREATE INDEX ... gin_trgm_ops 会报 operator class 不存在，" +
      "createContext 抛错、pg-dialect 整套起不来。",
  );
  process.exit(1);
}
if (provisionOnly) process.exit(0);

const res = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/store/test/pg-dialect.e2e.test.ts",
    "packages/store/test/rollup-pg.e2e.test.ts",
    "packages/store/test/llm-quota-reservation-pg.e2e.test.ts",
  ],
  { stdio: "inherit", env: process.env },
);

process.exit(res.status ?? 1);
