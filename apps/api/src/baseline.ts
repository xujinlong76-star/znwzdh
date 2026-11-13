/**
 * 部署冷启动基线导入（DEV_BACKLOG A1）。
 *
 * 问题：仓库事实源是 web-overlay 内容文件里的 333 站导航与 6007 条视频，
 * 但中枢的种子（seed-data.json）只有 84 站、视频为零；两份事实源数据此前
 * 只能靠人工 `PUT /api/storage` 整包写入。全新部署严格照清单走一遍，
 * 打开的会是一个「半空站」：前台有数、中枢空转，AI 找站与 /api/videos
 * 全部受损，而且**没有任何报错**会告诉部署者少了什么。
 *
 * 做法：种子阶段（runSeed）在写入任何站点之前先跑本模块——
 *   - 导航：库里站点数为 0 时，把 navigation.json 经 `writeNavigationData`
 *     （与 PUT /api/storage 完全同一条写回通道，含标签同步与向量回填）
 *     整包导入；已有站点则整段跳过，绝不覆盖、不对齐、不删任何现有数据。
 *   - 视频：KV 文档 `videos` 从未写入时，把 videos.json 经 `writeVideosData`
 *     （同一条通道，含影子表同步）导入；已存在则跳过。
 * 两份数据各自独立设闸：一份失败/缺失不挡另一份；导航导入失败时 runSeed
 * 会继续走 seed-data.json 的 84 站兜底（站点至少能用），但失败会以
 * `[baseline]` 前缀打 error 日志、写进基线标记，并在 seed 结果里如实回报，
 * 不静默。
 *
 * 已有库的 URL 漂移修复（A1 收尾）：只做整包导入的库，之后文件里的搬家
 * （改名换址、域名迁移）永远到不了库——实测 2026-11-12 预览库仍在服
 * klingai.kuaishou.com 等 8 条旧址，而文件早已改成新址。于是导航段为
 * `skipped_existing` 时再跑一遍窄口径 URL 同步（syncMovedSiteUrls）：
 * 只按文件站点的稳定 id（nav-xxxx）对上库里的行、且 URL 变了才改；
 * 只改 url 与按快照口径重算的 iconKey，不增、不删、不动标题/描述/分类/
 * 标签/分面；文件里没有的旧行（如下架站、改名换 id 的旧行）一律不动。
 * 文件是事实源的既有语义：后台手工改过的 URL 若与文件不一致也会被拉回
 * 文件值（与全新部署直接导文件一致）；想关掉它设
 * NAVHUB_BASELINE_URL_SYNC=0。每次结论写进 urlSync 段，随标记落库。
 *
 * 结果标记：每次种子运行结束都把本次基线检查的结论写成一份普通存储文档
 * `baseline-import.json`（kv:doc:），后台「数据管理」页据此展示灌入状态；
 * 标记只是账本，不是闸门——闸门永远只看真实数据（站点数 / KV 是否存在），
 * 所以标记丢了也不会重复灌，标记在而数据没了也会重新灌。
 *
 * 基线文件从哪读（按序取第一个命中的目录，可用 NAVHUB_BASELINE_DIR 覆盖）：
 *   1. $NAVHUB_BASELINE_DIR
 *   2. apps/api/seed-content/（Docker 镜像构建时从 web-overlay 内容目录拷入）
 *   3. apps/web-overlay/src/navsphere/content/（仓库内直接运行时的事实源本体）
 * 事实源只有一份（web-overlay 内容文件），镜像里是构建期拷贝，不另立副本。
 *
 * 关闭：NAVHUB_BASELINE_IMPORT=0 时整段跳过（标记记 disabled）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSiteIcon } from "@navhub/core";
import type { AppContext } from "./context.ts";
import {
  countVideoDocItems,
  readKv,
  writeNavigationData,
  writeStoragePath,
  writeVideosData,
} from "./storage.ts";

/** writeNavigationData 的入参形状（storage.ts 内部类型，未导出，按参数位引用） */
type NavigationDoc = Parameters<typeof writeNavigationData>[1];

/** 基线检查结论的存储文档路径（经 /api/storage 以普通文档读写） */
export const BASELINE_MARKER_PATH = "baseline-import.json";

export type BaselineSectionStatus =
  | "imported" // 本次刚灌入
  | "skipped_existing" // 已有数据，按幂等纪律跳过
  | "missing_file" // 库是空的但基线文件不在（镜像/部署形态缺文件）
  | "failed" // 尝试导入但失败（error 字段有原因）
  | "disabled"; // NAVHUB_BASELINE_IMPORT=0 显式关闭

export interface BaselineSectionResult {
  status: BaselineSectionStatus;
  /** 现存/灌入后的条数（导航=站点数，视频=条目数）；不适用为 null */
  count: number | null;
  /** 基线文件里的条数；文件不可读为 null */
  fileCount: number | null;
  error?: string;
}

export interface BaselineNavigationResult extends BaselineSectionResult {
  /** 现存/灌入后的类目数（顶级+二级）；不适用为 null */
  categories: number | null;
}

export interface BaselineImportResult {
  version: 1;
  /** 本次检查时间（ISO） */
  at: string;
  navigation: BaselineNavigationResult;
  videos: BaselineSectionResult;
  /** 已有库的 URL 漂移修复结论（见 syncMovedSiteUrls） */
  urlSync: UrlSyncResult;
  /** 结论标记是否成功落库（A9 后台页靠它展示；落不了不影响数据本身） */
  markerWritten: boolean;
}

/** URL 同步修复的结论状态 */
export type UrlSyncStatus =
  | "synced" // 已比对（updated 可能为 0，即无漂移）
  | "skipped_fresh" // 本次刚导入基线，无存量可修
  | "skipped_disabled" // NAVHUB_BASELINE_IMPORT=0 或 NAVHUB_BASELINE_URL_SYNC=0
  | "missing_file" // 读不到 navigation.json
  | "failed"; // 比对/写库出错，或导航基线导入失败导致本次跳过

export interface UrlRepair {
  id: string;
  title: string;
  from: string;
  to: string;
}

export interface UrlSyncResult {
  status: UrlSyncStatus;
  /** 本次比对的文件站点数 */
  checked: number;
  /** 本次改写 URL 的行数 */
  updated: number;
  /** 改写明细（量小：文件 333 站，全列也不大） */
  repairs: UrlRepair[];
  error?: string;
}

/** URL 比对只去尾斜杠：`https://gogs.io` 与 `https://gogs.io/` 视为同一地址，避免无意义改写 */
export function normalizeUrlForCompare(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** 从一份导航文档里抽出全部站点（顶级 items + 二级 items，与 countNavigationDoc 同口径） */
export function collectFileSites(data: unknown): Array<{ id: string; title: string; href: string; icon?: string }> {
  const items = (data as { navigationItems?: any[] })?.navigationItems || [];
  const out: Array<{ id: string; title: string; href: string; icon?: string }> = [];
  for (const top of items) {
    for (const item of top.items ?? []) {
      out.push({ id: item.id, title: item.title ?? item.href, href: item.href, icon: item.icon });
    }
    for (const sub of top.subCategories ?? []) {
      for (const item of sub.items ?? []) {
        out.push({ id: item.id, title: item.title ?? item.href, href: item.href, icon: item.icon });
      }
    }
  }
  return out;
}

/**
 * 已有库的 URL 漂移修复：文件站点按稳定 id 对上库里的行、URL 变了才改写。
 *
 * 只改 url 与 iconKey（iconKey 按 snapshotSiteWrite 同口径重算：文件 icon
 * 优先、否则按新地址推导；旧行若被人工改过自定义图标也会被拉回文件口径，
 * 与「文件是事实源」的既有语义一致）。不增、不删：文件里没有的旧行
 * （下架站、改名换 id 的旧行）不动；文件新增的 id 也不插入——插站是基线
 * 导入的职责，且种子无法区分「管理员删站」与「文件新增」，擅自插回会把
 * 删站复活。updateSite 会同步重建该行的全文/pinyin 索引，搜新地址可搜到。
 */
export async function syncMovedSiteUrls(
  ctx: AppContext,
  navData: unknown,
  log: (line: string) => void = (line) => console.info(line),
): Promise<UrlSyncResult> {
  const fileSites = collectFileSites(navData);
  const rows = (await ctx.repo.raw(
    "SELECT id, url, icon_key FROM sites WHERE deleted_at IS NULL",
  )) as unknown as Array<{ id: string; url: string; icon_key: string | null }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const repairs: UrlRepair[] = [];
  for (const site of fileSites) {
    if (!site.id || !site.href) continue;
    const row = byId.get(site.id);
    if (!row) continue;
    if (normalizeUrlForCompare(row.url) === normalizeUrlForCompare(site.href)) continue;
    const newIconKey = resolveSiteIcon(site.href, site.title, site.icon ?? null) || null;
    const patch: { url: string; iconKey?: string | null } = { url: site.href };
    if (newIconKey !== row.icon_key) patch.iconKey = newIconKey;
    await ctx.repo.updateSite(site.id, patch);
    repairs.push({ id: site.id, title: site.title, from: row.url, to: site.href });
    log(`[baseline] URL 同步修复：${site.title} ${row.url} → ${site.href}`);
  }
  return { status: "synced", checked: fileSites.length, updated: repairs.length, repairs };
}

/** 数一份导航文档的类目与站点（与 writeNavigationData 的遍历口径一致） */
export function countNavigationDoc(data: unknown): { categories: number; sites: number } {
  const items = (data as { navigationItems?: any[] })?.navigationItems || [];
  let categories = 0;
  let sites = 0;
  for (const top of items) {
    categories++;
    sites += top.items?.length || 0;
    for (const sub of top.subCategories || []) {
      categories++;
      sites += sub.items?.length || 0;
    }
  }
  return { categories, sites };
}

/** 基线文件候选目录（按优先级）；抽出来供单测注入 */
export function baselineContentDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs: string[] = [];
  if (env.NAVHUB_BASELINE_DIR) dirs.push(env.NAVHUB_BASELINE_DIR);
  // Docker 镜像：构建时拷到 apps/api/seed-content/
  dirs.push(join(here, "..", "seed-content"));
  // 仓库内运行：web-overlay 内容目录就是事实源本体
  dirs.push(join(here, "..", "..", "web-overlay", "src", "navsphere", "content"));
  return dirs;
}

/** 在候选目录里找一份基线文件；找不到返回 null */
export function resolveBaselineFile(name: string, dirs: string[] = baselineContentDirs()): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function countExistingSites(ctx: AppContext): Promise<number> {
  const rows = (await ctx.repo.raw("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL")) as unknown as Array<{
    n: number;
  }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * 执行一次冷启动基线检查+导入。由 runSeed 在写入任何站点之前调用；
 * 本函数对单份数据的失败不抛错（收进结果并打 error 日志），让种子主流程
 * 能带着「基线失败、已降级兜底」的事实继续启动，而不是整个种子崩掉。
 */
export async function runBaselineImport(
  ctx: AppContext,
  log: (line: string) => void = (line) => console.info(line),
  opts: { dirs?: string[] } = {},
): Promise<BaselineImportResult> {
  const at = new Date().toISOString();
  const disabled = process.env.NAVHUB_BASELINE_IMPORT === "0";
  const dirs = opts.dirs ?? baselineContentDirs();

  let navigation: BaselineNavigationResult;
  let videos: BaselineSectionResult;

  /* ---------------- 导航 ---------------- */
  const navFile = resolveBaselineFile("navigation.json", dirs);
  let navFileCounts: { categories: number; sites: number } | null = null;
  if (navFile) {
    try {
      navFileCounts = countNavigationDoc(readJsonFile(navFile));
    } catch {
      // 文件在但读不出：当作缺失处理，下面 failed/missing 分支会如实记录
      navFileCounts = null;
    }
  }

  if (disabled) {
    navigation = { status: "disabled", count: null, categories: null, fileCount: navFileCounts?.sites ?? null };
  } else {
    const existing = await countExistingSites(ctx);
    if (existing > 0) {
      navigation = {
        status: "skipped_existing",
        count: existing,
        categories: null,
        fileCount: navFileCounts?.sites ?? null,
      };
      log(`[baseline] 导航基线跳过：库里已有 ${existing} 个站点（幂等，不覆盖现有数据）`);
    } else if (!navFile || !navFileCounts) {
      navigation = { status: "missing_file", count: 0, categories: 0, fileCount: null };
      console.error(
        "[baseline] 错误：库里没有站点且找不到可读的 navigation.json 基线文件，" +
          "导航将只有 seed-data.json 的兜底站点。请检查镜像是否包含 seed-content，或设置 NAVHUB_BASELINE_DIR。",
      );
    } else {
      try {
        const written = await writeNavigationData(ctx, readJsonFile(navFile) as NavigationDoc);
        navigation = {
          status: "imported",
          count: written.sites,
          categories: written.categories,
          fileCount: navFileCounts.sites,
        };
        log(`[baseline] 导航基线已导入：${written.categories} 个类目 / ${written.sites} 个站点（文件基线 ${navFileCounts.sites} 站）`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        navigation = { status: "failed", count: 0, categories: 0, fileCount: navFileCounts.sites, error: message };
        console.error(`[baseline] 错误：导航基线导入失败，将降级为 seed-data.json 兜底：${message}`);
      }
    }
  }

  /* ---------------- URL 漂移修复 ---------------- */
  // 只在「库里已有站点、本次没重灌」时跑：刚灌入的库与文件天然一致，无可修；
  // 导航导入失败时也跳过——库状态不明，不拿文件值乱写。
  let urlSync: UrlSyncResult;
  if (disabled) {
    urlSync = { status: "skipped_disabled", checked: 0, updated: 0, repairs: [] };
  } else if (navigation.status === "imported") {
    urlSync = { status: "skipped_fresh", checked: 0, updated: 0, repairs: [] };
  } else if (navigation.status !== "skipped_existing") {
    urlSync = {
      status: "failed",
      checked: 0,
      updated: 0,
      repairs: [],
      error: `导航基线导入失败（${navigation.status}），本次跳过 URL 同步`,
    };
  } else if (!navFile || !navFileCounts) {
    urlSync = { status: "missing_file", checked: 0, updated: 0, repairs: [] };
  } else if (process.env.NAVHUB_BASELINE_URL_SYNC === "0") {
    urlSync = { status: "skipped_disabled", checked: 0, updated: 0, repairs: [] };
  } else {
    try {
      urlSync = await syncMovedSiteUrls(ctx, readJsonFile(navFile), log);
      log(
        urlSync.updated > 0
          ? `[baseline] URL 同步修复完成：${urlSync.updated} 条（共比对 ${urlSync.checked} 站）`
          : `[baseline] URL 同步检查：无漂移（共比对 ${urlSync.checked} 站）`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      urlSync = { status: "failed", checked: 0, updated: 0, repairs: [], error: message };
      console.error(`[baseline] 错误：URL 同步修复失败（不影响种子主流程）：${message}`);
    }
  }

  /* ---------------- 视频 ---------------- */
  const videoFile = resolveBaselineFile("videos.json", dirs);
  let videoFileCount: number | null = null;
  if (videoFile) {
    try {
      videoFileCount = countVideoDocItems(readJsonFile(videoFile));
    } catch {
      videoFileCount = null;
    }
  }

  if (disabled) {
    videos = { status: "disabled", count: null, fileCount: videoFileCount };
  } else {
    const existingDoc = await readKv(ctx, "videos");
    if (existingDoc !== null) {
      const existingCount = countVideoDocItems(existingDoc);
      videos = { status: "skipped_existing", count: existingCount, fileCount: videoFileCount };
      log(`[baseline] 视频基线跳过：KV 视频库已有 ${existingCount} 条（幂等，不覆盖现有数据）`);
    } else if (!videoFile || videoFileCount === null) {
      videos = { status: "missing_file", count: 0, fileCount: null };
      console.error(
        "[baseline] 错误：视频库为空且找不到可读的 videos.json 基线文件，/api/videos 将为空。" +
          "请检查镜像是否包含 seed-content，或设置 NAVHUB_BASELINE_DIR。",
      );
    } else {
      try {
        const data = readJsonFile(videoFile);
        await writeVideosData(ctx, data);
        videos = { status: "imported", count: countVideoDocItems(data), fileCount: videoFileCount };
        log(`[baseline] 视频基线已导入：${videos.count} 条（文件基线 ${videoFileCount} 条）`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        videos = { status: "failed", count: 0, fileCount: videoFileCount, error: message };
        console.error(`[baseline] 错误：视频基线导入失败：${message}`);
      }
    }
  }

  /* ---------------- 结论标记 ---------------- */
  // 落库的标记不含 markerWritten 字段：文档能被读到本身就是「已写入」的证据，
  // 把结论写进返回值即可，没必要让标记自证。
  const marker = { version: 1 as const, at, navigation, videos, urlSync };
  let markerWritten = false;
  try {
    await writeStoragePath(ctx, BASELINE_MARKER_PATH, JSON.stringify(marker));
    markerWritten = true;
  } catch (err) {
    console.error(
      `[baseline] 错误：基线结论标记写入失败（数据本身不受影响）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { ...marker, markerWritten };
}
