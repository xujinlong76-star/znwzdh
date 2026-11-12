/**
 * DIY 排版配置的 zod 结构校验（sanitizeDiyLayoutInput + 两份 schema）。
 *
 * 为什么单独一个模块：zod 约 103 KB，静态 import 会进首屏。
 * site-settings.ts 的注释实测过 —— zod 在模块顶层求值、摇不掉，
 * 曾把 103 KB 拖进每一条路由的首屏，最后是靠「schema 拆出去、
 * 轻模块不得 import zod」才修好的。本文件就是 DIY 的那道拆分线：
 *
 *   - 轻模块 `diy-layout-schema.ts`：常量 + 纯函数（深剥、展开、点名、
 *     过滤、编码器），首屏代码可以静态 import，**不得 import zod**；
 *   - 本模块：zod schema + sanitizeDiyLayoutInput，**只能 dynamic import**。
 *     调用方（home-diy-io 的 prepare、diy-share-link 的 parseSharePayload）
 *     在用户触发导入/解析分享时才 `await import(...)` 加载，首屏不付这笔账。
 *
 * 约束：不要把本模块 import 回轻模块，也不要让首屏同步路径上的任何
 * 模块静态 import 本文件。守卫见 diy-share-link.test.ts（包体守卫）。
 */
import { z } from 'zod'
import {
  DIY_SHARE_PAYLOAD_VERSION,
  collectDuplicateIds,
  collectUnknownKeys,
  deepStripDangerousKeys,
  expandShareShortKeys,
  filterKnownHeroWidgets,
  type DiyLayoutSanitizeResult,
} from './diy-layout-schema'

/* ------------------------------------------------------------------ *
 * zod schema：结构门，不是条目级权威
 * ------------------------------------------------------------------ */

/**
 * 上限说明：这里的 max 是「硬性防炸弹」上限，远高于清洗器的业务上限
 * （分类 100、单分类站点 500、小组件 32、id 列表 500）。
 * 业务上限仍由 validateAndCleanDIYConfig 截断并记账；这里只拦
 * 「几千个分类」这种一眼就是 DoS 的载荷，正常超限仍走截断不断言失败。
 */
const idListSchema = z.array(z.unknown()).max(2000).optional()

const DiyCategoryItemSchema = z.object({
  id: z.string().max(128).optional(),
  title: z.string().max(512).optional(),
  href: z.string().max(8192).optional(),
  icon: z.string().max(512).optional(),
  description: z.string().max(512).optional(),
})

const DiyCustomCategorySchema = z.object({
  id: z.string().max(128).optional(),
  title: z.string().max(128).optional(),
  icon: z.string().max(128).optional(),
  items: z.array(DiyCategoryItemSchema).max(2000).optional(),
  createdAt: z.number().optional(),
})

/**
 * 完整 DIY 配置的 zod 形态。字段全部 optional：导入/分享本来就是
 * 「带什么字段、合什么字段」的部分载荷，缺失由清洗器的默认值 + 字段级
 * 合并补齐；全空载荷由调用方（缺 viewMode/version）另行拒收。
 *
 * 类型由 z.infer 推出，与 HomeDIYConfig 对照：
 * 清洗器输出的才是完整 HomeDIYConfig，这里只是「输入长这样」。
 */
export const LayoutSchema = z.object({
  version: z.number().int().optional(),
  viewMode: z.enum(['hybrid', 'classic', 'workbench']).optional(),
  cardDisplayMode: z.enum(['compact', 'standard', 'rich', 'minimal', 'mini-chip']).optional(),
  canvasBackground: z.enum(['mesh', 'dots', 'grid', 'aurora', 'clean']).optional(),
  accentColor: z.enum(['default', 'violet', 'emerald', 'amber', 'rose']).optional(),
  heroDeckCollapsed: z.boolean().optional(),
  heroDeckWidgets: z.array(z.unknown()).max(200).optional(),
  enableAdaptiveRanking: z.boolean().optional(),
  categoryOrder: idListSchema,
  pinnedCategoryIds: idListSchema,
  hiddenCategoryIds: idListSchema,
  collapsedCategoryIds: idListSchema,
  pinnedSiteIdsByCategory: z.record(z.string(), z.array(z.unknown()).max(2000)).optional(),
  customCategories: z.array(DiyCustomCategorySchema).max(1000).optional(),
  siteCategoryOverrides: z.record(z.string(), z.string().max(128)).optional(),
  categoryDensityOverrides: z
    .record(z.string(), z.enum(['compact', 'standard', 'rich', 'minimal', 'mini-chip']))
    .optional(),
  speedDialEnabled: z.boolean().optional(),
  speedDialPinnedIds: idListSchema,
  customWallpaperUrl: z.string().max(8192).optional(),
  glassmorphismBlur: z.number().optional(),
  cardOpacity: z.number().optional(),
  updatedAt: z.number().optional(),
})

export function sanitizeDiyLayoutInput(raw: unknown): DiyLayoutSanitizeResult {
  const empty: Omit<DiyLayoutSanitizeResult, 'ok' | 'error'> = {
    config: undefined,
    format: null,
    schemaValid: false,
    carriedFields: [],
    strippedDangerousKeys: [],
    unknownKeys: [],
    droppedWidgetTypes: [],
    duplicateWidgetIds: [],
    duplicateIds: [],
    zodIssues: [],
    dropped: 0,
    notes: [],
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...empty, ok: false, error: '导入的配置文件不是合法的 JSON 对象' }
  }
  const stripped = deepStripDangerousKeys(raw)
  if (stripped.cyclic.length > 0) {
    return {
      ...empty,
      ok: false,
      error: `配置里有循环引用或嵌套过深，已拒收：${stripped.cyclic.slice(0, 3).join('、')}`,
    }
  }
  const root = stripped.value as Record<string, unknown>

  // 信封：带 `diy` 键的就是新格式 —— 版本必须认识，否则宁可拒收也不猜。
  // 没 `diy` 键的一律按旧裸配置读（旧 #diy= 链接、旧导出的 JSON 永久可读）。
  let format: 'v1' | 'legacy' = 'legacy'
  let configRaw: Record<string, unknown> = root
  if (root.diy !== undefined) {
    if (root.diy !== DIY_SHARE_PAYLOAD_VERSION || !root.config || typeof root.config !== 'object' || Array.isArray(root.config)) {
      return {
        ...empty,
        ok: false,
        error: `分享格式版本 v${String(root.diy)} 不受支持（本机只认 v${DIY_SHARE_PAYLOAD_VERSION} 与旧格式），请用新版重新分享`,
      }
    }
    format = 'v1'
    // 根对象深剥时已递归进 config：这里直接取剥完的副本，不用再剥一次。
    configRaw = root.config as Record<string, unknown>
  }

  const expanded = expandShareShortKeys(configRaw)
  const unknownKeys = collectUnknownKeys(expanded)
  const duplicateIds = collectDuplicateIds(expanded)

  // 小组件先过滤再 zod：未知类型在这里点名丢弃，不进清洗器；
  // 非字符串项留给清洗器按白名单记账（不抢台账）。
  let droppedWidgetTypes: string[] = []
  let duplicateWidgetIds: string[] = []
  if (Array.isArray(expanded.heroDeckWidgets)) {
    const filtered = filterKnownHeroWidgets(expanded.heroDeckWidgets)
    droppedWidgetTypes = filtered.dropped
    duplicateWidgetIds = filtered.duplicates
    expanded.heroDeckWidgets = filtered.kept
  }

  // 携带集按 schema 字段顺序排（与 storage 的分享字段表顺序一致），
  // 而不是输入对象的键顺序 —— 输入先写 bg 后写 accentColor 时，
  // 展开会把 canvasBackground 挪到最后，顺序一乱，调用方按数组比对的
  // 断言与 diff 展示都会抖。只算值 !== undefined 的字段（与 storage
  //「短键或长键出现即算携带」的口径一致）。
  const carriedFields = Object.keys(LayoutSchema.shape).filter(
    // version / updatedAt 是元数据，不是可合并的用户字段：不进携带集，
    // 否则确认时 merge 会拿清洗器的 version: 3 / updatedAt 压本地值。
    (k) => k !== 'version' && k !== 'updatedAt' && expanded[k] !== undefined,
  )

  const parsed = LayoutSchema.safeParse(expanded)
  const zodIssues: string[] = []
  let config: Record<string, unknown>
  let schemaValid = true
  if (parsed.success) {
    config = parsed.data as unknown as Record<string, unknown>
  } else {
    // 结构问题不拒收：把问题记进 notes，展开后的原对象交给清洗器兜底
    // （清洗器对单字段的宽容口径 —— 非字符串枚举回退默认、非数组变空 ——
    // 是旧链接/旧导出一直在依赖的行为，zod 不能悄悄收紧它）。
    schemaValid = false
    config = expanded
    const issues = parsed.error.issues.slice(0, 5)
    for (const issue of issues) {
      const path = issue.path.map(String).join('.') || '<顶层>'
      zodIssues.push(`字段「${path}」${issue.message}`)
    }
    if (parsed.error.issues.length > 5) {
      zodIssues.push(`等共 ${parsed.error.issues.length} 个字段问题`)
    }
  }

  const notes: string[] = []
  for (const p of stripped.stripped) notes.push(`危险键「${p}」已剔除（防原型污染）`)
  for (const k of unknownKeys) notes.push(`未知字段「${k}」不在支持列表，已忽略`)
  if (droppedWidgetTypes.length > 0) {
    notes.push(`首屏小组件「${droppedWidgetTypes.join('、')}」不是已知小组件，已丢弃`)
  }
  if (duplicateWidgetIds.length > 0) {
    notes.push(`首屏小组件「${duplicateWidgetIds.join('、')}」重复出现，已去重`)
  }
  notes.push(...duplicateIds)
  notes.push(...zodIssues)
  if (unknownKeys.length > 20) notes.push(`另有 ${unknownKeys.length - 20} 个未知字段已忽略`)

  const dropped =
    stripped.stripped.length + unknownKeys.length + droppedWidgetTypes.length + duplicateWidgetIds.length

  return {
    ok: true,
    config,
    format,
    schemaValid,
    carriedFields,
    strippedDangerousKeys: stripped.stripped,
    unknownKeys,
    droppedWidgetTypes,
    duplicateWidgetIds,
    duplicateIds,
    zodIssues,
    dropped,
    notes,
  }
}
