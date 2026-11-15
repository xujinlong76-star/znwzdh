/**
 * 导入去重报告（第 2 批 · 第 11 项）：纯函数层，无 React / 无 DOM，可 node 单测。
 *
 * 唯一比对键是 `fingerprintUrl`（import-workbench.ts 的 SSOT）：
 * 解析层批内去重、`importJson` 合并键、本地收藏比对都用它，
 * 本文件只 import 它，绝不自己再写一份归一化。
 *
 * 不变式：sum(counts) === totalParsed；每条导入条目有且仅有一个 verdict。
 * 标题冲突 / 文件夹冲突不算重复（只看 URL 指纹），只影响“导入后显示什么”。
 */

import { fingerprintUrl, inspectPrivacy } from './import-workbench'
import type { ParsedUniversalItem } from './favorites-export-import'

/** 文件 / 条数上限（总协调人决策 1）：超限硬拦 */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024
/** 单次导入条数上限，与 parseUniversalBookmarks 默认 limit 对齐 */
export const IMPORT_MAX_ITEMS = 5000
/** 预览分页大小（总协调人决策 2） */
export const IMPORT_PREVIEW_PAGE_SIZE = 50
/** 个人收藏写入 chunk 大小（总协调人决策 3） */
export const IMPORT_PRIVATE_CHUNK_SIZE = 100
/** 粘贴文本字符上限：与 10 MB 文件上限同规则 */
export const IMPORT_MAX_PASTE_CHARS = 10 * 1024 * 1024
/** sessionStorage 快照键：只存指纹/标题/URL 级快照，不存文件原文 */
export const IMPORT_WIZARD_RESUME_KEY = 'navhub.import-wizard.resume.v1'

export type DedupVerdict =
  | 'new'
  | 'exists-local'
  | 'exists-public'
  | 'intra-file-dup'
  | 'title-conflict'
  | 'folder-conflict'
  | 'private-blocked'
  | 'invalid'

export type DedupOverride = 'keep-existing' | 'use-imported' | 'move-folder' | null

export interface LocalExistingRef {
  siteId: string
  title: string
  folder?: string
}

export interface DedupVerdictItem {
  /** 报告内唯一 id：`dedup-<解析序号>`，与 StagingItem.id 无关 */
  id: string
  /** 解析序号（输入数组下标），供执行阶段找回原文 */
  sourceIndex: number
  verdict: DedupVerdict
  fingerprint: string
  title: string
  url: string
  folder?: string
  description?: string
  tags: string[]
  existingTitle?: string
  existingFolder?: string
  existingId?: string
  /** intra-file-dup 时指向批内保留的那条 id */
  keptById?: string
  reason: string
  /** 是否进个人收藏（新增，或改判更新已存条目） */
  selectedPrivate: boolean
  /** 是否投稿公共库 */
  selectedPublic: boolean
  /** 建报告时按模式/ verdict 给的默认选中（改判前的值）。intra-file-dup
   *  改判回“保留第一条”时，保留条按这份默认恢复，而不是凭空猜一个 */
  defaultSelectedPrivate: boolean
  /** 同上，公共投稿侧的默认选中 */
  defaultSelectedPublic: boolean
  override?: DedupOverride
  /** 隐私 / 已收录时恒为 true，公共投稿在任何步骤都不可勾选 */
  publicLocked: boolean
}

export interface DedupReport {
  /** 解析出条数（= items.length + intra-file-dup + invalid 全部计入） */
  totalParsed: number
  counts: Record<DedupVerdict, number>
  groups: Record<DedupVerdict, DedupVerdictItem[]>
  /** 公共库索引不可用时 true：exists-public 计数不可信，UI 必须明说 */
  dedupeUnavailable: boolean
  truncated: boolean
  /** 解析器返回的真实命中总数（超限时用）；拿不到时为 undefined，不许编数字 */
  totalMatched?: number
  /** 批内重复被丢掉的条数（= counts['intra-file-dup']，与旧 StagingResult 口径一致） */
  skippedDuplicates: number
}

export interface ExecutionPlan {
  /** 冻结的个人收藏写入清单（按报告顺序） */
  privateItems: DedupVerdictItem[]
  /** 冻结的公共库投稿清单 */
  publicItems: DedupVerdictItem[]
  /** 文件夹冲突改判产生的移夹：把已存条目移到导入文件夹 */
  folderMoves: Array<{ id: string; existingId: string; folder: string }>
  /** 标题冲突改判：采用导入标题更新已存条目 */
  titleOverrides: Array<{ id: string; existingId: string; title: string }>
  /** 改判为导入（更新已存条目）的条目，不重复插入 */
  updatedItems: DedupVerdictItem[]
  /** 冻结时选中的总条数（私有 + 公共去重后按条计） */
  totalSelected: number
  privateCount: number
  publicCount: number
}

export type ImportMode = 'split' | 'private' | 'public'

function emptyCounts(): Record<DedupVerdict, number> {
  return {
    new: 0,
    'exists-local': 0,
    'exists-public': 0,
    'intra-file-dup': 0,
    'title-conflict': 0,
    'folder-conflict': 0,
    'private-blocked': 0,
    invalid: 0,
  }
}

function emptyGroups(): Record<DedupVerdict, DedupVerdictItem[]> {
  return {
    new: [],
    'exists-local': [],
    'exists-public': [],
    'intra-file-dup': [],
    'title-conflict': [],
    'folder-conflict': [],
    'private-blocked': [],
    invalid: [],
  }
}

export interface BuildDedupReportOptions {
  mode?: ImportMode
  /** 公共库指纹数组；null = 索引不可用（dedupeUnavailable） */
  publicIndex?: string[] | null
  truncated?: boolean
  totalMatched?: number
}

/**
 * 从解析产物建去重报告。判定优先级（每条有且仅有一个 verdict）：
 * invalid > intra-file-dup > private-blocked > title-conflict >
 * folder-conflict > exists-local > exists-public > new。
 *
 * 标题/文件夹冲突只在“指纹已在本地收藏”时判定：它们是 exists-local 的子态，
 * 单列出来是为了让用户逐条改判，而不是多算一次重复。
 */
export function buildDedupReport(
  parsed: ParsedUniversalItem[],
  localByFingerprint: ReadonlyMap<string, LocalExistingRef>,
  options: BuildDedupReportOptions = {},
): DedupReport {
  const mode = options.mode ?? 'split'
  const publicSet = options.publicIndex == null ? null : new Set(options.publicIndex)
  const counts = emptyCounts()
  const groups = emptyGroups()
  const seen = new Map<string, DedupVerdictItem>()
  let skippedDuplicates = 0

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i]!
    const fp = fingerprintUrl(raw.href)
    const id = `dedup-${i}`
    const url = raw.href
    if (!fp) {
      const item: DedupVerdictItem = {
        id, sourceIndex: i, verdict: 'invalid', fingerprint: '', title: raw.title || raw.href,
        url, folder: raw.folderName, description: raw.description, tags: raw.tags ?? [],
        reason: '无法归一化的链接（非 http(s) 或格式非法），不进导入列表',
        selectedPrivate: false, selectedPublic: false,
        defaultSelectedPrivate: false, defaultSelectedPublic: false,
        publicLocked: true,
      }
      counts.invalid++
      groups.invalid.push(item)
      continue
    }
    const kept = seen.get(fp)
    if (kept) {
      skippedDuplicates++
      const titleDiffers = raw.title.trim() !== kept.title.trim()
      const folderDiffers = (raw.folderName ?? '') !== (kept.folder ?? '')
      const item: DedupVerdictItem = {
        id, sourceIndex: i, verdict: 'intra-file-dup', fingerprint: fp,
        title: raw.title, url, folder: raw.folderName, description: raw.description,
        tags: raw.tags ?? [], keptById: kept.id,
        reason: titleDiffers || folderDiffers
          ? `文件内与「${kept.title}」同一链接${titleDiffers ? '（标题不同）' : ''}${folderDiffers ? '（文件夹不同）' : ''}，默认保留第一条`
          : `文件内与「${kept.title}」同一链接，默认保留第一条`,
        selectedPrivate: false, selectedPublic: false,
        defaultSelectedPrivate: false, defaultSelectedPublic: false,
        publicLocked: kept.publicLocked,
      }
      counts['intra-file-dup']++
      groups['intra-file-dup'].push(item)
      continue
    }

    const privacy = inspectPrivacy(url)
    const existing = localByFingerprint.get(fp)
    const inPublic = publicSet !== null && publicSet.has(fp)
    let verdict: DedupVerdict
    let reason: string
    if (privacy.blocked) {
      verdict = 'private-blocked'
      reason = `${privacy.reason}，只能进个人收藏`
    } else if (existing && raw.title.trim() !== existing.title.trim()) {
      verdict = 'title-conflict'
      reason = `与收藏夹里的「${existing.title}」同一链接，标题不同`
    } else if (existing && raw.folderName && existing.folder && raw.folderName !== existing.folder) {
      // 文件夹冲突只在两边都有文件夹且不同时判定：导入条没有文件夹时
      // 没有“新文件夹”可移，默认保留已存文件夹，不算冲突
      verdict = 'folder-conflict'
      reason = `与收藏夹里的「${existing.title}」同一链接，文件夹不同`
    } else if (existing) {
      verdict = 'exists-local'
      reason = `与收藏夹里的「${existing.title}」同一链接`
    } else if (inPublic) {
      verdict = 'exists-public'
      reason = '公共导航库已收录'
    } else {
      verdict = 'new'
      reason = '新站点'
    }

    const publicLocked = verdict === 'private-blocked' || verdict === 'exists-public'
    const defaultSelectedPrivate =
      mode !== 'public' &&
      (verdict === 'new' || verdict === 'exists-public' || verdict === 'private-blocked')
    const defaultSelectedPublic = mode !== 'private' && verdict === 'new'
    const item: DedupVerdictItem = {
      id, sourceIndex: i, verdict, fingerprint: fp, title: raw.title, url,
      folder: raw.folderName, description: raw.description, tags: raw.tags ?? [],
      existingTitle: existing?.title, existingFolder: existing?.folder, existingId: existing?.siteId,
      reason,
      // 默认：新条按模式选中；已在公共库的条个人收藏默认选中（现有行为）；
      // 已在本地收藏的条默认不选中（跳过）；隐私拦截只进个人收藏。
      selectedPrivate: defaultSelectedPrivate,
      selectedPublic: defaultSelectedPublic,
      defaultSelectedPrivate,
      defaultSelectedPublic,
      publicLocked,
    }
    counts[verdict]++
    groups[verdict].push(item)
    seen.set(fp, item)
  }

  return {
    totalParsed: parsed.length,
    counts,
    groups,
    dedupeUnavailable: publicSet === null,
    truncated: options.truncated ?? false,
    totalMatched: options.totalMatched,
    skippedDuplicates,
  }
}

/** 报告不变式：各 verdict 计数之和必须等于解析总条数 */
export function checkDedupReportInvariant(report: DedupReport): boolean {
  const sum = (Object.values(report.counts) as number[]).reduce((a, b) => a + b, 0)
  return sum === report.totalParsed
}

/** 把本地收藏列表建成指纹 → 已存条目 的对照表（供 buildDedupReport 用） */
export function buildLocalFingerprintIndex(
  localItems: ReadonlyArray<{ siteId: string; title: string; href: string; folderName?: string }>,
): Map<string, LocalExistingRef> {
  const map = new Map<string, LocalExistingRef>()
  for (const item of localItems) {
    const fp = fingerprintUrl(item.href)
    if (!fp || map.has(fp)) continue
    map.set(fp, { siteId: item.siteId, title: item.title, folder: item.folderName })
  }
  return map
}

/**
 * 逐条改判。override 语义（总协调人决策 4/5/6）：
 * - 'keep-existing'：保留已存标题/文件夹，不选中（跳过）。
 * - 'use-imported'：改判为导入——exists-local/title-conflict 时更新已存条目
 *   （标题/标签/文件夹），绝不重复插入；intra-file-dup 时与保留条互换
 *   （本条选中，保留条取消选中）。
 * - 'move-folder'：文件夹冲突时把已存条目移到导入文件夹（同时选中更新）。
 * 隐私拦截 / invalid / exists-public 的公共投稿不可改判：调用方传了也只改私有侧。
 */
export function applyOverride(
  report: DedupReport,
  id: string,
  override: Exclude<DedupOverride, null>,
): DedupReport {
  const groups = emptyGroups()
  for (const key of Object.keys(report.groups) as DedupVerdict[]) {
    groups[key] = report.groups[key].map((item) => ({ ...item }))
  }
  const all = (Object.values(groups) as DedupVerdictItem[][]).flat()
  const target = all.find((item) => item.id === id)
  if (!target) return report
  if (target.verdict === 'invalid' || target.verdict === 'private-blocked') {
    // 隐私红线与无效条不可改判：原样返回，不静默改写
    return report
  }
  target.override = override
  if (override === 'keep-existing') {
    target.selectedPrivate = false
    target.selectedPublic = false
  } else if (override === 'use-imported') {
    if (target.verdict === 'intra-file-dup' && target.keptById) {
      const kept = all.find((item) => item.id === target.keptById)
      if (kept) {
        kept.selectedPrivate = false
        kept.selectedPublic = false
        kept.override = 'keep-existing'
      }
      target.selectedPrivate = true
      target.selectedPublic = !target.publicLocked
    } else {
      // exists-local / title-conflict / folder-conflict / exists-public：
      // 改判为导入 = 更新已存条目（私有侧选中），公共侧不动
      target.selectedPrivate = true
    }
  } else if (override === 'move-folder') {
    target.selectedPrivate = true
  }
  // 同一指纹同时只能有一条生效（保留条与 dup 条各有独立 id，但指纹相同）：
  // 目标被选中时，同指纹的其他条目一律取消选中——否则冻结清单会把同一 URL
  // 计成两条（imported 1 + updated 1），预览数与执行数对不上。
  const targetSelected = target.selectedPrivate || target.selectedPublic
  for (const other of all) {
    if (other === target || other.fingerprint !== target.fingerprint) continue
    if (targetSelected) {
      other.selectedPrivate = false
      other.selectedPublic = false
      other.override = 'keep-existing'
    }
  }
  if (override === 'keep-existing' && target.verdict === 'intra-file-dup' && target.keptById) {
    // “保留第一条”：dup 取消后保留条按建报告时的默认恢复选中——只把 dup
    // 置 false 会让这条 URL 彻底掉出清单，与按钮文案不符
    const kept = all.find((item) => item.id === target.keptById)
    if (kept) {
      kept.selectedPrivate = kept.defaultSelectedPrivate
      kept.selectedPublic = kept.defaultSelectedPublic
    }
  }
  if (override === 'keep-existing' && target.verdict !== 'intra-file-dup') {
    // 保留条上点“跳过”就是整条 URL 跳过：同指纹的 dup 也一并取消选中
    for (const other of all) {
      if (other === target || other.fingerprint !== target.fingerprint) continue
      other.selectedPrivate = false
      other.selectedPublic = false
      other.override = 'keep-existing'
    }
  }
  return { ...report, groups, counts: { ...report.counts } }
}

/**
 * 同一指纹的“生效条目”：有 dup 被改判选中时用 dup，否则用保留条。
 * 表格行的勾选、标题、文件夹都跟它走，预览与执行才不会各说各话。
 * 判定只看选中态（不看 override 字段）：override 可能残留旧值，选中态才是真凭。
 */
export function activeVariantForKept(report: DedupReport, keptId: string): DedupVerdictItem | undefined {
  const all = (Object.values(report.groups) as DedupVerdictItem[][]).flat()
  const kept = all.find((item) => item.id === keptId)
  if (!kept) return undefined
  const activeDup = all.find(
    (item) => item.keptById === keptId && (item.selectedPrivate || item.selectedPublic),
  )
  return activeDup ?? kept
}

/**
 * 汇总页“跳过”清单：私有/公共都没选中的条目（已存在 / 重复 / 无效 / 用户取消勾选）。
 * 条数恒等于 totalParsed - totalSelected，与冻结清单同源——汇总跳过数不许
 * 再从 writePrivate 的 alreadyExisted 拿（正常流程里它恒为 0）。
 */
export function collectSkippedItems(report: DedupReport): DedupVerdictItem[] {
  return (Object.values(report.groups) as DedupVerdictItem[][])
    .flat()
    .filter((item) => !item.selectedPrivate && !item.selectedPublic)
}

/**
 * 冻结执行清单：点“确认导入”那一刻把选中状态冻结成 plan，
 * 执行只读冻结清单，执行中不再重算——预览数 = 执行数的保证落在这里。
 * 数字同源：Step 4 确认文案与汇总页都从同一份 plan 派生。
 */
export function freezeExecutionPlan(report: DedupReport): ExecutionPlan {
  const all = (Object.values(report.groups) as DedupVerdictItem[][]).flat()
  const privateItems = all.filter((item) => item.selectedPrivate)
  const publicItems = all.filter((item) => item.selectedPublic && !item.publicLocked)
  const folderMoves = all
    .filter((item) => item.override === 'move-folder' && item.existingId && item.folder)
    .map((item) => ({ id: item.id, existingId: item.existingId!, folder: item.folder! }))
  const titleOverrides = all
    .filter((item) => item.override === 'use-imported' && item.verdict === 'title-conflict' && item.existingId)
    .map((item) => ({ id: item.id, existingId: item.existingId!, title: item.title }))
  const updatedItems = all.filter(
    (item) =>
      item.selectedPrivate &&
      item.existingId !== undefined &&
      (item.verdict === 'exists-local' || item.verdict === 'title-conflict' || item.verdict === 'folder-conflict'),
  )
  const selectedIds = new Set([...privateItems, ...publicItems].map((item) => item.id))
  return {
    privateItems,
    publicItems,
    folderMoves,
    titleOverrides,
    updatedItems,
    totalSelected: selectedIds.size,
    privateCount: privateItems.length,
    publicCount: publicItems.length,
  }
}

/** 汇总页“全部跳过”判定：冻结清单里一条新增都没有 */
export function isAllSkippedSummary(plan: ExecutionPlan, addedCount: number): boolean {
  return addedCount === 0 && plan.updatedItems.length === 0
}
