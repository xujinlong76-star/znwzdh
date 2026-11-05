/**
 * 压测种子（规划 P2「压测基线」的配套）：在一个**隔离库**里灌到约 N 个站点。
 *
 * 用法（仓库根目录）：
 *
 *   NAVHUB_SQLITE_PATH=./data/loadtest.db node scripts/seed-loadtest.mts --sites 10000 --fresh
 *   NAVHUB_SQLITE_PATH=./data/loadtest.db NAVHUB_PORT=8799 node apps/api/src/main.ts &
 *   node scripts/load-baseline.mts --url http://127.0.0.1:8799
 *
 * 三步：
 *   1. runSeed() 落权威树与基线站点；
 *   2. 安装全部 site-pack（生产内容真正来源，量级与真实站一致）；
 *   3. 不够 --sites 的部分用合成站点补齐，标题/描述/URL 长度按真实分布近似。
 *
 * 安全边界（改这个脚本时不要放开）：
 *   - 必须显式给 NAVHUB_SQLITE_PATH，且不能指向本机共享开发库 data/navhub.db；
 *   - 强制 lite 模式并清掉 NAVHUB_DATABASE_URL：压测种子永远不碰 PG；
 *   - 只有 --fresh 才删库，且删之前再过一遍路径判定。
 */
import { existsSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 共享开发库：并行会话正在用，删它等于删别人的工作树 */
const SHARED_DB = resolve("./data/navhub.db");

/**
 * 路径安全网（导出给测试）。
 *
 * 三条都必须成立，缺一条就会写坏别人的数据：
 *   1. 显式给了路径 —— 不设 NAVHUB_SQLITE_PATH 就退化成开发库；
 *   2. 不是共享开发库；
 *   3. `--fresh` 只删自己的 `loadtest*.db`，绝不删别的现存库。
 */
export function assertSafeLoadTestDb(
  rawPath: string | undefined,
  opts: { fresh?: boolean; exists?: (path: string) => boolean } = {},
): string {
  if (!rawPath || !rawPath.trim()) {
    throw new Error(
      "必须显式设置 NAVHUB_SQLITE_PATH 指向隔离库（例如 ./data/loadtest.db）；" +
        "不设就退化成开发库，种子会写进别人的数据里。",
    );
  }
  const target = resolve(rawPath);
  if (target === SHARED_DB) {
    throw new Error(`拒绝使用共享开发库：${target}`);
  }
  const exists = opts.exists ?? existsSync;
  if (opts.fresh && exists(target) && !basename(target).startsWith("loadtest")) {
    throw new Error(
      `--fresh 只允许删除 loadtest*.db，当前目标 ${basename(target)} 已存在且不是压测库；` +
        "要保留它就去掉 --fresh（脚本只会补齐站点，不删数据）。",
    );
  }
  return target;
}

function parseSites(argv: string[]): number {
  const index = argv.indexOf("--sites");
  if (index === -1) return 10_000;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 100) {
    throw new Error("--sites 必须是 >=100 的整数");
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`用法：NAVHUB_SQLITE_PATH=./data/loadtest.db node scripts/seed-loadtest.mts [--sites 10000] [--fresh]

  --sites <n>   目标站点数（>=100，默认 10000）
  --fresh       先删除目标库文件（只有这一种删除，且路径必须过安全检查）`);
    return;
  }

  const targetSites = parseSites(argv);
  const fresh = argv.includes("--fresh");
  const dbPath = assertSafeLoadTestDb(process.env.NAVHUB_SQLITE_PATH, { fresh });
  if (fresh && existsSync(dbPath)) {
    rmSync(dbPath);
    console.log(`[seed:load] 已删除旧库 ${dbPath}`);
  }

  // 顺序很重要：这些必须在 import seed.ts / config.ts 之前落定 ——
  // 它们在模块初始化时读环境变量。
  process.env.NAVHUB_SQLITE_PATH = dbPath;
  process.env.NAVHUB_MODE = "lite";
  delete process.env.NAVHUB_DATABASE_URL;

  const { runSeed } = await import("../apps/api/src/seed.ts");
  const { loadConfig } = await import("../apps/api/src/config.ts");
  const { createContext } = await import("../apps/api/src/context.ts");
  const { seedPluginDefs } = await import("../apps/api/src/seed-plugins.ts");
  const { installPlugin } = await import("../packages/store/src/repository/plugins.ts");

  const t0 = Date.now();
  const seeded = await runSeed({ withEmbeddings: false });
  console.log(`[seed:load] 基线种子 ${Date.now() - t0}ms`, JSON.stringify(seeded));

  const ctx = await createContext(loadConfig());
  try {
    const packs = seedPluginDefs().filter((d) => d.manifest.kind === "site-pack");
    let added = 0;
    for (const pack of packs) {
      try {
        const result = await installPlugin(ctx.repo, pack.slug, "loadtest");
        added += result.applied.sitesAdded;
      } catch (err) {
        console.warn(`[seed:load] site-pack 安装失败 ${pack.slug}:`, (err as Error).message);
      }
    }
    console.log(`[seed:load] site-pack 补齐 ${added} 个站点（${Date.now() - t0}ms）`);

    const count = async (): Promise<number> => {
      const rows = await ctx.repo.raw("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL");
      return Number((rows[0] as Record<string, unknown>)?.n ?? 0);
    };
    let current = await count();
    if (current >= targetSites) {
      console.log(`[seed:load] 已有 ${current} 个站点，达到目标 ${targetSites}，跳过合成补齐`);
    } else {
      // 合成站点挂在已启用的叶子类目上轮转：让 /api/sites 的过滤与分类页都有数据
      const leaves = (await ctx.repo.raw(
        "SELECT id FROM categories WHERE enabled = 1 AND parent_id IS NOT NULL ORDER BY id",
      )) as Array<Record<string, unknown>>;
      const categoryIds = leaves.map((row) => String(row.id));
      const t1 = Date.now();
      let created = 0;
      for (let i = current; i < targetSites; i++) {
        const categoryId = categoryIds[i % categoryIds.length];
        await ctx.repo.createSiteWithId({
          id: `load-${i}`,
          url: `https://load-${i}.example.com/${"path".repeat(1 + (i % 4))}`,
          title: `压测站点 ${i} ${"标题填充".repeat(i % 3)}`,
          description: `压测用站点 ${i}：用于把列表、搜索与分类聚合推到生产量级的填充描述。`.repeat(1 + (i % 2)),
          categoryId,
          sort: i,
          source: "api",
        });
        created++;
        if (created % 1000 === 0) console.log(`[seed:load] 合成 ${created}/${targetSites - current}`);
      }
      console.log(`[seed:load] 合成补齐完成 ${created} 个（${Date.now() - t1}ms）`);
    }

    const rows = await ctx.repo.raw(
      "SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL AND enabled = 1 AND status = 'active'",
    );
    console.log(
      JSON.stringify(
        {
          db: dbPath,
          sites: Number((rows[0] as Record<string, unknown>)?.n ?? 0),
          elapsedMs: Date.now() - t0,
        },
        null,
        2,
      ),
    );
  } finally {
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[seed:load] " + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
}
