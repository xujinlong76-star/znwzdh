#!/usr/bin/env node
/**
 * 跨方言套件的显式入口：**没有 DATABASE_URL 就直接失败**。
 *
 * 背景：`pg-dialect` / `rollup-pg` 在没有 `NAVHUB_TEST_DATABASE_URL` 时会整体
 * skip。这是本地开发的正确默认（没 PG 也能跑绿），但也制造了一种假象——
 * 开发者以为「我跑了 PG 套件」，实际 0 条用例执行。2026-10-24 实测：
 * 这两个文件当时在 CI 上其实是红的（`catId is not defined` + 非幂等夹具），
 * 因为本地一直跳过而没人发现。
 *
 * 这个入口把「跳过」变成「报错」，并给出可直接复制的最小启动方式。
 */
import { spawnSync } from "node:child_process";

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
    ].join("\n"),
  );
  process.exit(1);
}

const res = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/store/test/pg-dialect.e2e.test.ts",
    "packages/store/test/rollup-pg.e2e.test.ts",
  ],
  { stdio: "inherit", env: process.env },
);

process.exit(res.status ?? 1);
