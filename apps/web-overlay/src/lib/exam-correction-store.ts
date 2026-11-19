/**
 * 报错草稿的后端落点适配器（01-verification-workflow §8 / §9.3）。
 *
 * 目标：调用 W1 的 `packages/store/src/exam-verification-store.ts` 的
 * `insertExamCorrection(db, input)`（签名经 W1 提交 b5357781 核对：第一个参数为
 * `Db`，由 `packages/store/src/driver.ts` 的 `openDb()` 取得；第二个参数为
 * `InsertExamCorrectionInput`）。
 *
 * 现状（2026-11-20）：W1 分支已合流进本 worktree（fast-forward 到 b5357781），
 * store 文件已存在；但 web-overlay 从未直连 `@navhub/store`（tsconfig 只有
 * `@/*` 映射，apps/web/node_modules 里无 `@navhub` 链接），故不用静态 import，
 * 改用运行期动态 import（字符串变量，避免 tsc 静态解析），从运行期 cwd 向上找到
 * 的仓库根下取 `packages/store/src/exam-verification-store.ts`（insert 函数）
 * 与 `packages/store/src/driver.ts`（openDb）的绝对路径（Node 24 原生
 * strip-types 可直接加载 .ts，此前加载 `packages/store/src/index.ts` 已实测通过；
 * store 的 drizzle / better-sqlite3 依赖走 `packages/store/node_modules` 解析）。
 *
 * 字段映射（W1 的 exam_corrections 表无 sourceUrl / contact 列）：
 *  - draft.sourceUrl / draft.contact 以「来源链接：」「联系方式：」行并入 reason，
 *    不丢信息；correctedText 留空（草稿）、correctionPublishedAt 为 null；
 *  - originalPublishedAt 按 §2.6 为 notNull：节点数据无逐条发布时间，草稿态由
 *    server action 以举报时间填充占位（见字段注释），核查确认时补正。
 * 库路径与 apps/api/src/config.ts 同款：
 * `NAVHUB_SQLITE_PATH` → `NAVHUB_DB_PATH` → `./data/navhub.db`。
 * 每次提交 open + close 各一次，不跨请求持有 better-sqlite3 句柄。
 * 模块不存在或打开/写入失败时返回 `{ok:false}`（调用方把草稿暂存本机，
 * 不丢报告、不谎称已提交）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ExamCorrectionDraftInput } from './exam-verification'

export type InsertExamCorrectionDraftResult =
  | { ok: true; id: number }
  | {
      ok: false
      reason: 'store_not_merged' | 'store_error'
      message: string
    }

/** W1 签名的结构化子集（不静态 import store 模块，避免 tsc 跨包解析）。 */
interface StoreDb {
  close(): Promise<void> | void
}

type OpenDbFn = (config: {
  dialect: 'sqlite'
  sqlitePath?: string
}) => Promise<StoreDb>

type InsertExamCorrectionFn = (
  db: StoreDb,
  input: {
    examId: string
    nodeLabel: string
    assertionHash: string
    originalText: string
    correctedText?: string | null
    errorType: string
    reason: string
    howDiscovered: 'reader_tip'
    originalPublishedAt: number
    correctionPublishedAt?: number | null
    location?: 'both'
    correctedBy: string
  },
) => Promise<{ id: number }>

function findStoreFilePath(file: string): string | undefined {
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'packages', 'store', 'src', file)
    if (existsSync(candidate)) return candidate
    const parent = join(dir, '..')
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

async function loadStoreFns(): Promise<
  { insertExamCorrection: InsertExamCorrectionFn; openDb: OpenDbFn } | undefined
> {
  const storePath = findStoreFilePath('exam-verification-store.ts')
  const driverPath = findStoreFilePath('driver.ts')
  if (storePath === undefined || driverPath === undefined) return undefined
  try {
    // 字符串变量 specifier：tsc 不做静态模块解析；webpackIgnore 让打包器保留
    // 运行期 import，不把 store 模块打进 web bundle。
    const storeMod = (await import(/* webpackIgnore: true */ storePath)) as unknown as {
      insertExamCorrection?: unknown
    }
    const driverMod = (await import(/* webpackIgnore: true */ driverPath)) as unknown as {
      openDb?: unknown
    }
    if (
      typeof storeMod.insertExamCorrection !== 'function' ||
      typeof driverMod.openDb !== 'function'
    ) {
      return undefined
    }
    return {
      insertExamCorrection: storeMod.insertExamCorrection as InsertExamCorrectionFn,
      openDb: driverMod.openDb as OpenDbFn,
    }
  } catch {
    return undefined
  }
}

function sqlitePath(): string {
  return (
    process.env.NAVHUB_SQLITE_PATH ?? process.env.NAVHUB_DB_PATH ?? './data/navhub.db'
  )
}

/** 写一条 reader_tip 草稿行（§9.3）。store 未合流时返回 store_not_merged，不抛错。 */
export async function insertExamCorrectionDraft(
  draft: ExamCorrectionDraftInput,
): Promise<InsertExamCorrectionDraftResult> {
  const fns = await loadStoreFns()
  if (fns === undefined) {
    return {
      ok: false,
      reason: 'store_not_merged',
      message:
        '核验数据库尚未合流（W1 分支 batch0/w1-exam-tables 未提交），报错未写入数据库，已暂存到本机草稿。',
    }
  }
  let db: StoreDb | undefined
  try {
    db = await fns.openDb({ dialect: 'sqlite', sqlitePath: sqlitePath() })
    const reasonLines = [draft.reason]
    if (draft.sourceUrl !== undefined && draft.sourceUrl !== '') {
      reasonLines.push(`来源链接：${draft.sourceUrl}`)
    }
    if (draft.contact !== undefined && draft.contact !== '') {
      reasonLines.push(`联系方式：${draft.contact}`)
    }
    const row = await fns.insertExamCorrection(db, {
      examId: draft.examId,
      nodeLabel: draft.nodeLabel,
      assertionHash: draft.assertionHash,
      originalText: draft.originalText,
      correctedText: null,
      errorType: draft.errorType,
      reason: reasonLines.join('\n'),
      howDiscovered: 'reader_tip',
      originalPublishedAt: draft.originalPublishedAt,
      correctionPublishedAt: null,
      location: 'both',
      correctedBy: 'reader_tip',
    })
    return { ok: true, id: row.id }
  } catch (error) {
    return {
      ok: false,
      reason: 'store_error',
      message: `写入核验数据库失败：${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    if (db !== undefined) {
      try {
        await db.close()
      } catch {
        // 关闭失败不影响已返回的写入结果。
      }
    }
  }
}
