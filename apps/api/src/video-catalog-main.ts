/**
 * 视频库关系表 CLI（C6 迁移 / 对账）。
 *
 * 用法：
 *   # 把当前 KV 文档导入关系表（幂等，全量替换）
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts
 *
 *   # 只对账，不写库（切读前的门禁）
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts --check
 *
 *   # 机器可读输出（日志走 stderr，stdout 只有一段 JSON，可直接 jq）
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts --check --json
 *
 *   # 控制差异样例条数（默认 10）
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts --check --sample 50
 *
 *   # 指定数据库（不污染开发库，CI / 演练用）
 *   NAVHUB_SQLITE_PATH=/tmp/x.db node --experimental-strip-types apps/api/src/video-catalog-main.ts
 *
 *   # 载入文件且这次确实是大规模删除时（写入库内 80% 以下会被缩水保护拦下）：
 *   # 两段都要给，且 --expected-count 必须等于文件里的真实条数
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts \
 *     --from-file new-videos.json --confirm-large-deletion --expected-count 120
 *
 * **为什么必须读原始 KV 而不是 `readVideosData`**：
 *   `readVideosData` 在 `db` 模式下返回的是**由关系表重建的文档**。用它去和关系表
 *   对账，等于拿表和自己比，永远「一致」——切读前的最后一道门禁会静默失效。
 *   这里固定读 `kv:videos` 原始载荷，保证比的是两个真正独立的事实源。
 *
 * 退出码：
 *   0 = 成功 / 对账一致
 *   1 = 失败 / 不一致
 *   2 = KV 里没有视频库数据（从未保存过），无法对账
 */
import { readFileSync, existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { readKv, writeVideosData, VideoShrinkError } from "./storage.ts";
import {
  checkVideoCatalogConsistency,
  resolveVideoStoreMode,
  syncVideoCatalog,
} from "./video-catalog.ts";

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const jsonOut = argv.includes("--json");

const sampleArg = argv.indexOf("--sample");
const sampleSize = (() => {
  if (sampleArg === -1) return 10;
  const n = Number(argv[sampleArg + 1]);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 500) : 10;
})();

const fromFileIdx = argv.indexOf("--from-file");
const fromFilePath = fromFileIdx !== -1 ? argv[fromFileIdx + 1] : null;

/**
 * 缩水保护二阶段确认（升级方案 P2）。
 *
 * `--expected-count` 解析不出合法数字时**不静默丢弃**：确认参数拼错的结果应该是
 * 明确失败，而不是让脚本以为已经确认过了。
 */
const confirmLargeDeletion = argv.includes("--confirm-large-deletion");
const expectedCountIdx = argv.indexOf("--expected-count");
const expectedCountRaw = expectedCountIdx !== -1 ? argv[expectedCountIdx + 1] : undefined;
const expectedCount =
  expectedCountRaw !== undefined && Number.isInteger(Number(expectedCountRaw)) && Number(expectedCountRaw) >= 0
    ? Number(expectedCountRaw)
    : undefined;

// 确认参数只给了一半时立刻失败：静默丢掉拼错的 --expected-count，
// 操作者会以为「我已经确认过了」，实际拿到的是一个永远 409 的重试。
if (confirmLargeDeletion && expectedCount === undefined) {
  fail(
    `[video-catalog] --confirm-large-deletion 必须与 --expected-count <本次真实条数> 同时给出` +
      `（收到 --expected-count=${String(expectedCountRaw)}，需为非负整数）。`,
  );
  process.exit(1);
}

/** 机器可读模式下，人读日志一律走 stderr，避免污染 stdout 的 JSON */
function note(message: string): void {
  if (jsonOut) console.error(message);
  else console.info(message);
}

function fail(message: string): void {
  console.error(message);
}

const config = loadConfig();
const ctx = await createContext(config);

try {
  let doc: unknown;
  if (fromFilePath) {
    if (!existsSync(fromFilePath)) {
      fail(`[video-catalog] 文件不存在: ${fromFilePath}`);
      process.exit(2);
    }
    doc = JSON.parse(readFileSync(fromFilePath, "utf8"));
    try {
      await writeVideosData(ctx, doc, undefined, {
        confirmLargeDeletion,
        expectedCount,
        // CLI 没有请求方身份，审计只能记成 system：谁在什么时候按确认跑了这次批量删除，
        // 事后必须查得到，否则「放行」就成了无痕操作。
        onLargeDeletionConfirmed: async (verdict) => {
          await ctx.repo.audit({
            actor: "cli:video-catalog",
            actorKind: "system",
            action: "storage.videos.large_deletion",
            target: "videos.json",
            diff: {
              existingCount: verdict.existingCount,
              incomingCount: verdict.incomingCount,
              minimumAllowed: verdict.minimumAllowed,
              declaredExpectedCount: verdict.declaredExpectedCount ?? verdict.incomingCount,
              fromFile: fromFilePath,
            },
          });
        },
      });
    } catch (err) {
      // 缩水拦截是按设计拒绝，不是脚本故障：打一条能直接照抄的重试命令，
      // 而不是一屏堆栈让操作者去猜这次到底要带什么参数。
      if (err instanceof VideoShrinkError) {
        fail(`[video-catalog] ${err.message}`);
        fail(
          "  重试：node --experimental-strip-types apps/api/src/video-catalog-main.ts " +
            `--from-file ${fromFilePath} --confirm-large-deletion --expected-count ${err.verdict.incomingCount}`,
        );
        process.exit(1);
      }
      throw err;
    }
    note(`[video-catalog] 已将 ${fromFilePath} 载入 KV (kv:videos)`);
  } else {
    doc = await readKv(ctx, "videos");
  }

  if (!doc || typeof doc !== "object") {
    fail("[video-catalog] KV 文档里没有视频库数据（从未保存过），无法对账 / 导入。");
    process.exit(2);
  }

  const mode = resolveVideoStoreMode();

  if (checkOnly) {
    const result = await checkVideoCatalogConsistency(ctx, doc);

    if (jsonOut) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: result.ok,
            mode,
            doc: { categories: result.docCategories, items: result.docItems },
            db: { categories: result.dbCategories, items: result.dbItems },
            missingInDb: result.missingInDb,
            extraInDb: result.extraInDb,
            mismatched: result.mismatched,
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      note("[video-catalog] 一致性对账（KV 文档 ↔ 关系表）：");
      note(`  NAVHUB_VIDEO_STORE=${mode}`);
      note(`  文档分类 ${result.docCategories} / 表内 ${result.dbCategories}`);
      note(`  文档条目 ${result.docItems} / 表内 ${result.dbItems}`);
      if (result.missingInDb.length > 0) {
        fail(`  缺失（文档有、表没有）${result.missingInDb.length} 条：${result.missingInDb.slice(0, sampleSize).join(", ")}`);
      }
      if (result.extraInDb.length > 0) {
        fail(`  多余（表有、文档没有）${result.extraInDb.length} 条：${result.extraInDb.slice(0, sampleSize).join(", ")}`);
      }
      if (result.mismatched.length > 0) {
        fail(`  字段漂移 ${result.mismatched.length} 处：`);
        for (const m of result.mismatched.slice(0, sampleSize)) {
          fail(`    ${m.id}.${m.field}: 文档=${JSON.stringify(m.doc)} 表=${JSON.stringify(m.db)}`);
        }
      }
      note(result.ok ? "[video-catalog] ✓ 一致" : "[video-catalog] ✗ 不一致");
    }

    process.exit(result.ok ? 0 : 1);
  }

  // 导入不依赖 NAVHUB_VIDEO_STORE 的当前取值：即使模式是 json 也要能手工补一次数据
  const counts = await syncVideoCatalog(ctx, doc);
  if (!counts) {
    // 模式为 json 时 syncVideoCatalog 直接返回 null —— 这里绕开它再走一次全量导入
    const { flattenVideoCatalog } = await import("./video-catalog.ts");
    const { replaceVideoCatalog } = await import("@navhub/store");
    const flattened = flattenVideoCatalog(doc);
    const written = await replaceVideoCatalog(ctx.repo, flattened.categories, flattened.items);
    note(
      `[video-catalog] 已导入（NAVHUB_VIDEO_STORE=${mode}，手工导入）：` +
        `${written.categories} 分类 / ${written.items} 条目 / ${flattened.replacements.length} 条审计`,
    );
  } else {
    note(
      `[video-catalog] 已导入（NAVHUB_VIDEO_STORE=${mode}）：` +
        `${counts.categories} 分类 / ${counts.items} 条目 / ${counts.replacements} 条审计`,
    );
  }

  const after = await checkVideoCatalogConsistency(ctx, doc);
  if (!after.ok) {
    fail("[video-catalog] 导入后一致性检查未通过，请检查上面的差异项。");
    process.exit(1);
  }
  note("[video-catalog] ✓ 导入后校验一致");
} finally {
  await ctx.close();
}
