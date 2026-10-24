import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppContext } from "../context.ts";
import {
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
  const existingUrls = new Set(
    existingSites.map((s) => String(s.url ?? "").replace(/\/+$/, "").toLowerCase()),
  );

  const plannedSites: Array<{ site: NavHubColdBackup["sites"][number]; targetCatId: string }> = [];
  let invalidUrls = 0;
  let duplicateUrls = 0;
  for (const site of sites) {
    if (!site.url || !/^https?:\/\//i.test(site.url)) {
      invalidUrls++;
      continue;
    }
    const norm = site.url.replace(/\/+$/, "").toLowerCase();
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
export async function sweepStaleStaging(dir: string, now = Date.now()): Promise<number> {
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
    { config: { scope: "admin", rateLimit: { max: 30, timeWindow: "1 minute" } } },
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
    { config: { scope: "admin", rateLimit: { max: 10, timeWindow: "1 minute" } } },
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
       * staging 文件：只放**已解析**的计划（categoryId 已换成真实 id），
       * 任务侧因此不需要再碰分类映射逻辑，也就能拒绝「categoryId 为空」的脏数据。
       */
      const stagingDir = resolve(process.env.NAVHUB_RESTORE_STAGING_DIR || "data/restore-staging");
      // 顺手清理过期残留（失败重跑用的文件）；不 await 进主路径，也不让它影响结果
      await sweepStaleStaging(stagingDir).catch(() => 0);
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

      reply.code(202);
      return {
        ok: true,
        jobId,
        accepted: { categories: plan.plannedCategories.length, sites: plan.plannedSites.length },
        skipped: plan.skipped,
        statusUrl: `/api/backup/restore/status/${jobId}`,
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
        "SELECT id, kind, status, error, progress_done, progress_total, created_at, updated_at FROM jobs WHERE id = ? LIMIT 1",
        [jobId],
      );
      const row = rows[0];
      if (!row || String(row.kind) !== "backup_restore") {
        reply.code(404);
        return { error: "NOT_FOUND", message: "任务不存在（或不是恢复任务）" };
      }
      const status = String(row.status ?? "pending");
      const finished = status === "done" || status === "failed" || status === "cancelled";
      return {
        jobId: String(row.id),
        status,
        progress: { done: Number(row.progress_done ?? 0), total: Number(row.progress_total ?? 0) },
        startedAt: Number(row.created_at ?? 0),
        finishedAt: finished ? Number(row.updated_at ?? 0) : null,
        error: row.error == null ? null : String(row.error),
        /** 完成后 staging 保留与否取决于成功/失败：成功已删，失败保留供重跑 */
        retryable: status === "failed" || status === "retrying",
      };
    },
  );
};
