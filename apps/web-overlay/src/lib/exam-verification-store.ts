/**
 * /exam 服务端取数适配器（01-verification-workflow §8 / §10 A8 R1）。
 *
 * 目标：/exam 页面在服务端取全部节点的最新核查行与更正行，序列化后传给
 * ExamCountdown 客户端岛（准入闸下架判定 + 更正注渲染用）。浏览器绝不直连库。
 *
 * 模式照抄 exam-correction-store.ts：不用静态 import @navhub/store，运行期
 * 动态 import（字符串变量，避免 tsc 静态解析），从运行期 cwd 向上找到的仓库根
 * 下取 `packages/store/src/exam-verification-store.ts`（latestVerificationForNode /
 * listCorrectionsForNode）与 `packages/store/src/driver.ts`（openDb）的绝对路径
 * （Node 24 原生 strip-types 可直接加载 .ts；store 的 better-sqlite3 依赖走
 * `packages/store/node_modules` 解析）。库路径与 apps/api/src/config.ts 同款：
 * `NAVHUB_SQLITE_PATH` → `NAVHUB_DB_PATH` → `./data/navhub.db`。
 * 每次取数 open + close 各一次，不跨请求持有 better-sqlite3 句柄。
 *
 * 失败策略：库文件不存在、store 未合流、打开/读取失败时一律返回空表
 * （`{ ok: false }`），页面按“无核查行”渲染（准入闸只按节点 5 字段判定），
 * 不抛错、不谎称已下架、不阻塞 /exam 渲染。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EXAMS } from './exam-calendar'
import type { ExamCorrectionNote, LatestExamVerificationRef } from './exam-verification'

export interface ExamVerificationLookup {
  ok: boolean
  /** key `${examId}:${nodeLabel}` → 该节点最新核查行的 verdict（只取 verdict，R1 闸只读它）。 */
  latestByKey: Readonly<Record<string, LatestExamVerificationRef>>
  /** key `${examId}:${nodeLabel}` → 该节点更正行（按 correction_published_at 倒序）。 */
  correctionsByKey: Readonly<Record<string, readonly ExamCorrectionNote[]>>
}

/** W1 签名的结构化子集（不静态 import store 模块，避免 tsc 跨包解析）。 */
interface StoreDb {
  close(): Promise<void> | void
}

type OpenDbFn = (config: {
  dialect: 'sqlite'
  sqlitePath?: string
}) => Promise<StoreDb>

interface StoreVerificationRow {
  verdict: string
}

interface StoreCorrectionRow {
  originalText: string
  correctedText: string | null
  correctionPublishedAt: number | null
  reason: string
}

type LatestVerificationForNodeFn = (
  db: StoreDb,
  examId: string,
  nodeLabel: string,
) => Promise<StoreVerificationRow | null>

type ListCorrectionsForNodeFn = (
  db: StoreDb,
  examId: string,
  nodeLabel: string,
) => Promise<StoreCorrectionRow[]>

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
  | {
      latestVerificationForNode: LatestVerificationForNodeFn
      listCorrectionsForNode: ListCorrectionsForNodeFn
      openDb: OpenDbFn
    }
  | undefined
> {
  const storePath = findStoreFilePath('exam-verification-store.ts')
  const driverPath = findStoreFilePath('driver.ts')
  if (storePath === undefined || driverPath === undefined) return undefined
  try {
    // 字符串变量 specifier：tsc 不做静态模块解析；webpackIgnore 让打包器保留
    // 运行期 import，不把 store 模块打进 web bundle。
    const storeMod = (await import(/* webpackIgnore: true */ storePath)) as unknown as {
      latestVerificationForNode?: unknown
      listCorrectionsForNode?: unknown
    }
    const driverMod = (await import(/* webpackIgnore: true */ driverPath)) as unknown as {
      openDb?: unknown
    }
    if (
      typeof storeMod.latestVerificationForNode !== 'function' ||
      typeof storeMod.listCorrectionsForNode !== 'function' ||
      typeof driverMod.openDb !== 'function'
    ) {
      return undefined
    }
    return {
      latestVerificationForNode: storeMod.latestVerificationForNode as LatestVerificationForNodeFn,
      listCorrectionsForNode: storeMod.listCorrectionsForNode as ListCorrectionsForNodeFn,
      openDb: driverMod.openDb as OpenDbFn,
    }
  } catch {
    return undefined
  }
}

function sqlitePath(): string {
  return process.env.NAVHUB_SQLITE_PATH ?? process.env.NAVHUB_DB_PATH ?? './data/navhub.db'
}

const EMPTY: ExamVerificationLookup = { ok: false, latestByKey: {}, correctionsByKey: {} }

/**
 * 取全部 43 节点的最新核查行（verdict）与更正行。库文件不存在时不打开
 * （openDb 会建空库文件），直接返回空表。
 */
export async function loadExamVerificationLookup(): Promise<ExamVerificationLookup> {
  const path = sqlitePath()
  // ':memory:' 只用于单测直调 store，不走本适配器；相对路径按 cwd 解析。
  if (path !== ':memory:' && !existsSync(path)) return EMPTY
  const fns = await loadStoreFns()
  if (fns === undefined) return EMPTY
  let db: StoreDb | undefined
  try {
    db = await fns.openDb({ dialect: 'sqlite', sqlitePath: path })
    const latestByKey: Record<string, LatestExamVerificationRef> = {}
    const correctionsByKey: Record<string, readonly ExamCorrectionNote[]> = {}
    for (const exam of EXAMS) {
      for (const node of exam.nodes) {
        const key = `${exam.id}:${node.label}`
        const latest = await fns.latestVerificationForNode(db, exam.id, node.label)
        if (latest !== null) latestByKey[key] = { verdict: latest.verdict }
        const corrections = await fns.listCorrectionsForNode(db, exam.id, node.label)
        if (corrections.length > 0) {
          correctionsByKey[key] = corrections.map((c) => ({
            originalText: c.originalText,
            correctedText: c.correctedText,
            correctionPublishedAt: c.correctionPublishedAt,
            reason: c.reason,
          }))
        }
      }
    }
    return { ok: true, latestByKey, correctionsByKey }
  } catch {
    return EMPTY
  } finally {
    if (db !== undefined) {
      try {
        await db.close()
      } catch {
        // 关闭失败不影响已返回的取数结果。
      }
    }
  }
}
