/**
 * 启动时视频目录对账（影子表自愈）。
 *
 * 为什么存在：`writeVideosData` 每次写都会 `syncVideoCatalogSafely`（best-effort，
 * 从不抛错），加上恢复备份这类场景，影子表（video_categories / video_items）会
 * 静默落后于 KV 事实源——实测恢复镜像后漂移 7 条。两份事实源一旦漂移：
 *   - 「读路径切到关系表」的一致性门禁永远过不去；
 *   - `db` 模式下读到的就是缺行/多行的幻影数据。
 * 这里在服务启动后跑一次一致性检查；漂移且模式为 json/dual 时用全量替换修表
 * （JSON 是事实源，`syncVideoCatalog` 方向 KV → 表）。**db 模式只记录不修**：
 * 那时读路径已经在表上，拿 KV 反向覆盖表等于拿旧影子毁掉正在服务的数据。
 *
 * 多副本：各副本启动时都会跑一次；`syncVideoCatalog` 是事务性全量替换，两份
 * 相同内容的并发替换收敛到同一结果，无需跨实例互斥（与常驻 job 不同）。
 */
import { readKv } from "./storage.ts";
import {
  checkVideoCatalogConsistency,
  resolveVideoStoreMode,
  syncVideoCatalog,
  type VideoCatalogCheckResult,
  type VideoStoreMode,
} from "./video-catalog.ts";
import type { AppContext } from "./context.ts";

export interface BootReconcileOutcome {
  /** false = 关闭（环境变量）或模式为 db（只允许记录） */
  attempted: boolean
  mode: VideoStoreMode
  /** 检查结果；attempted=false 时为 null */
  check: VideoCatalogCheckResult | null
  action: "skipped_disabled" | "skipped_db_mode" | "clean" | "repaired" | "log_only" | "failed"
  error?: string
}

/** 对账决策（纯函数）：按模式与检查结果决定修表 / 只记录 / 跳过 */
export function decideBootRepair(
  mode: VideoStoreMode,
  result: VideoCatalogCheckResult,
): "clean" | "repair" | "log_only" {
  if (result.ok) return "clean"
  if (mode === "db") return "log_only"
  return "repair"
}

/** 供 main.ts 装配的编排主体；依赖全部注入，离线可测 */
export async function runBootReconcile(
  deps: {
    mode: () => VideoStoreMode
    loadDoc: () => Promise<unknown>
    check: (data: unknown) => Promise<VideoCatalogCheckResult>
    repair: (data: unknown) => Promise<unknown>
  },
  log: (line: string) => void,
): Promise<BootReconcileOutcome> {
  const mode = deps.mode()
  if (mode === "db") {
    log("[video-catalog-boot] 模式为 db（读路径在关系表上）：跳过启动对账，防反向覆盖")
    return { attempted: false, mode, check: null, action: "skipped_db_mode" }
  }

  // 必须读原始 KV 而不是 readVideosData：后者在 db 模式下由表重建，json/dual
  // 模式虽返回 KV，但固定走 readKv 保证比的是两个真正独立的事实源（与 CLI 同口径）。
  const doc = await deps.loadDoc()
  if (!doc || typeof doc !== "object") {
    log("[video-catalog-boot] KV 中没有视频库数据（从未保存过）：跳过启动对账")
    return { attempted: false, mode, check: null, action: "skipped_db_mode" }
  }

  const check = await deps.check(doc)
  const decision = decideBootRepair(mode, check)

  if (decision === "clean") {
    log(`[video-catalog-boot] 目录一致（${check.docItems} 条目，json/dual 影子表同步健康）`)
    return { attempted: true, mode, check, action: "clean" }
  }

  if (decision === "log_only") {
    log(
      `[video-catalog-boot] 影子表漂移但模式为 db，仅记录不修：` +
        `doc=${check.docItems} db=${check.dbItems} missingInDb=${check.missingInDb.length} ` +
        `extraInDb=${check.extraInDb.length} mismatched=${check.mismatched.length}`,
    )
    return { attempted: true, mode, check, action: "log_only" }
  }

  log(
    `[video-catalog-boot] 检测到影子表漂移（doc=${check.docItems} db=${check.dbItems} ` +
      `missing=${check.missingInDb.length} extra=${check.extraInDb.length} mismatched=${check.mismatched.length}），执行全量替换修表`,
  )
  await deps.repair(doc)
  const after = await deps.check(doc)
  if (!after.ok) {
    log(`[video-catalog-boot] 修表后复检仍不一致（doc=${after.docItems} db=${after.dbItems}），请人工排查`)
    return { attempted: true, mode, check: after, action: "failed" }
  }
  log(`[video-catalog-boot] 修表完成，复检一致（${after.docItems} 条目）`)
  return { attempted: true, mode, check: after, action: "repaired" }
}

/**
 * main.ts 启动接线：用真实 ctx 构造依赖并执行。失败只记日志，绝不阻断启动。
 */
export async function reconcileVideoCatalogOnBoot(
  ctx: AppContext,
  log: (line: string) => void,
): Promise<BootReconcileOutcome> {
  try {
    return await runBootReconcile(
      {
        mode: () => resolveVideoStoreMode(),
        // 键名与 video-catalog-main.ts 对账 CLI 同口径（"videos" = kv:videos 原始载荷）
        loadDoc: () => readKv(ctx, "videos"),
        check: (data) => checkVideoCatalogConsistency(ctx, data),
        repair: (data) => syncVideoCatalog(ctx, data),
      },
      log,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`[video-catalog-boot] 启动对账失败（不影响启动）: ${message}`)
    return {
      attempted: true,
      mode: resolveVideoStoreMode(),
      check: null,
      action: "failed",
      error: message,
    }
  }
}
