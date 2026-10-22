/**
 * 生成前端内置的导航基线（apps/web-overlay/src/navsphere/content/navigation{,-default}.json）。
 *
 * 为什么要这个脚本：
 *   这两个 JSON 是「中枢没起来 / 库是空的」时的内容兜底（github.ts 的 baselineFor），
 *   而它是**上游 NavSphere 自带**的文件：类目还是老的 9 根 37 子、站点是上游演示数据。
 *   权威树升级成 18 根 / 215 叶之后，兜底页与真实树是两套结构；更糟的是
 *   `scripts/vendor-web.mjs` 每次升级底座都会把上游版本盖回来（该路径不在 overlay 里），
 *   所以必须把快照落进 overlay 副本，overlay 在 vendor 之后应用，永远赢。
 *
 * 生成口径：**不手写结构**，直接跑一遍 runSeed + buildNavigationData，
 * 也就是「空库启动一次中枢，快照接口会吐什么就写什么」。手写的基线一定会漂移。
 *
 * 站点 id 的确定性：seed 的站点没有显式 id（每次 randomUUID），直接导出会让基线文件
 * 每跑一次全量换血。这里按 URL 派生稳定 id，保证两次运行产出逐字节一致。
 *
 * 空叶子默认剪掉：空子类目在渲染层（filterNavigationData）本来就不出现，
 * 留在兜底文件里只是纯体积——215 叶里 178 个是空的，剪完文件小一半。
 * 要看真实全树形态加 --keep-empty。
 *
 * 用法：
 *   node scripts/gen-nav-baseline.mts            # dry-run：只打印规模与首尾摘要
 *   node scripts/gen-nav-baseline.mts --write    # 写入两个 overlay 基线文件
 *   node scripts/gen-nav-baseline.mts --write --keep-empty
 *
 * 只碰临时库：全程用 os.tmpdir() 下的一次性 SQLite，绝不读 data/navhub.db。
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runSeed } from "../apps/api/src/seed.ts";
import { buildNavigationData } from "../apps/api/src/storage.ts";
import { createContext } from "../apps/api/src/context.ts";
import { loadConfig } from "../apps/api/src/config.ts";

const ROOT = resolve(".");
const OUT_FILES = [
  join(ROOT, "apps", "web-overlay", "src", "navsphere", "content", "navigation.json"),
  join(ROOT, "apps", "web-overlay", "src", "navsphere", "content", "navigation-default.json"),
];
const WRITE = process.argv.includes("--write");
const KEEP_EMPTY = process.argv.includes("--keep-empty");

const dir = mkdtempSync(join(tmpdir(), "navhub-navbaseline-"));
const dbPath = join(dir, "baseline.db");
process.env.NAVHUB_MODE = "lite";
process.env.NAVHUB_SQLITE_PATH = dbPath;
// 基线只关心树与站点，向量与站点包插件都不必启动
process.env.NAVHUB_EMBEDDING_ENABLED = "false";

let ctx = null;
try {
  const seed = await runSeed({ withEmbeddings: false });
  console.log(
    `[seed] 类目 ${seed.categories} / 权威树 ${seed.registry.total}（新建 ${seed.registry.created}）/ 站点 ${seed.sites} / 插件 ${seed.plugins}`,
  );

  ctx = await createContext(loadConfig());
  const data = await buildNavigationData(ctx);

  /** URL → 稳定 id：同一个站两次生成拿到同一个 id，基线文件才不会整片换血 */
  const stableId = (url: string) => "nav-" + createHash("sha1").update(url).digest("hex").slice(0, 12);
  let itemIdsRewritten = 0;
  const fixItems = (items) => {
    for (const item of items ?? []) {
      if (item?.href) {
        item.id = stableId(item.href);
        itemIdsRewritten++;
      }
      // 增强字段（actions/relations/liveMetrics/workspaces/health）由中枢按 URL 现算，
      // 打进兜底文件只会让包变大（57 条链接就 66KB）。兜底页只要「能看到的目录 + 链接」。
      delete item.actions;
      delete item.relations;
      delete item.liveMetrics;
      delete item.workspaces;
      delete item.health;
      delete item.useDefaultIcon;
    }
  };
  for (const node of data.navigationItems) {
    fixItems(node.items);
    for (const sub of node.subCategories ?? []) fixItems(sub.items);
  }

  // 兜底页只需要「点得进去且有内容」的节点：渲染层本就会过滤空类目，
  // 把它们留在打包文件里是纯体积（215 叶里 178 个为空）。
  let prunedLeaves = 0;
  let prunedRoots = 0;
  if (!KEEP_EMPTY) {
    const roots = [];
    for (const node of data.navigationItems) {
      const subs = node.subCategories ?? [];
      const kept = subs.filter((s) => (s.items?.length ?? 0) > 0);
      prunedLeaves += subs.length - kept.length;
      if (kept.length > 0) node.subCategories = kept;
      else delete node.subCategories;
      if ((node.items?.length ?? 0) === 0 && kept.length === 0) {
        prunedRoots++;
        continue;
      }
      roots.push(node);
    }
    data.navigationItems.length = 0;
    data.navigationItems.push(...roots);
  }

  const roots = data.navigationItems.length;
  const subs = data.navigationItems.reduce((n, c) => n + (c.subCategories?.length ?? 0), 0);
  const links = data.navigationItems.reduce(
    (n, c) => n + (c.items?.length ?? 0) + (c.subCategories ?? []).reduce((m, s) => m + (s.items?.length ?? 0), 0),
    0,
  );
  const json = JSON.stringify(data, null, 2) + "\n";
  console.log(
    `[baseline] 根 ${roots} / 子类目 ${subs} / 链接 ${links} / id 重写 ${itemIdsRewritten}` +
      (KEEP_EMPTY ? "（--keep-empty：不剪空节点）" : `（剪掉空叶 ${prunedLeaves}、空根 ${prunedRoots}）`),
  );
  console.log(`[baseline] 体积 ${(Buffer.byteLength(json, "utf8") / 1024).toFixed(1)} KB（旧基线 ${
    existsSync(OUT_FILES[0]) ? (Buffer.byteLength(readFileSync(OUT_FILES[0]), "utf8") / 1024).toFixed(1) : "?"
  } KB）`);
  console.log(`[baseline] 根顺序：${data.navigationItems.map((c) => c.title).join("、")}`);

  if (!WRITE) {
    console.log("[baseline] DRY RUN：未写文件。确认口径后加 --write。");
    process.exitCode = 0;
  } else {
    for (const file of OUT_FILES) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, json, "utf8");
      console.log(`[baseline] 已写入 ${file.replace(ROOT + "/", "")}`);
    }
    console.log("[baseline] 提醒：跑 node scripts/check-web-overlay.mjs --fix 同步到 apps/web。");
  }
} finally {
  try {
    await ctx?.close();
  } catch {
    /* 临时库关闭失败不影响清理 */
  }
  rmSync(dir, { recursive: true, force: true });
}
