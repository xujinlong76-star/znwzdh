/**
 * 导航快照的版本号缓存（升级改造方案 P1-1）。
 *
 * 这一轮改的是「读放大」：快照原先用一条 `COUNT(*)/MAX(updated_at)` 指纹判断
 * 「库变过没有」，而指纹本身就是命中判据 —— **命中也要付一次聚合**，PG 上是顺序扫描；
 * 更关键的是跨实例一致性只能靠 TTL 兜，而快照同时是后台「读-改-写」的数据源。
 * 现在换成 `data_version` 单行表的主键点查 + 数据库触发器递增。
 *
 * 这个文件锁四件在真实部署里才会显形的事：
 *   1. **绕过仓储的直写**（后台任务 / 另一个实例 / 运维脚本）在下一次读立即看到，
 *      不需要等 TTL —— 这是把「最长滞后 30s」变成「不滞后」的那一步；
 *   2. 命中路径只付一次点查，且构建路径的语句数有界（不随站点数增长）；
 *   3. 版本号读不到时降级为「只靠 TTL」，而不是报错、也不是永久吃旧缓存；
 *   4. 观测接线（hit/miss 计数真的会长、/api/health 报出版本号与缺失触发器数）。
 *
 * 另加一条顺序守卫：gzip 钩子必须晚于 ETag 钩子注册，否则浏览器（带
 * `Accept-Encoding: gzip`）拿到的响应根本没有 ETag，条件请求全数退化成整包重传。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../src/server.ts";
import { registerCompression } from "../src/http-compression.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { invalidateSnapshotCache, resetSnapshotMetricsForTest, snapshotCacheInfo } from "../src/storage.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, "..");

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const NAV = "src/navsphere/content/navigation.json";
const NAV_URL = "/api/storage?path=" + encodeURIComponent(NAV);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-snapversion-"));
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
  // 与 main.ts 同一顺序：buildServer 之后才注册压缩钩子（钩子链在 ready 时固化）。
  // 顺序本身由下面那条源码守卫钉住，这里照做是为了让压缩路径真的被测到。
  registerCompression(app);
  await app.ready();

  // 造足够多的内容让单次响应超过 gzip 阈值（1KB），顺序守卫才有意义
  await ctx.repo.createCategory({ id: "vcat", title: "版本类目", sort: 1, source: "api" } as never);
  for (let i = 0; i < 40; i++) {
    await ctx.repo.createSiteWithId({
      id: "vsite-" + i,
      url: "https://v" + i + ".example.com/" + "x".repeat(40),
      title: "版本站点 " + i,
      description: "用于把快照体积推到 gzip 阈值以上的填充描述文本。".repeat(3),
      categoryId: "vcat",
      sort: i,
      source: "api",
    } as never);
  }
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  invalidateSnapshotCache();
  resetSnapshotMetricsForTest();
});

async function getSnapshot(): Promise<any> {
  const res = await app.inject({ method: "GET", url: NAV_URL });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** 标题出现在快照里的哪一层（顶级 items 或子类目 items） */
function itemTitle(data: any, id: string): string | undefined {
  for (const top of data.navigationItems ?? []) {
    for (const item of top.items ?? []) if (item.id === id) return item.title;
    for (const sub of top.subCategories ?? []) {
      for (const item of sub.items ?? []) if (item.id === id) return item.title;
    }
  }
  return undefined;
}

/**
 * 统计一次处理里仓储真正执行的 SQL。
 *
 * 用实例属性遮蔽原型方法：Repository 内部各处都是 `this.raw(...)`，
 * 因此覆盖之后统计到的是**整条链路**的语句，不是路由层自觉上报的数字。
 */
function captureSql(run: () => Promise<unknown>): Promise<{ sql: string[]; result: unknown }> {
  const calls: string[] = [];
  const anyRepo = ctx.repo as unknown as { raw: (sqlText: string, params?: unknown[]) => Promise<unknown[]> };
  const original = anyRepo.raw;
  anyRepo.raw = (sqlText: string, params?: unknown[]) => {
    calls.push(sqlText);
    return original.call(ctx.repo, sqlText, params);
  };
  return run()
    .then((result) => ({ sql: calls, result }))
    .finally(() => {
      if (original) anyRepo.raw = original;
      else delete (ctx.repo as unknown as Record<string, unknown>).raw;
    });
}

describe("快照版本号缓存", () => {
  it("第一次读建缓存，第二次读只付一次版本号点查", async () => {
    await getSnapshot();
    const first = snapshotCacheInfo();
    expect(first.cached).toBe(true);
    expect(first.version, "缓存条目必须带着构建**之前**读到的版本号").toBeTypeOf("number");
    expect(first.builds).toBe(1);
    expect(first.hits).toBe(0);
    expect(first.misses).toBe(1);

    const captured = await captureSql(() => getSnapshot());
    // 命中的那一路：整条请求只有版本号那一条 SQL。
    // 以前这里还要跑一条五个子查询的 COUNT/MAX 指纹 —— 命中也付钱。
    expect(captured.sql, "命中路径的 SQL：" + captured.sql.join(" | ")).toHaveLength(1);
    expect(captured.sql[0]).toContain("FROM data_version");
    expect(snapshotCacheInfo().hits).toBe(1);
    expect(snapshotCacheInfo().builds).toBe(1);
  });

  it("绕过仓储的直写（后台任务/另一实例）在下一次读立即生效，不等 TTL", async () => {
    const before = await getSnapshot();
    expect(itemTitle(before, "vsite-7")).toBe("版本站点 7");
    const versionBefore = snapshotCacheInfo().version!;

    // 完全不经过 Repository 的方法：health_check / recompute_rank / 运维脚本就是这个形态。
    // 一致性靠数据库触发器递增版本号，而不是靠调用方记得失效缓存。
    await ctx.repo.run("UPDATE sites SET title = '直写改名' WHERE id = 'vsite-7'");

    const after = await getSnapshot();
    expect(itemTitle(after, "vsite-7")).toBe("直写改名");
    expect(snapshotCacheInfo().version!).toBeGreaterThan(versionBefore);
    expect(snapshotCacheInfo().builds).toBe(2);
  });

  it("重建一次快照的 SQL 条数有界，且没有逐行相关子查询与 COUNT 指纹", async () => {
    const captured = await captureSql(async () => {
      await ctx.repo.run("UPDATE sites SET title = '触发重建' WHERE id = 'vsite-1'");
      return getSnapshot();
    });
    // 40 个站点也还是这个数：聚合按 site_id 一批做完，与行数无关
    expect(captured.sql.length, "重建 SQL 条数=" + captured.sql.length + "：" + captured.sql.join(" | ")).toBeLessThanOrEqual(5);
    for (const sql of captured.sql) {
      // 相关子查询的签名是「聚合里回头引用外层 s.id」；它回来 = 每条列表都变成 N+1
      expect(sql, "相关子查询回来了：" + sql).not.toMatch(/WHERE st\.site_id = s\.id/);
      expect(sql, "相关子查询回来了：" + sql).not.toMatch(/WHERE sf\.site_id = s\.id/);
      // COUNT 指纹已经不属于这条链路
      expect(sql.toLowerCase(), "COUNT 指纹回来了：" + sql).not.toContain("count(*)");
    }
  });

  it("站点标签仍来自批量聚合：快照里 tags 有值", async () => {
    await ctx.repo.setSiteTags("vsite-2", ["vt-a", "vt-b"]);
    invalidateSnapshotCache();
    const data = await getSnapshot();
    const tags: string[] = [];
    for (const top of data.navigationItems ?? []) {
      for (const item of top.items ?? []) if (item.id === "vsite-2") tags.push(...(item.tags ?? []));
    }
    expect(tags.sort()).toEqual(["vt-a", "vt-b"]);
  });

  it("非导航文档不付版本点查：videos.json 的读路径里没有 data_version", async () => {
    const captured = await captureSql(async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/storage?path=" + encodeURIComponent("src/navsphere/content/videos.json"),
      });
      expect(res.statusCode).toBe(200);
    });
    const probes = captured.sql.filter((sql) => sql.includes("data_version"));
    expect(probes, "非导航文档也在点查版本号：" + probes.join(" | ")).toEqual([]);
  });

  it("版本号读不到时降级为「只靠 TTL」：不报错，也不假装命中过校验", async () => {
    await getSnapshot();
    const version = snapshotCacheInfo().version!;
    expect(version).toBeTypeOf("number");

    // 模拟老库 / 单行没种下：表还在，行没了 ⇒ 读不到版本号
    await ctx.repo.run("DELETE FROM data_version");
    try {
      const data = await getSnapshot();
      expect(data.navigationItems).toBeTruthy();
      const info = snapshotCacheInfo();
      expect(info.degradedReads, "读不到版本号必须留下读数，否则「降级」和「正常」长得一样").toBe(1);
      expect(info.builds, "降级时信任 TTL，不该把可选观测件变成可用性故障").toBe(1);
    } finally {
      await ctx.repo.run("INSERT INTO data_version (id, version) VALUES (1, ?)", [version]);
    }

    // 恢复后写入照常递增：降级不能变成永久失效
    await ctx.repo.run("UPDATE sites SET title = '恢复后改名' WHERE id = 'vsite-3'");
    expect(itemTitle(await getSnapshot(), "vsite-3")).toBe("恢复后改名");
  });

  it("版本号读在构建之前：构建窗口里落下的写入不会被记成「已包含」", async () => {
    await getSnapshot();
    const anyRepo = ctx.repo as unknown as { listAllSites: (limit?: number, options?: unknown) => Promise<unknown[]> };
    const original = anyRepo.listAllSites;
    invalidateSnapshotCache();
    try {
      anyRepo.listAllSites = async (limit?: number, options?: unknown) => {
        const rows = await original.call(ctx.repo, limit, options);
        // 模拟「构建正在进行时另一个实例写了一笔」：站点列表已经按旧值读完了
        await ctx.repo.run("UPDATE sites SET title = '构建窗口内的写入' WHERE id = 'vsite-9'");
        return rows;
      };
      const during = await getSnapshot();
      expect(itemTitle(during, "vsite-9")).toBe("版本站点 9");

      // 关键在**下一次**读：版本号是构建前读的，那次写入 bump 出来的新版本还没被消耗掉，
      // 于是这次必须重建。反过来（先建后读版本）会把旧快照标成「已是新版本」，
      // 下一次读直接命中，构建窗口里的写入永久不可见 —— 而快照是读-改-写的写侧数据源。
      const after = await getSnapshot();
      expect(
        itemTitle(after, "vsite-9"),
        "构建窗口里的写入被版本号判定为「已包含」：旧快照会一直喂给读-改-写",
      ).toBe("构建窗口内的写入");
    } finally {
      anyRepo.listAllSites = original;
    }
  });

  it("/api/health 报出版本号与缺失触发器数（判据坏了要能看见）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.navSnapshot, "健康面必须带 navSnapshot").toBeTruthy();
    // 健康报的是**库里的当前版本号**（不是缓存条目的版本）：运维要判的是「递增还在不在」
    expect(body.navSnapshot.version, "版本号读不到 = 迁移没跑完，这里必须能看见").toBeTypeOf("number");
    expect(body.navSnapshot.triggersMissing, "触发器缺失数不为 0 = 版本号会冻结").toBe(0);
    expect(body.navSnapshot.cached).toBe(false);
    expect(body.navSnapshot.ttlMs).toBeGreaterThanOrEqual(0);

    // 探针清单确实核对到了东西，且健康响应就是探针的读数（不是硬编码占位）
    const probe = await ctx.repo.navVersionProbe();
    expect(probe.present.length, "本进程的库应带全部 bump 触发器").toBeGreaterThan(0);
    expect(body.navSnapshot.version).toBe(probe.version);
    expect(body.navSnapshot.triggersMissing).toBe(probe.missing.length);
  });

  it("/api/metrics 的命中与回源计数随真实读取增长（观测接线生效）", async () => {
    const readSample = async (line: string): Promise<number> => {
      const body = await (await app.inject({ method: "GET", url: "/api/metrics" })).body;
      const found = body.split("\n").find((l) => l.startsWith(line + " "));
      expect(found, "缺少序列 " + line).toBeTruthy();
      return Number(found!.split(" ")[1]);
    };
    const missBefore = await readSample('navhub_snapshot_cache_total{result="miss"}');
    const hitBefore = await readSample('navhub_snapshot_cache_total{result="hit"}');

    await getSnapshot(); // 回源
    await getSnapshot(); // 命中
    expect(await readSample('navhub_snapshot_cache_total{result="miss"}')).toBeGreaterThanOrEqual(missBefore + 1);
    expect(await readSample('navhub_snapshot_cache_total{result="hit"}')).toBeGreaterThanOrEqual(hitBefore + 1);
    expect(await readSample("navhub_snapshot_last_bytes"), "体积读数必须是真实字节数").toBeGreaterThan(1024);
    expect(await readSample("navhub_snapshot_build_seconds_total")).toBeGreaterThan(0);
  });
});

describe("压缩与 ETag 的钩子顺序", () => {
  /**
   * registerCompression 必须晚于路由策略钩子注册（见 main.ts）。
   *
   * 反过来说：压缩钩子先跑 ⇒ 交给 ETag 钩子的 payload 已经是 Buffer，
   * `typeof payload !== "string"` 让它直接跳过 —— curl 测试（不带 Accept-Encoding）
   * 全绿，真实浏览器（必带 gzip）却一个 ETag 都拿不到，条件请求永远 200 全量重传。
   */
  it("带 Accept-Encoding: gzip 的读取仍然拿到 ETag，并能 304", async () => {
    const first = await app.inject({ method: "GET", url: NAV_URL, headers: { "accept-encoding": "gzip" } });
    expect(first.statusCode).toBe(200);
    expect(String(first.headers["content-encoding"] ?? "")).toContain("gzip");
    const etag = String(first.headers["etag"] ?? "");
    expect(etag, "压缩后的响应必须照样带 ETag").toMatch(/^".+"$/);
    expect(String(first.headers["vary"] ?? "").toLowerCase()).toContain("accept-encoding");

    const second = await app.inject({
      method: "GET",
      url: NAV_URL,
      headers: { "accept-encoding": "gzip", "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
  });

  /**
   * 顺序守卫的另一半：源码里的注册次序。
   *
   * 行为用例只能证明「现在这一种顺序是对的」；把它写成顺序断言，
   * 是因为把 `registerCompression` 挪到 buildServer 之前看起来完全无害
   * （都只是「注册两个钩子」），但它会让所有带 Accept-Encoding 的客户端永久失去 ETag。
   */
  it("main.ts 先 buildServer 再 registerCompression", () => {
    const src = readFileSync(resolve(API_ROOT, "src/main.ts"), "utf8");
    const built = src.indexOf("buildServer(ctx)");
    const compressed = src.indexOf("registerCompression(app)");
    expect(built, "main.ts 里没找到 buildServer(ctx)").toBeGreaterThanOrEqual(0);
    expect(compressed, "main.ts 里没找到 registerCompression(app)").toBeGreaterThanOrEqual(0);
    expect(compressed, "压缩钩子早于 buildServer 注册 ⇒ ETag 钩子收到的是 Buffer，条件请求全站失效").toBeGreaterThan(built);
  });
});
