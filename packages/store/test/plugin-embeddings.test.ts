/**
 * 插件向量持久层（plugin_embeddings）契约测试。
 *
 * 与站点 embeddings 同构、但独立成表；本文件锁定四条契约：
 *  1. 业务 id 前缀 "plugin:<slug>" 与主键哈希（与 sites_vec 同构）；
 *  2. 写入后可读回（浮点往返无漂移），savedPluginEmbeddings 键位正确；
 *  3. upsert 幂等（重复保存不产生第二行）；
 *  4. 删除后不复活；(plugins_vec) rehydrate 只灌插件向量，不混入站点。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import {
  hashSiteId,
  pluginSlugFromVectorId,
  pluginVectorId,
  SqliteVecStore,
} from "../src/vector/index.ts";

const DIM = 8;

function vec(seed: number): Float32Array {
  const a = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) a[i] = Math.sin(seed * (i + 1) * 1.7) + (i % 3) * 0.1;
  return a;
}

function closeTo(actual: Float32Array, expected: Float32Array, tol = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThan(tol);
  }
}

let dir: string;
let db: Db;
let repo: Repository;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-emb-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "t.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("plugin_embeddings 持久层", () => {
  it("业务 id：plugin:<slug> 前缀与反向解析（站点 UUID 不误判）", () => {
    expect(pluginVectorId("demo-pack")).toBe("plugin:demo-pack");
    expect(pluginSlugFromVectorId("plugin:demo-pack")).toBe("demo-pack");
    expect(pluginSlugFromVectorId("2f5c1b0a-9e3d-4f56-8a7b-1c2d3e4f5a6b")).toBe(null);
  });

  it("保存后可读回（浮点往返无漂移）；savedPluginEmbeddings 键位与站点同构", async () => {
    const v = vec(3);
    await repo.savePluginEmbedding("demo-pack", "test", v);

    const back = await repo.getPluginEmbedding("demo-pack");
    expect(back).not.toBeNull();
    closeTo(back!, v);

    const saved = await repo.savedPluginEmbeddings();
    expect(saved.length).toBe(1);
    expect(saved[0]!.siteId).toBe("plugin:demo-pack");
    expect(saved[0]!.key).toBe(hashSiteId("plugin:demo-pack"));
    closeTo(saved[0]!.vector, v);
  });

  it("upsert 幂等：重复保存覆盖旧值而不是追加第二行", async () => {
    const next = vec(4);
    await repo.savePluginEmbedding("demo-pack", "test", next);
    const saved = await repo.savedPluginEmbeddings();
    expect(saved.length).toBe(1);
    closeTo((await repo.getPluginEmbedding("demo-pack"))!, next);
  });

  it("删除后读为空且不出现在 savedPluginEmbeddings", async () => {
    await repo.deletePluginEmbedding("demo-pack");
    expect(await repo.getPluginEmbedding("demo-pack")).toBeNull();
    expect((await repo.savedPluginEmbeddings()).length).toBe(0);
  });

  it("SqliteVecStore(plugins_vec) 从持久层重灌，只含插件向量（与站点表互不干扰）", async () => {
    await repo.savePluginEmbedding("a-pack", "test", vec(11));
    await repo.savePluginEmbedding("b-pack", "test", vec(12));

    const sqliteVec: any = await import("sqlite-vec");
    sqliteVec.load(db.sqlite as never);

    const store = new SqliteVecStore({ db: db.sqlite as never, dim: DIM, table: "plugins_vec" });
    store.init();
    store.rehydrate(await repo.savedPluginEmbeddings());

    const hits = await store.search(vec(11), 5);
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.siteId).sort()).toEqual(["plugin:a-pack", "plugin:b-pack"]);
    // 命中项必须全部能反向解析回插件 slug（不会混入站点 UUID）
    expect(hits.every((h) => pluginSlugFromVectorId(h.siteId) !== null)).toBe(true);
    // 最近邻是自身（距离 ~0）
    expect(hits[0]!.siteId).toBe("plugin:a-pack");
    expect(hits[0]!.distance).toBeLessThan(1e-5);
  });
});
