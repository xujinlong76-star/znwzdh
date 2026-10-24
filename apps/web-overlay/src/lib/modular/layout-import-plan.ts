/**
 * 工作台看板与「导入/安装台账」（纯函数，零 React 依赖）。
 *
 * 为什么单独成文件：`use-modular-layout` 挂着 React 与组件注册表，在 node 环境里
 * 导不进来；而台账的计数恰恰是最需要拿真实 JSON 跑不变式的地方
 * （看板项是不是对象、整块有没有被剔空、模块类型是否下线）。
 * 与 `sanitize.ts` 同一套做法：注册表以谓词注入，本文件因此可以直接测。
 */

import type { WidgetInstance } from '@/types/modular'
import { sanitizeWidgetInstancesWithReport } from './sanitize'

export interface Board {
  id: string
  name: string
  widgets: WidgetInstance[]
}

/** 模块类型名样本上限：恶意清单能塞几万个不同 type，够解释「哪几类下线」就行 */
const UNKNOWN_TYPE_SAMPLE_LIMIT = 6

/**
 * 工作台配置导入/安装的台账（`importLayoutJson` 与 `installWidgetPreset` 共用）。
 *
 * 不变式：`declaredBoards === importedBoards + emptiedBoards + invalidBoards`，
 * `ok` 为真当且仅当 `importedBoards > 0`。UI 只能照这些数说话。
 */
export interface LayoutImportReport {
  /** 是否有内容真正进入画布；false 时 state 一律没动 */
  ok: boolean
  /** 文件里声明的看板数（含无效项与归零项） */
  declaredBoards: number
  /** 真正进入画布的看板数 */
  importedBoards: number
  /** 保留下来的模块实例数 */
  importedWidgets: number
  /** 是对象、但清洗后一个模块都不剩，因此整块没进画布 */
  emptiedBoards: number
  /** 看板项本身不是对象（null / 字符串 / 数字）而被跳过 */
  invalidBoards: number
  /** 被清洗掉的模块实例数（与 `unknownTypes` 是「条数 vs 名字样本」的关系） */
  droppedWidgets: number
  /** 查不到的模块类型名（去重，最多 6 个） */
  unknownTypes: string[]
  /** 走的是顶层 `widgets` 的旧单看板格式 */
  legacySingleBoard: boolean
  /** `ok` 为假时给用户的原因；为真时是 null */
  reason: string | null
}

function emptyLayoutImportReport(reason: string): LayoutImportReport {
  return {
    ok: false,
    declaredBoards: 0,
    importedBoards: 0,
    importedWidgets: 0,
    emptiedBoards: 0,
    invalidBoards: 0,
    droppedWidgets: 0,
    unknownTypes: [],
    legacySingleBoard: false,
    reason,
  }
}

/** `planLayoutImport` 的产物：台账 + 该以什么方式落到 state */
export interface LayoutImportPlan {
  report: LayoutImportReport
  /** replace = 这批直接成为全部看板；append = 追加（旧单看板格式走这条） */
  mode: 'replace' | 'append'
  /** `report.ok` 为真时才有内容 */
  boards: Board[]
  /** 仅 replace 用：文件声明的激活看板，命中导入结果才采用 */
  activeBoardId: string | null
}

function invalidPlan(report: LayoutImportReport): LayoutImportPlan {
  return { report, mode: 'replace', boards: [], activeBoardId: null }
}

/**
 * 把一段 JSON 文本解析成「要装哪些看板 + 逐因台账」，不碰任何 state。
 *
 * 为什么单独导出：真正的坑都在计数上（看板项不是对象、整块被剔空、模块类型下线）。
 * 留在 hook 里就只能靠读源码断言，抽成纯函数后能用真实 JSON 跑不变式。
 * `isKnownType` 由调用方注入（hook 传注册表查询，测试传假谓词），本函数因此无依赖。
 */
export function planLayoutImport(
  jsonStr: string,
  isKnownType: (type: string) => boolean
): LayoutImportPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return invalidPlan(emptyLayoutImportReport('文件不是合法的 JSON'))
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // 数组也要挡：`typeof [] === 'object'`，放过去只会落到最底下那句
    // 「既没有 boards 也没有 widgets」，用户看不出自己拿到的是书签导出而不是工作台备份
    return invalidPlan(emptyLayoutImportReport('文件内容不是一个工作台配置对象'))
  }
  const doc = parsed as { boards?: unknown; widgets?: unknown; activeBoardId?: unknown }

  // 过滤已被删除/改名的模块类型：与加载逻辑同源（sanitizeWidgetInstances），
  // 否则无效类型会渲染成"删不掉的僵尸卡片"（ModularItem 另有降级兜底）
  if (Array.isArray(doc.boards) && doc.boards.length > 0) {
    let invalidBoards = 0
    let droppedWidgets = 0
    let importedWidgets = 0
    const unknownTypes: string[] = []
    const boards: Board[] = []
    for (const rawBoard of doc.boards) {
      // 看板项本身不是对象（null / 字符串 / 数字）：整块跳过并记数，不静默消失
      if (!rawBoard || typeof rawBoard !== 'object') {
        invalidBoards++
        continue
      }
      const b = rawBoard as Partial<Board>
      const cleaned = sanitizeWidgetInstancesWithReport<WidgetInstance>(b.widgets, isKnownType)
      droppedWidgets += cleaned.dropped
      importedWidgets += cleaned.items.length
      for (const t of cleaned.unknownTypes) {
        if (unknownTypes.length < UNKNOWN_TYPE_SAMPLE_LIMIT && !unknownTypes.includes(t)) unknownTypes.push(t)
      }
      // 清洗后一个模块都不剩：留个空看板只会让用户以为导坏了
      if (cleaned.items.length === 0) continue
      boards.push({
        id: String(b.id || `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        name: String(b.name || '导入看板'),
        widgets: cleaned.items,
      })
    }
    const report: LayoutImportReport = {
      ok: boards.length > 0,
      declaredBoards: doc.boards.length,
      importedBoards: boards.length,
      importedWidgets,
      // 声明过、也是对象，但清洗后归零，因此整块没进画布
      emptiedBoards: doc.boards.length - invalidBoards - boards.length,
      invalidBoards,
      droppedWidgets,
      unknownTypes,
      legacySingleBoard: false,
      reason: boards.length === 0 ? '这些看板里没有当前支持的模块（类型可能已下线）' : null,
    }
    if (!report.ok) return invalidPlan(report)
    const declaredActive = typeof doc.activeBoardId === 'string' ? doc.activeBoardId : null
    return {
      report,
      mode: 'replace',
      boards,
      activeBoardId: declaredActive && boards.some((b) => b.id === declaredActive) ? declaredActive : boards[0]?.id ?? null,
    }
  }

  // 兼容单看板导入：旧格式只有一组 widgets，追加成一个新看板而不是覆盖全站
  if (Array.isArray(doc.widgets)) {
    const cleaned = sanitizeWidgetInstancesWithReport<WidgetInstance>(doc.widgets, isKnownType)
    const report: LayoutImportReport = {
      ok: cleaned.items.length > 0,
      declaredBoards: 1,
      importedBoards: cleaned.items.length > 0 ? 1 : 0,
      importedWidgets: cleaned.items.length,
      emptiedBoards: cleaned.items.length > 0 ? 0 : 1,
      invalidBoards: 0,
      droppedWidgets: cleaned.dropped,
      unknownTypes: cleaned.unknownTypes,
      legacySingleBoard: true,
      reason: cleaned.items.length === 0 ? '这份旧格式配置里没有当前支持的模块（类型可能已下线）' : null,
    }
    if (!report.ok) return invalidPlan(report)
    return {
      report,
      mode: 'append',
      boards: [
        {
          id: `imported-${Date.now()}`,
          name: `导入看板 (${new Date().toLocaleDateString('zh-CN')})`,
          widgets: cleaned.items,
        },
      ],
      activeBoardId: null,
    }
  }

  // 认不出的结构必须说清「为什么没动静」，否则用户只会看到什么都没发生
  return invalidPlan(emptyLayoutImportReport('文件里既没有 boards 也没有 widgets，不是工作台配置'))
}

/** 预设看板项（字段全可缺：来自远端清单，什么都可能是 `undefined`） */
export interface PresetBoardInput {
  name?: string
  widgets?: Array<Record<string, unknown> | null> | null
}

export interface PresetInstallInput {
  boards?: Array<PresetBoardInput | null> | null
}

/**
 * 把 workspace-preset 的 payload 变成「要装哪些看板 + 逐因台账」，不碰 state。
 *
 * 单独导出的理由与 `planLayoutImport` 相同，另外这里以前有两个真缺陷：
 * 1. `b.widgets` / `w.type` 都没做类型守卫，远端清单里出现 `null` 条目会直接抛 TypeError；
 * 2. 剔空后的看板被静默丢掉，调用方仍然报「安装成功」。
 */
export function planPresetInstall(
  preset: PresetInstallInput | null | undefined,
  isKnownType: (type: string) => boolean
): { report: LayoutImportReport; boards: Board[] } {
  if (!preset || !Array.isArray(preset.boards) || preset.boards.length === 0) {
    return { report: emptyLayoutImportReport('预设里没有看板数据'), boards: [] }
  }
  let invalidBoards = 0
  let droppedWidgets = 0
  let importedWidgets = 0
  const unknownTypes: string[] = []
  const boards: Board[] = []
  preset.boards.forEach((rawBoard, bIdx) => {
    // 看板项可能是 null（清单手写错 / 远端裁剪过）：原来 `b.widgets` 会直接抛
    if (!rawBoard || typeof rawBoard !== 'object') {
      invalidBoards++
      return
    }
    const b = rawBoard
    // 不先归一化再净化：null 条目要留在「不是对象」这一类，缺 type 的要留在「缺 type」这一类。
    // 以前用 `String(w.type ?? '')` 兜底，把两者都抹成了「一个下线的类型」，
    // unknownTypes 里还会多出一个空串，拼进提示就成了「（、weather）」这种话。
    const instances: unknown[] = (Array.isArray(b.widgets) ? b.widgets : []).map((rawWidget, wIdx) => {
      if (!rawWidget || typeof rawWidget !== 'object') return rawWidget
      const w = rawWidget as Record<string, unknown>
      return {
        id: `widget-preset-${Date.now()}-${bIdx}-${wIdx}`,
        type: w.type,
        customTitle: typeof w.customTitle === 'string' ? w.customTitle : undefined,
        colSpan: typeof w.colSpan === 'number' ? w.colSpan : 4,
        rowSpan: typeof w.rowSpan === 'number' ? w.rowSpan : 1,
        config: typeof w.config === 'object' && w.config !== null ? (w.config as Record<string, unknown>) : {},
        createdAt: Date.now(),
      }
    })
    const cleaned = sanitizeWidgetInstancesWithReport<WidgetInstance>(instances, isKnownType)
    droppedWidgets += cleaned.dropped
    importedWidgets += cleaned.items.length
    for (const t of cleaned.unknownTypes) {
      if (unknownTypes.length < UNKNOWN_TYPE_SAMPLE_LIMIT && !unknownTypes.includes(t)) unknownTypes.push(t)
    }
    if (cleaned.items.length === 0) return
    boards.push({
      id: `board-preset-${Date.now()}-${bIdx}`,
      name: b.name || `预设看板 ${bIdx + 1}`,
      widgets: cleaned.items,
    })
  })
  return {
    report: {
      ok: boards.length > 0,
      declaredBoards: preset.boards.length,
      importedBoards: boards.length,
      importedWidgets,
      emptiedBoards: preset.boards.length - invalidBoards - boards.length,
      invalidBoards,
      droppedWidgets,
      unknownTypes,
      legacySingleBoard: false,
      reason: boards.length === 0 ? '这个预设里没有当前可用的模块（类型可能已下线）' : null,
    },
    boards,
  }
}
