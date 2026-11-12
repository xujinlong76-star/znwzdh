/**
 * DIY 排版配置的 zod 结构校验（share / import 两条不可信输入共用）。
 *
 * 为什么是 zod，而不是再手写一套校验：
 *   - `validateAndCleanDIYConfig`（diy-presets.ts）是条目级权威：白名单、
 *     上限、非法 href、枚举回退，全部带台账（dropped + notes），它的行为
 *     已被 diy-import-honesty.test.ts 钉住，**不替换、不改口径**；
 *   - zod 在这里只做「结构门」：信封版本、危险键深剥、未知字段点名、
 *     未知小组件类型点名、重复 id 点名、硬性尺寸上限，以及一份能被
 *     `z.infer` 推出来的类型。结构问题不直接拒收整份配置 —— zod 失败时
 *     回退到清洗器兜底，只把问题记进 notes（旧链接、旧导出里手写字段的
 *     宽容口径一个都不变）；只有「不是对象」「循环引用」「信封版本未知」
 *     这三类才硬拒收。
 *
 * 分层（调用方按顺序读）：
 *   1. sanitizeDiyLayoutInput(raw)（在 diy-layout-schema-zod.ts，动态加载）：
 *      深剥危险键 → 认信封 → 展开短字段 → 点名未知字段/未知小组件/重复 id
 *      → zod safeParse → 回退清洗器输入；
 *   2. validateAndCleanDIYConfig（diy-presets）：条目级清洗与台账；
 *   3. 调用方（home-diy-io 的 prepare、diy-share-link 的 parseSharePayload）
 *      把两层台账拼成 dropped + notes，交给确认对话框展示。
 *
 * 注意：本文件**不得 import zod**（含间接 import）。zod 约 103 KB，
 * 在模块顶层求值、摇不掉 —— site-settings.ts 的注释实测过，静态引进来
 * 会拖进每一条路由的首屏；DIY 的导入/分享本来也挂在首页同步路径上
 * （use-home-diy → home-diy-io / diy-share-link），所以 zod 的部分
 * 拆去了 `diy-layout-schema-zod.ts`，调用方只在用户触发导入/解析分享时
 * 才 dynamic import。字段名表 DIY_LAYOUT_FIELD_NAMES 与 zod 的
 * LayoutSchema.shape 一一对应，漂移由测试守卫拦住。
 */
import type { HomeDIYConfig } from './home-diy-storage'

/** 新分享信封的版本：`{ diy: 1, config: {...} }`。旧裸配置没有 `diy` 键，走 legacy。 */
export const DIY_SHARE_PAYLOAD_VERSION = 1

/** 明文导入 JSON 的硬上限：5MB。分享链接另有 4KB 上限（见 diy-share-link.ts）。 */
export const DIY_IMPORT_MAX_BYTES = 5 * 1024 * 1024

/** 原型污染三键：深剥时整棵树都按这张表剔除。 */
export const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const
const DANGEROUS_KEY_SET = new Set<string>(DANGEROUS_KEYS)

/**
 * 已知首屏小组件 id：与 WIDGET_REGISTRY（lib/modular/registry.ts）的键一一对应。
 * 展板渲染时未知类型直接 `return null`（home-hero-deck.tsx 的 HeroDeckWidgetItem），
 * 占位却不显示 —— 导入/分享带进来的未知类型必须在这里点名丢弃，不能悄悄留一个空洞。
 * 注册表加新组件时同步改这里；diy-share-link.test.ts 有源码守卫盯着两边对齐。
 */
export const KNOWN_HERO_WIDGET_IDS = [
  'clock-pomodoro',
  'quick-tools',
  'trending-radar',
  'hyperbolic-radar',
  'speculative-terminal',
  'markdown-notes',
  'system-metrics',
  'favorites-dock',
  'custom-category',
  'quick-search',
  'github-heatmap',
  'weather-clock',
  'iframe-embed',
  'live-api',
  'rss-feed',
  'declarative-widget',
] as const
const KNOWN_HERO_WIDGET_SET = new Set<string>(KNOWN_HERO_WIDGET_IDS)

/**
 * #diy= 分享短字段 → 长字段（唯一的一张表：live 解码 applyHomeDiyShareHash
 * 经 parseSharePayload → expandShareShortKeys 走这里，不再另留内联表；
 * diy-share-link.test.ts 的源码守卫盯住 storage 里不再出现第二份表）。
 * 短字段优先于长字段（`vm ?? viewMode` 的口径，见同名测试）。
 */
export const SHARE_SHORT_KEY_MAP = {
  vm: 'viewMode',
  cdm: 'cardDisplayMode',
  bg: 'canvasBackground',
  ac: 'accentColor',
  co: 'categoryOrder',
  pco: 'pinnedCategoryIds',
  hco: 'hiddenCategoryIds',
  sco: 'siteCategoryOverrides',
  wp: 'customWallpaperUrl',
  gb: 'glassmorphismBlur',
  co_op: 'cardOpacity',
} as const

/** 分享链接能携带的字段（长字段名）：parseSharePayload 用它过滤 carriedFields。 */
export const DIY_SHARE_FIELD_NAMES = [
  'viewMode',
  'cardDisplayMode',
  'canvasBackground',
  'accentColor',
  'categoryOrder',
  'pinnedCategoryIds',
  'hiddenCategoryIds',
  'siteCategoryOverrides',
  'customWallpaperUrl',
  'glassmorphismBlur',
  'cardOpacity',
] as const

/** 不属于配置字段、但合法出现在载荷里的键：旧链接的 `v: 3` 与新信封的 `diy: 1`。 */
const KNOWN_NON_CONFIG_KEYS = new Set(['v', 'diy'])


/**
 * 新分享信封的形态：`{ diy: 1, config: <11 个可分享字段，长字段名> }`。
 * 结构版（不用 z.infer），这样编码器 buildVersionedSharePayload 不用碰 zod；
 * 信封版本校验在 sanitizeDiyLayoutInput 里手动做（认 `diy: 1`，不认就拒收），
 * 不另立一份 zod schema。
 */
export interface DiyShareEnvelope {
  diy: typeof DIY_SHARE_PAYLOAD_VERSION
  config: Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * 深剥危险键（防原型污染）+ 循环引用检测
 * ------------------------------------------------------------------ */

export interface DeepStripResult {
  /** 剥完的副本（危险键已剔除；循环分支置为 undefined，调用方见 cyclic 直接拒收） */
  value: unknown
  /** 被剔除的危险键路径，如 `customCategories[0].__proto__` */
  stripped: string[]
  /** 循环引用 / 嵌套过深的路径；非空时调用方必须拒收整份载荷 */
  cyclic: string[]
}

const MAX_STRIP_DEPTH = 64

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function stripDeep(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
  out: { stripped: string[]; cyclic: string[] },
): unknown {
  if (!value || typeof value !== 'object') return value
  if (depth > MAX_STRIP_DEPTH) {
    out.cyclic.push(`${path || '<root>'}（嵌套超过 ${MAX_STRIP_DEPTH} 层）`)
    return undefined
  }
  if (ancestors.has(value)) {
    out.cyclic.push(path || '<root>')
    return undefined
  }
  if (Array.isArray(value)) {
    ancestors.add(value)
    const next = value.map((item, i) => stripDeep(item, `${path}[${i}]`, ancestors, depth + 1, out))
    ancestors.delete(value)
    return next
  }
  if (!isPlainObject(value)) return value
  ancestors.add(value)
  const next: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (DANGEROUS_KEY_SET.has(key)) {
      out.stripped.push(childPath)
      continue
    }
    // key 已确认不在危险表里，普通赋值不会碰原型链。
    next[key] = stripDeep(value[key], childPath, ancestors, depth + 1, out)
  }
  ancestors.delete(value)
  return next
}

/**
 * 递归剔除 __proto__ / constructor / prototype，并检出循环引用。
 *
 * 必须用 JSON.parse 造载荷才能测到 __proto__：对象字面量里的 `__proto__:` 走
 * 的是原型 setter，根本不是普通键 —— 测试里同样用 JSON.parse 造。
 * JSON.parse 本身造不出循环引用；循环只能来自内存对象（解密返回值、直接调用），
 * 这里同样挡住，免得 zod / 清洗器在上面无限递归。
 */
export function deepStripDangerousKeys(value: unknown): DeepStripResult {
  const out: { stripped: string[]; cyclic: string[] } = { stripped: [], cyclic: [] }
  return { value: stripDeep(value, '', new Set(), 0, out), stripped: out.stripped, cyclic: out.cyclic }
}

/* ------------------------------------------------------------------ *
 * 短字段展开 / 未知字段点名 / 小组件过滤 / 重复 id 点名
 * ------------------------------------------------------------------ */

/** 分享短字段 → 长字段；短字段优先（与 applyHomeDiyShareHash 同口径）。 */
export function expandShareShortKeys(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed }
  for (const [short, long] of Object.entries(SHARE_SHORT_KEY_MAP)) {
    if (out[short] !== undefined) {
      if (out[short] !== null) out[long] = out[short]
      delete out[short]
    }
  }
  return out
}

/**
 * LayoutSchema 的全部字段名（与 zod 模块的 LayoutSchema.shape 一一对应，
 * 守卫见 diy-share-link.test.ts）。轻模块不能 import zod，所以这里不用
 * `Object.keys(LayoutSchema.shape)` 派生 —— 改字段时两边一起改，测试会拦住漂移。
 */
export const DIY_LAYOUT_FIELD_NAMES = [
  'version',
  'viewMode',
  'cardDisplayMode',
  'canvasBackground',
  'accentColor',
  'heroDeckCollapsed',
  'heroDeckWidgets',
  'enableAdaptiveRanking',
  'categoryOrder',
  'pinnedCategoryIds',
  'hiddenCategoryIds',
  'collapsedCategoryIds',
  'pinnedSiteIdsByCategory',
  'customCategories',
  'siteCategoryOverrides',
  'categoryDensityOverrides',
  'speedDialEnabled',
  'speedDialPinnedIds',
  'customWallpaperUrl',
  'glassmorphismBlur',
  'cardOpacity',
  'updatedAt',
] as const

const LAYOUT_SHAPE_KEYS = new Set<string>(DIY_LAYOUT_FIELD_NAMES)
const CATEGORY_SHAPE_KEYS = new Set(['id', 'title', 'icon', 'items', 'createdAt'])
const CATEGORY_ITEM_SHAPE_KEYS = new Set(['id', 'title', 'href', 'icon', 'description'])

/**
 * 收集「不在 schema 里的字段」，供确认预览点名。只看定形对象
 * （顶层、自定义分类、分类站点、工作区蓝图值）；Record 型字段
 * （pinnedSiteIdsByCategory 等）的键是用户 id，不是字段名，不点名。
 * 收集上限 20 条，超出只记总数 —— notes 是给人看的，不是日志。
 */
export function collectUnknownKeys(config: Record<string, unknown>): string[] {
  const found: string[] = []
  const push = (p: string) => {
    if (found.length < 20) found.push(p)
  }
  for (const key of Object.keys(config)) {
    if (!LAYOUT_SHAPE_KEYS.has(key) && !KNOWN_NON_CONFIG_KEYS.has(key)) push(key)
  }
  if (Array.isArray(config.customCategories)) {
    config.customCategories.forEach((c, i) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return
      const cat = c as Record<string, unknown>
      for (const key of Object.keys(cat)) {
        if (!CATEGORY_SHAPE_KEYS.has(key)) push(`customCategories[${i}].${key}`)
      }
      if (Array.isArray(cat.items)) {
        cat.items.forEach((it, j) => {
          if (!it || typeof it !== 'object' || Array.isArray(it)) return
          for (const key of Object.keys(it as Record<string, unknown>)) {
            if (!CATEGORY_ITEM_SHAPE_KEYS.has(key)) push(`customCategories[${i}].items[${j}].${key}`)
          }
        })
      }
    })
  }
  return found
}

/** 已知小组件过滤：未知类型丢弃并点名；已知类型去重（展板按 type 做 React key，重复会顶掉）。 */
export function filterKnownHeroWidgets(widgets: unknown): {
  kept: unknown[]
  dropped: string[]
  duplicates: string[]
} {
  if (!Array.isArray(widgets)) return { kept: [], dropped: [], duplicates: [] }
  const kept: unknown[] = []
  const dropped: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  for (const w of widgets) {
    if (typeof w !== 'string') {
      // 非字符串交给清洗器记账（它按白名单逐项丢弃）；这里不抢它的台账。
      kept.push(w)
      continue
    }
    if (!KNOWN_HERO_WIDGET_SET.has(w)) {
      if (!dropped.includes(w)) dropped.push(w)
      continue
    }
    if (seen.has(w)) {
      if (!duplicates.includes(w)) duplicates.push(w)
      continue
    }
    seen.add(w)
    kept.push(w)
  }
  return { kept, dropped, duplicates }
}

/**
 * 重复 id 点名（只点名，不改内容）：
 *   - 自定义分类 id 重复：清洗器会给后出现的重编号，这里只说一声；
 *   - 分类内站点 id 重复：清洗器不改 id（怕断 pinnedSiteIdsByCategory 的引用），
 *     同样只说一声，让用户知道这两条在界面上可能被当成同一条。
 * 统计的是「多出来的出现次数」，不是「内容被丢了多少」—— 内容都在，
 * 所以这组 notes 不计入 dropped。
 */
export function collectDuplicateIds(config: Record<string, unknown>): string[] {
  const notes: string[] = []
  if (!Array.isArray(config.customCategories)) return notes
  const seenCats = new Map<string, number>()
  config.customCategories.forEach((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return
    const cat = c as Record<string, unknown>
    if (typeof cat.id === 'string' && cat.id) {
      const n = (seenCats.get(cat.id) ?? 0) + 1
      seenCats.set(cat.id, n)
      if (n === 2) notes.push(`自定义分类 id「${cat.id}」重复出现，后出现的已重新编号`)
    }
    if (Array.isArray(cat.items)) {
      const seenItems = new Map<string, number>()
      cat.items.forEach((it) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) return
        const id = (it as Record<string, unknown>).id
        if (typeof id === 'string' && id) {
          const n = (seenItems.get(id) ?? 0) + 1
          seenItems.set(id, n)
          if (n === 2) {
            notes.push(`分类「${typeof cat.id === 'string' ? cat.id : '?'}」里站点 id「${id}」重复出现`)
          }
        }
      })
    }
  })
  return notes
}

/* ------------------------------------------------------------------ *
 * 主入口：sanitizeDiyLayoutInput
 * ------------------------------------------------------------------ */

export interface DiyLayoutSanitizeResult {
  /** false 只对应三类硬拒收：不是对象、循环引用/嵌套过深、信封版本未知 */
  ok: boolean
  error?: string
  /** 结构处理后的配置对象（zod 成功时为 safeParse 的输出，失败时为展开后的原对象） */
  config?: Record<string, unknown>
  /** 'v1' = 新信封 { diy: 1, config }；'legacy' = 裸配置（旧 #diy= 与旧导出） */
  format: 'v1' | 'legacy' | null
  /** zod 是否通过；不通过时仍走清洗器兜底，只把问题记进 notes（见文件头） */
  schemaValid: boolean
  /** 展开后实际携带的已知配置字段（供字段级合并与差异预览） */
  carriedFields: string[]
  strippedDangerousKeys: string[]
  unknownKeys: string[]
  droppedWidgetTypes: string[]
  duplicateWidgetIds: string[]
  duplicateIds: string[]
  zodIssues: string[]
  /** 本层吃掉的用户内容条数（危险键 + 未知字段 + 未知/重复小组件） */
  dropped: number
  notes: string[]
}

/**
 * 不可信 DIY 载荷的结构处理（share / import 共用）。
 *
 * 输入可以是 JSON.parse 的结果，也可以是解密/内存里直接递过来的对象。
 * 顺序有讲究：先深剥危险键（后面的步骤再也不用防它），再认信封，
 * 再展开短字段，最后才 zod —— 否则短字段会被当成未知字段点名。
 */
/**
 * 新格式分享载荷：`{ diy: 1, config: <11 个可分享字段，长字段名> }`。
 * 与旧格式的区别只有两点：多了 `diy: 1` 信封、字段用长名。
 * 旧格式（短字段 + `v: 3`）的编码器 encodeShareLink 不动，解码侧两种都认。
 * hook 的 exportPresetToUrlHash 已切到 encodeVersionedShareLink。
 */
export function buildVersionedSharePayload(config: HomeDIYConfig): DiyShareEnvelope {
  return {
    diy: DIY_SHARE_PAYLOAD_VERSION,
    config: {
      viewMode: config.viewMode,
      cardDisplayMode: config.cardDisplayMode,
      canvasBackground: config.canvasBackground,
      accentColor: config.accentColor,
      categoryOrder: config.categoryOrder,
      pinnedCategoryIds: config.pinnedCategoryIds,
      hiddenCategoryIds: config.hiddenCategoryIds,
      siteCategoryOverrides: config.siteCategoryOverrides,
      customWallpaperUrl: config.customWallpaperUrl ?? '',
      glassmorphismBlur: config.glassmorphismBlur ?? 12,
      cardOpacity: config.cardOpacity ?? 0.9,
    },
  }
}
