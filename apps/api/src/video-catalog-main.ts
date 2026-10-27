/**
 * 视频库关系表 CLI（C6 迁移 / 校验）。
 *
 * 用法：
 *   # 把当前 KV 文档导入关系表（幂等，全量替换）
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts
 *
 *   # 只校验一致性，不写库
 *   node --experimental-strip-types apps/api/src/video-catalog-main.ts --check
 *
 *   # 指定数据库（不污染开发库，CI / 演练用）
 *   NAVHUB_SQLITE_PATH=/tmp/x.db node --experimental-strip-types apps/api/src/video-catalog-main.ts
 *
 * 与 main.ts / seed-main.ts 同理：不做主模块判断，导入即执行 ——
 * Windows 上的路径形式差异会让 `import.meta.url === argv[1]` 恒为 false，脚本静默不跑。
 *
 * 退出码：
 *   0 = 成功（--check 时为「一致」）
 *   1 = 失败 / 不一致
 *   2 = 文档里没有可导入的数据（从未保存过视频库）
 */
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { readVideosData } from "./storage.ts";
import {
  checkVideoCatalogConsistency,
  resolveVideoStoreMode,
  syncVideoCatalog,
} from "./video-catalog.ts";

const checkOnly = process.argv.includes("--check");

const config = loadConfig();
const ctx = await createContext(config);

try {
  const doc = await readVideosData(ctx);
  if (!doc || typeof doc !== "object") {
    console.error("[video-catalog] KV 文档里没有视频库数据（从未保存过），无需导入。");
    process.exit(2);
  }

  if (checkOnly) {
    const result = await checkVideoCatalogConsistency(ctx, doc);
    console.info("[video-catalog] 一致性检查：");
    console.info(`  文档分类 ${result.docCategories} / 表内 ${result.dbCategories}`);
    console.info(`  文档条目 ${result.docItems} / 表内 ${result.dbItems}`);
    if (result.missingInDb.length > 0) {
      console.error(`  缺失（文档有、表没有）：${result.missingInDb.slice(0, 10).join(", ")}`);
    }
    if (result.extraInDb.length > 0) {
      console.error(`  多余（表有、文档没有）：${result.extraInDb.slice(0, 10).join(", ")}`);
    }
    for (const m of result.mismatched.slice(0, 10)) {
      console.error(`  字段不一致 ${m.id}.${m.field}: 文档=${JSON.stringify(m.doc)} 表=${JSON.stringify(m.db)}`);
    }
    console.info(result.ok ? "[video-catalog] ✓ 一致" : "[video-catalog] ✗ 不一致");
    process.exit(result.ok ? 0 : 1);
  }

  // 导入不依赖 NAVHUB_VIDEO_STORE 的当前取值：即使模式是 json 也要能手工补一次数据
  const mode = resolveVideoStoreMode();
  const counts = await syncVideoCatalog(ctx, doc);
  if (!counts) {
    // 模式为 json 时 syncVideoCatalog 直接返回 null —— 这里绕开它再走一次全量导入
    const { flattenVideoCatalog } = await import("./video-catalog.ts");
    const { replaceVideoCatalog } = await import("@navhub/store");
    const flattened = flattenVideoCatalog(doc);
    const written = await replaceVideoCatalog(ctx.repo, flattened.categories, flattened.items);
    console.info(
      `[video-catalog] 已导入（NAVHUB_VIDEO_STORE=${mode}，手工导入）：` +
        `${written.categories} 分类 / ${written.items} 条目 / ${flattened.replacements.length} 条审计`,
    );
  } else {
    console.info(
      `[video-catalog] 已导入（NAVHUB_VIDEO_STORE=${mode}）：` +
        `${counts.categories} 分类 / ${counts.items} 条目 / ${counts.replacements} 条审计`,
    );
  }

  const after = await checkVideoCatalogConsistency(ctx, doc);
  if (!after.ok) {
    console.error("[video-catalog] 导入后一致性检查未通过，请检查上面的差异项。");
    process.exit(1);
  }
  console.info("[video-catalog] ✓ 导入后校验一致");
} finally {
  await ctx.close();
}
