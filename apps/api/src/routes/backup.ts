import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppContext } from "../context.ts";
import {
  canonicalizeUrl,
  exportNetscapeBookmarks,
  exportNavHubBackup,
  validateNavHubBackup,
  type NavHubColdBackup,
} from "@navhub/core";

/**
 * 书签导出单次最多带多少站点。
 *
 * 存在的意义是"别把整库读进内存"这一层保护，而不是分页语义：
 * repo.listSites() 的默认 limit=100 曾让书签/冷备静默只含前 100 条，
 * 用户拿到的是**不完整备份**却看不出任何异常。导出必须显式走全量通道
 * （listAllSites），上限给到实际导航库不可能触及的量级，并且只在
 * 匿名可触发的书签导出上设限；admin 冷备不设限（见下）。
 */
const EXPORT_MAX_SITES = Math.max(100, Number(process.env.NAVHUB_EXPORT_MAX_SITES || 20_000));

/**
 * 单次恢复的条目上限。
 *
 * 4MB bodyLimit 只能限制字节数，拦不住“十万条超短记录”这种形状；恢复是
 * admin 触发的全量写事务，一旦在中途被 OOM/超时打断，回滚成本同样高。
 * 上限按实际导航库量级给足余量（导出端 EXPORT_MAX_SITES 是 2 万）。
 */
const RESTORE_MAX_CATEGORIES = 2_000;
const RESTORE_MAX_SITES = 50_000;

/**
 * 恢复端点专用的 body 上限（16MB）。
 *
 * 全局 bodyLimit 是 4MB，而备份包实测约 **187 字节/站点**：4MB 只够约 2.1 万条，
 * 于是「最多 5 万条」这条声明在真实数据上根本达不到（用户会收到传输层的 413，
 * 而不是我们那条「备份条目过多」的说明）。16MB 覆盖 5 万条（约 9.27MB）并留余量。
 * 只对这两个恢复端点放宽，其余接口仍走全局 4MB。
 */
const RESTORE_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * 把恢复失败的原始错误归成可上报的类别。
 *
 * 只回类别、不回 message：数据库报错里常带着具体值（重复的 URL、约束名），
 * 那是用户数据，不该出现在 HTTP 响应里；但「是重复键还是外键」对修正备份
 * 是决定性信息，所以必须有，且要跨方言识别（SQLite 与 PG 的措辞完全不同）。
 */
export function classifyRestoreError(err: unknown): "duplicate_key" | "foreign_key" | "not_null" | "schema" | "unknown" {
  const message = String((err as Error)?.message ?? err ?? "");
  if (/UNIQUE constraint|duplicate key|PRIMARY KEY|主键/i.test(message)) return "duplicate_key";
  if (/FOREIGN KEY|foreign key|外键/i.test(message)) return "foreign_key";
  if (/NOT NULL|not-null|非空/i.test(message)) return "not_null";
  if (/no such (table|column)|does not exist|不存在/i.test(message)) return "schema";
  return "unknown";
}

export interface RestorePlan {
  /** 需要新建的分类（已按标题去重） */
  plannedCategories: NavHubColdBackup["categories"];
  /** 需要新建的站点及其落库分类 */
  plannedSites: Array<{ site: NavHubColdBackup["sites"][number]; targetCatId: string }>;
  skipped: { duplicateCategories: number; invalidUrls: number; duplicateUrls: number };
}

/**
 * 计算「这个备份包会新增什么」。同步端点与异步端点共用这一份。
 *
 * 判定口径与旧实现逐条等价：分类按标题幂等（备份内同标题只算一次）、站点按
 * URL 归一化去重、非 http(s) 链接跳过、分类 ID 先认现有库再走标题映射再回退默认类目。
 *
 * 抽出来的理由不只是「两个端点复用」：异步化要求**校验与计划在请求内完成**
 * （非法备份不该等到任务跑起来才报错），而计划又必须与实际写入用同一套判定，
 * 否则预演说 100 条、真写 87 条这种偏差会一直存在。
 */
export async function planRestore(
  ctx: AppContext,
  categories: NavHubColdBackup["categories"],
  sites: NavHubColdBackup["sites"],
): Promise<RestorePlan> {
  const existingCats = await ctx.repo.listCategories();
  const existingCatTitles = new Set(existingCats.map((c) => c.title));
  const validCatIds = new Set(existingCats.map((c) => c.id));
  const catTitleToId = new Map(existingCats.map((c) => [c.title, c.id]));

  const plannedCategories: NavHubColdBackup["categories"] = [];
  let duplicateCategories = 0;
  for (const cat of categories) {
    if (existingCatTitles.has(cat.title)) {
      duplicateCategories++;
      continue;
    }
    existingCatTitles.add(cat.title);
    plannedCategories.push(cat);
    validCatIds.add(cat.id);
    catTitleToId.set(cat.title, cat.id);
  }

  const oldIdToNewId = new Map<string, string>();
  for (const cat of categories) {
    const matched = catTitleToId.get(cat.title);
    if (matched) oldIdToNewId.set(cat.id, matched);
  }
  // 空库恢复时旧实现是在建完分类后才取「第一个类目」：这里用计划里的第一条保持等价。
  const defaultCatId = existingCats[0]?.id || plannedCategories[0]?.id || "default";

  const existingSites = await ctx.repo.raw("SELECT url FROM sites WHERE deleted_at IS NULL");
  /**
   * 归一化必须与写入路径同口径（`canonicalizeUrl`）。
   *
   * 原实现是 `replace(/\/+$/, "").toLowerCase()`：它会把**路径**也小写化，
   * 而 `findExistingSiteUrls` 用的是 `canonicalizeUrl`（只小写 hostname、
   * 去默认端口、剥追踪参数）。两套口径的后果是「预演说这条已存在、真写又插进去」
   * 这类错位——现在写入侧也按 URL 过滤，口径不一致会直接表现为重复行。
   */
  const existingUrls = new Set(
    existingSites
      .map((s) => canonicalizeUrl(String(s.url ?? "")))
      .filter((u) => u.length > 0),
  );

  const plannedSites: Array<{ site: NavHubColdBackup["sites"][number]; targetCatId: string }> = [];
  let invalidUrls = 0;
  let duplicateUrls = 0;
  for (const site of sites) {
    if (!site.url || !/^https?:\/\//i.test(site.url)) {
      invalidUrls++;
      continue;
    }
    const norm = canonicalizeUrl(site.url);
    if (!norm) {
      invalidUrls++;
      continue;
    }
    if (existingUrls.has(norm)) {
      duplicateUrls++;
      continue;
    }
    existingUrls.add(norm);
    let targetCatId = defaultCatId;
    if (site.categoryId) {
      if (validCatIds.has(site.categoryId)) {
        targetCatId = site.categoryId;
      } else if (oldIdToNewId.has(site.categoryId)) {
        targetCatId = oldIdToNewId.get(site.categoryId)!;
      }
    }
    plannedSites.push({ site, targetCatId });
  }

  return {
    plannedCategories,
    plannedSites,
    skipped: { duplicateCategories, invalidUrls, duplicateUrls },
  };
}

/**
 * 残留 staging 的保留时长。
 *
 * 失败的恢复**故意不删** staging（运维要能拿它复盘或直接重跑），代价是它会一直躺着：
 * 每份最多约 4MB。原来设计文档写「由 data_retention 清理」，但那个清理从未实现，
 * 等于承诺了一个不存在的机制。这里改成在每次提交异步恢复时顺手扫一遍，
 * 24 小时前的文件删掉——不依赖定时任务，也不引入新的配置项。
 *
 * 为什么不删「刚失败」的文件：用户很可能立刻点「重跑」，那时镜像里的计划还得用。
 */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

/** 清掉过期 staging，返回删除数量；任何一步失败都只跳过，不影响本次恢复 */
export async function sweepStaleStaging(
  dir: string,
  now = Date.now(),
  /** 仍被非终态任务引用的文件，必须保留（否则那份任务重跑时读不到计划） */
  keep: ReadonlySet<string> = new Set(),
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // 目录还不存在（第一次恢复）：没有可清的东西
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    if (keep.has(resolve(path))) continue;
    try {
      const info = await stat(path);
      if (now - info.mtimeMs <= STAGING_TTL_MS) continue;
      await unlink(path);
      removed += 1;
    } catch {
      // 并发请求已经删掉 / 权限问题：跳过，不打断主流程
    }
  }
  return removed;
}

/** 僵尸判定与 `reapStaleJobs` 同口径：超过这么久没有心跳，视为执行者已死 */
const ACTIVE_JOB_STALE_MS = 15 * 60 * 1000;

interface ActiveRestoreJob {
  jobId: string;
  status: string;
  done: number;
  total: number;
  /** 退避中任务的「下次可重试时刻」；其它状态为 null */
  retryAt: number | null;
}

/**
 * 找出仍在进行的恢复任务（供并发守卫与 staging 保护共用）。
 *
 * 为什么不加 `ORDER BY created_at` 取最新：同一时刻只应该有一个，
 * 若历史遗留了多个（旧数据），报出任意一个都能正确拒绝新请求。
 */
async function findActiveRestoreJob(ctx: AppContext): Promise<ActiveRestoreJob | null> {
  const rows = await ctx.repo.raw(
    `SELECT id, status, progress_done, progress_total, updated_at, next_run_at FROM jobs
     WHERE kind = 'backup_restore' AND status IN ('pending', 'running', 'retrying')
     ORDER BY updated_at DESC LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const heartbeat = Number(row.updated_at ?? 0);
  if (Date.now() - heartbeat > ACTIVE_JOB_STALE_MS) return null;
  return {
    jobId: String(row.id),
    status: String(row.status ?? "pending"),
    done: Number(row.progress_done ?? 0),
    total: Number(row.progress_total ?? 0),
    retryAt: row.next_run_at == null ? null : Number(row.next_run_at),
  };
}

/** 收集仍在进行的恢复任务所引用的 staging 绝对路径 */
async function collectActiveStagingPaths(ctx: AppContext): Promise<Set<string>> {
  const rows = await ctx.repo.raw(
    `SELECT payload FROM jobs
     WHERE kind = 'backup_restore' AND status IN ('pending', 'running', 'retrying')`,
  );
  const paths = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(String(row.payload ?? "{}")) as { stagingPath?: unknown };
      if (typeof parsed.stagingPath === "string" && parsed.stagingPath) {
        paths.add(resolve(parsed.stagingPath));
      }
    } catch {
      // payload 坏了就不保护；扫不到路径总比让整次恢复失败好
    }
  }
  return paths;
}

export const backupRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 导出标准 Netscape 书签 HTML (可导入 Chrome, Firefox, Safari, Edge)
   */
  app.get("/api/export/bookmarks.html", { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.listAllSites(EXPORT_MAX_SITES),
    ]);

    const activeSites = sites.filter((s) => s.enabled !== false);
    const html = exportNetscapeBookmarks(categories, activeSites);

    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="navhub-bookmarks.html"');
    return html;
  });

  /**
   * 导出全量冷备数据包 (.nhbak.json)
   *
   * 冷备包含 disabled 站点等未发布数据，且对应恢复接口是 admin；下载也必须
   * 是 admin，避免匿名请求把「未启用/待上线」站点整体导出。书签 HTML 仍是
   * 面向普通用户的 public 导出，但只包含 enabled 站点。
   */
  app.get("/api/export/backup.json", { config: { scope: "admin", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      // 冷备必须全量：少一条就是恢复时真的少一条。admin 作用域 + 限流已经
      // 把访问面收得很小，这里不设上限（宁可在极端大库上慢，也不要静默缺数据）。
      ctx.repo.listAllSites(),
    ]);

    const json = exportNavHubBackup(categories, sites);

    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="navhub-backup-${Date.now()}.nhbak.json"`);
    return json;
  });

  /**
   * 校验并还原冷备灾备数据包。
   *
   * 运行语义对齐 POST /api/sites/bulk：**dryRun 默认 true**，先返回「将新增多少
   * 分类/站点」，确认后再以 dryRun=false 真写。恢复是 admin 触发的全量写事务，
   * 写下去就改整库内容；默认预演让 admin 不必靠猜决定要不要执行。
   * dryRun 可写在 query（`?dryRun=false`，字符串或 JSON 载荷都适用）或对象载荷字段里。
   */
  app.post(
    "/api/backup/restore",
    {
      config: { scope: "admin", rateLimit: { max: 30, timeWindow: "1 minute" } },
      // 备份包天然很大：实测约 187 字节/站，5 万条约 9.27MB，而全局 bodyLimit 是 4MB。
      // 不放宽的话「条目上限 5 万」这条声明永远达不到——请求会先在传输层被 413 掉。
      bodyLimit: RESTORE_BODY_LIMIT_BYTES,
    },
    async (req, reply) => {
    const body = req.body as any;
    const jsonStr = typeof body === "string" ? body : JSON.stringify(body);
    /** 只有显式 false / "false" / 0 才落库；缺省、true、乱填一律按预演处理（安全侧默认）。 */
    const flagFromQuery = (req.query as Record<string, unknown> | undefined)?.dryRun;
    const flagFromBody = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).dryRun
      : undefined;
    const rawFlag = flagFromQuery ?? flagFromBody;
    const dryRun = !(rawFlag === false || rawFlag === "false" || rawFlag === "0" || rawFlag === 0);
    const startedAt = Date.now();
    const validation = validateNavHubBackup(jsonStr);

    if (!validation.valid || !validation.backup) {
      reply.code(400);
      return {
        error: "INVALID_BACKUP",
        message: validation.error || "无效的备份文件",
      };
    }

    const { categories, sites } = validation.backup;
    if (categories.length > RESTORE_MAX_CATEGORIES || sites.length > RESTORE_MAX_SITES) {
      reply.code(413);
      return {
        error: "BACKUP_TOO_LARGE",
        message: `备份条目过多：分类 ${categories.length}/${RESTORE_MAX_CATEGORIES}，站点 ${sites.length}/${RESTORE_MAX_SITES}`,
      };
    }

    let restoredCategories = 0;
    let restoredSites = 0;

    /**
     * 计划计算：dryRun 与真写共用同一份「会不会新增」的判定（见 planRestore），
     * 避免预演与实际不一致。
     */
    const plan = await planRestore(ctx, categories, sites);
    const { plannedCategories, plannedSites } = plan;
    const { duplicateCategories, invalidUrls, duplicateUrls } = plan.skipped;

    /** 预演最多列举 20 条样例：足够 admin 确认「是不是这个包」，又不会把响应撑大。 */
    const PREVIEW_SAMPLE = 20;
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        wouldRestore: {
          categories: plannedCategories.length,
          sites: plannedSites.length,
        },
        skipped: { duplicateCategories, invalidUrls, duplicateUrls },
        sample: {
          categories: plannedCategories.slice(0, PREVIEW_SAMPLE).map((c) => c.title),
          sites: plannedSites.slice(0, PREVIEW_SAMPLE).map(({ site }) => site.url),
        },
        message: `预演：将新增 ${plannedCategories.length} 个分类与 ${plannedSites.length} 个站点（未落库；确认后以 dryRun=false 执行）`,
      };
    }

    /**
     * 全量恢复必须是一个事务：旧实现逐条 createCategory/createSite，第 N 条撞唯一索引
     * 或校验失败时，前 N-1 条已经落库，调用方拿到 500 却留下一半新数据——
     * “重试一次”会把剩余部分补上，看起来像成功，但缺失/重复已经无法自动判定。
     * 现在任一条失败即整体回滚，返回 409 让调用方修好备份后重试。
     */
    try {
      await ctx.repo.withTransaction(async () => {
        // 幂等式恢复分类（计划里已按标题去重）
        for (const cat of plannedCategories) {
          await ctx.repo.createCategory({
            id: cat.id,
            title: cat.title,
            description: cat.description || null,
            sort: cat.sort || 0,
          });
          restoredCategories++;
        }

        /**
         * 站点批量插入：原实现逐条 createSite，单条约 6~12 次往返
         * （getDeletedSite + INSERT + 每标签 upsert + 回读），5 万条上限下
         * 就是 30 万次以上的往返，全部压在同一个写事务里——实际表现是
         * 恢复几千条就超时，而超时又会触发整体回滚，用户看到的是「备份恢复失败」。
         *
         * insertSitesBulk 把往返降到「唯一标签数 + ceil(N/40) + ceil(N/500)」。
         * 事务边界仍在外层：任一批失败都整体回滚，与既有 409 语义一致。
         */
        const inserted = await ctx.repo.insertSitesBulk(
          plannedSites.map(({ site, targetCatId }) => ({
            id: randomUUID(),
            title: site.title,
            url: site.url,
            description: site.description || "",
            categoryId: targetCatId,
            tags: site.tags || [],
            iconKey: site.icon || null,
            /**
             * 停用态必须原样恢复。
             *
             * 原实现只传 7 个字段，insertSitesBulk 的缺省值是 enabled=true / status=active，
             * 于是一份含「停用/待上线」站点的冷备恢复后，它们全部变成公开可见——
             * 备份恢复反而成了把隐藏内容批量上线的通道。冷备里没有 status 字段，
             * 用 enabled=false 映射为 archived，语义与「停用即不对外」一致。
             */
            enabled: site.enabled !== false,
            status: site.enabled === false ? "archived" : "active",
          })),
          // 恢复只需要条数：不回读 5 万条完整 Site 记录
          { hydrate: false },
        );
        restoredSites = inserted.count;
      });
    } catch (err) {
      /**
       * 失败也要留痕。原实现只在日志里打一行，审计表空白——运维事后无法回答
       * 「这次恢复失败发生在什么时候、备份有多大、是重复键还是外键」。
       *
       * 对外只回**错误类别**不回原始 message：PG/SQLite 的报错里可能带着
       * 具体值与约束名（例如重复的 URL），那属于用户数据，不该出现在响应里。
       */
      const reason = classifyRestoreError(err);
      req.log.error({ err, reason }, "备份恢复失败，事务已回滚");
      try {
        await ctx.repo.audit({
          ip: req.ip,
          actor: req.auth.actor,
          actorKind: req.auth.kind,
          action: "backup.restore_failed",
          target: "backup",
          diff: {
            reason,
            durationMs: Date.now() - startedAt,
            plannedCategories: plannedCategories.length,
            plannedSites: plannedSites.length,
          },
        });
      } catch {
        // 审计尽力而为：审计本身失败不能盖住「恢复失败」这个主信息
      }
      reply.code(409);
      return {
        error: "RESTORE_FAILED",
        reason,
        message: "备份恢复失败，已整体回滚；请修正备份内容后重试",
      };
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "backup.restore",
      target: "backup",
      diff: {
        categories: restoredCategories,
        sites: restoredSites,
        // 耗时与跳过项：判断「恢复变慢了」还是「备份里本来就有重复」的依据
        durationMs: Date.now() - startedAt,
        skipped: { duplicateCategories, invalidUrls, duplicateUrls },
      },
    });

    /**
     * 恢复完成后补建检索索引。
     *
     * 恢复只写 sites / site_tags 行，**不建向量**（原来也没有建）——于是恢复出来的
     * 站点能靠 exact/fts/pinyin 命中，语义通道却要等下一个定时 reindex（cron 每 4 小时）
     * 才可用。5 万条全量重建不能塞进恢复请求（会超时），所以入队让 JobRunner 异步做。
     *
     * 入队失败不影响恢复结果：数据已经落库，定时任务仍会在下一轮补上。
     */
    if (restoredSites > 0) {
      try {
        await ctx.repo.enqueueJob("reindex", { vectors: true });
      } catch (err) {
        req.log.warn({ err }, "恢复后入队索引重建失败（数据已恢复，等待定时 reindex 补齐）");
      }
    }

    return {
      ok: true,
      message: `成功恢复 ${restoredCategories} 个分类与 ${restoredSites} 个站点`,
      restored: {
        categories: restoredCategories,
        sites: restoredSites,
      },
      /**
       * 实测耗时随条目线性增长（1 万条约 7.4 秒，SQLite 本地）。
       * 5 万条上限按此外推约 37 秒，**超过 BFF 代理的 30 秒读超时**——
       * 调用方会看到 504，但数据其实已经落库。把耗时回传出去，
       * 让「这次恢复为什么超时」变成可解释的事实，而不是靠猜。
       */
      durationMs: Date.now() - startedAt,
      /** 异步补索引任务的入口提示：语义检索在 reindex 跑完后才完整 */
      reindexQueued: restoredSites > 0,
    };
    },
  );

  /**
   * 异步恢复：提交任务，立刻返回 202。
   *
   * 存在的理由是「请求时长与数据量解耦」：同步端点在 5 万条上限下要 37 秒以上，
   * 超过 BFF 的读超时，调用方会看到 504 而事务其实已经提交——那是最糟的一种失败
   * （用户以为失败、数据已变）。异步化之后请求本身只做校验与落盘，耗时与条目数无关。
   *
   * 请求内**必须**完成的四件事（不能推给任务）：
   *   1. 备份包结构校验——非法包要立刻 400，而不是让用户等任务跑起来才看到错；
   *   2. 条目上限检查——同同步端点；
   *   3. 计划计算（planRestore）——异步任务要按同一套判定写库，否则预演与真写会分叉；
   *   4. staging 落盘——任务只读文件，不碰原始上传体。
   */
  app.post(
    "/api/backup/restore/async",
    {
      config: { scope: "admin", rateLimit: { max: 10, timeWindow: "1 minute" } },
      bodyLimit: RESTORE_BODY_LIMIT_BYTES,
    },
    async (req, reply) => {
      const body = req.body as any;
      const jsonStr = typeof body === "string" ? body : JSON.stringify(body);
      const validation = validateNavHubBackup(jsonStr);
      if (!validation.valid || !validation.backup) {
        reply.code(400);
        return { error: "INVALID_BACKUP", message: validation.error || "无效的备份文件" };
      }

      const { categories, sites } = validation.backup;
      if (categories.length > RESTORE_MAX_CATEGORIES || sites.length > RESTORE_MAX_SITES) {
        reply.code(413);
        return {
          error: "BACKUP_TOO_LARGE",
          message: `备份条目过多：分类 ${categories.length}/${RESTORE_MAX_CATEGORIES}，站点 ${sites.length}/${RESTORE_MAX_SITES}`,
        };
      }

      const plan = await planRestore(ctx, categories, sites);

      /**
       * 一条都不会写时，不该建任务。
       *
       * 依据 HTTP 语义（RFC 9110 §15.3.3 与通行实践）：工作已经完成或无事可做时
       * 应当返回 200/201，而不是 202 + 一个永远停在 `total=0` 的任务。
       * 之前的表现是：提交一份全部已存在的备份 → 创建任务 → 前端进度条卡在
       * 「正在准备恢复计划…」→ 最后报「成功恢复 0 个站点」，用户不知道发生了什么。
       */
      if (plan.plannedCategories.length === 0 && plan.plannedSites.length === 0) {
        return {
          ok: true,
          nothingToDo: true,
          skipped: plan.skipped,
          message: `无需恢复：${plan.skipped.duplicateCategories} 个分类与 ${plan.skipped.duplicateUrls} 条已存在的站点全部命中跳过`,
        };
      }

      /**
       * 并发守卫：同一时刻只允许一个恢复任务。
       *
       * 前端虽然禁用了按钮，但那只是界面约束——绕过页面直接 curl 两次，
       * 两组分片会交错写入同一个库，谁赢谁输说不清，而且都建立在同一份
       * 「哪些 URL 已存在」的快照上。
       *
       * 只把 15 分钟内有心跳的任务当作活跃：与 `reapStaleJobs` 同口径。
       * 否则一个进程被杀的僵尸任务会把恢复入口锁死 15 分钟以上。
       */
      const active = await findActiveRestoreJob(ctx);
      if (active) {
        const retryIn =
          active.retryAt && active.retryAt > Date.now()
            ? Math.max(1, Math.round((active.retryAt - Date.now()) / 1000))
            : null;
        reply.code(409);
        return {
          error: "CONFLICT_RESTORE_RUNNING",
          jobId: active.jobId,
          statusUrl: `/api/backup/restore/status/${active.jobId}`,
          retryAt: active.retryAt,
          message:
            `已有恢复任务在进行（${active.status}，${active.done}/${active.total} 条）` +
            (retryIn ? `，约 ${retryIn} 秒后会自动重试` : '') +
            '。完成或失败后再提交，避免两组分片交错写入',
        };
      }

      /**
       * staging 文件：只放**已解析**的计划（categoryId 已换成真实 id），
       * 任务侧因此不需要再碰分类映射逻辑，也就能拒绝「categoryId 为空」的脏数据。
       */
      const stagingDir = resolve(process.env.NAVHUB_RESTORE_STAGING_DIR || "data/restore-staging");
      // 顺手清理过期残留：非终态任务还引用着的文件必须留住，否则那份任务重跑时
      // 读不到 staging，会以「可重试」的状态永久失败。
      const keep = await collectActiveStagingPaths(ctx);
      await sweepStaleStaging(stagingDir, Date.now(), keep).catch(() => 0);
      const stagingPath = join(stagingDir, `${randomUUID()}.json`);
      try {
        await mkdir(stagingDir, { recursive: true });
        await writeFile(
          stagingPath,
          JSON.stringify({
            categories: plan.plannedCategories,
            sites: plan.plannedSites.map(({ site, targetCatId }) => ({ ...site, categoryId: targetCatId })),
          }),
          "utf8",
        );
      } catch (err) {
        req.log.error({ err }, "写入恢复 staging 失败");
        reply.code(500);
        return { error: "STAGING_WRITE_FAILED", message: "无法暂存恢复计划（磁盘或权限问题），未创建任务" };
      }

      let jobId: string;
      try {
        jobId = await ctx.repo.enqueueJob("backup_restore", { stagingPath });
      } catch (err) {
        req.log.error({ err }, "入队恢复任务失败");
        reply.code(500);
        return { error: "ENQUEUE_FAILED", message: "恢复任务入队失败，未执行任何写入" };
      }

      void ctx.repo
        .audit({
          ip: req.ip,
          actor: req.auth.actor,
          actorKind: req.auth.kind,
          action: "backup.restore_queued",
          target: "backup",
          diff: {
            jobId,
            plannedCategories: plan.plannedCategories.length,
            plannedSites: plan.plannedSites.length,
            skipped: plan.skipped,
          },
        })
        .catch(() => undefined);

      const statusUrl = `/api/backup/restore/status/${jobId}`;
      /**
       * `Location` 与 `Retry-After` 不是 RFC 对 202 的强制要求（RFC 9110 §15.3.3
       * 只要求「指向一个状态监视地址」），但已是通行的异步模式实践：
       * 前者让 curl / Agent 这类调用方不必解析 body 就能跟进，后者让服务端
       * 能指挥轮询节奏，而不是让每个客户端都写死一个间隔。
       */
      reply.code(202);
      reply.header("Location", statusUrl);
      reply.header("Retry-After", "2");
      return {
        ok: true,
        jobId,
        accepted: { categories: plan.plannedCategories.length, sites: plan.plannedSites.length },
        skipped: plan.skipped,
        statusUrl,
        retryAfterMs: 2000,
        message: `已入队：将恢复 ${plan.plannedCategories.length} 个分类与 ${plan.plannedSites.length} 个站点（进度见 statusUrl）`,
      };
    },
  );

  /**
   * 查询异步恢复进度。
   *
   * 只认 `backup_restore` 类型的任务：其它任务的 id 一律 404，避免这个端点变成
   * 「任意任务状态查询器」（任务 payload 里可能有内部路径）。
   *
   * 状态枚举以 JobRecord.status 为准（`done`，不是 `completed`）。进程被杀时任务会
   * 在 `running` 停留最多 15 分钟才被 reapStaleJobs 回收——这里如实报 running，
   * 不做「超过 N 分钟就推断失败」的猜测。
   */
  app.get(
    "/api/backup/restore/status/:jobId",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      const rows = await ctx.repo.raw(
        "SELECT id, kind, status, error, progress_done, progress_total, created_at, updated_at, duration_ms FROM jobs WHERE id = ? LIMIT 1",
        [jobId],
      );
      const row = rows[0];
      if (!row || String(row.kind) !== "backup_restore") {
        reply.code(404);
        return { error: "NOT_FOUND", message: "任务不存在（或不是恢复任务）" };
      }
      const status = String(row.status ?? "pending");
      const finished = status === "done" || status === "failed" || status === "cancelled";
      /**
       * 未终态时给 `Retry-After`：让轮询节奏由服务端指挥，而不是每个客户端
       * 自己写死一个间隔。同时放进 body（`retryAfterMs`）——浏览器端读响应头
       * 需要绕一层，body 字段让前端不必为此改 API 客户端。
       */
      if (!finished) reply.header("Retry-After", "2");
      return {
        jobId: String(row.id),
        status,
        progress: { done: Number(row.progress_done ?? 0), total: Number(row.progress_total ?? 0) },
        startedAt: Number(row.created_at ?? 0),
        finishedAt: finished ? Number(row.updated_at ?? 0) : null,
        /**
         * 本次执行耗时（毫秒，不含排队等待）。`finishedAt - startedAt` 含排队，
         * 任务在队列里等过就看不准；这一列才是「跑了多久」。
         */
        durationMs: Number(row.duration_ms ?? 0),
        retryAfterMs: finished ? null : 2000,
        error: row.error == null ? null : String(row.error),
        /** 完成后 staging 保留与否取决于成功/失败：成功已删，失败保留供重跑 */
        retryable: status === "failed" || status === "retrying" || status === "cancelled",
      };
    },
  );
};
