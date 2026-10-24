import type { LayoutImportReport } from './layout-import-plan'

/**
 * 工作台导入台账 → 一句话（浮层与 toast 共用）。
 *
 * 为什么要抽出来：导入 JSON、消费插件市场暂存、AI 生成布局、详情页直接安装这四条路
 * 都会走到同一份台账。措辞散在四个组件里，迟早有一处退回「已成功还原」这种谎话。
 *
 * 措辞铁律：只有 `droppedWidgets === 0 && emptiedBoards === 0 && invalidBoards === 0`
 * 才允许只报「导入了多少」；只要有一项非零就必须点名少了多少，并把配色降级成 warn ——
 * 绿色横幅配半空画布，是这条链上最容易被原谅的假成功。
 */

export type NoticeTone = 'ok' | 'warn'

/** 类型名最多展示 3 个：再多就是一串没人读的英文，条数才是事实 */
const DISPLAYED_TYPE_LIMIT = 3

export function formatLayoutReport(
  report: LayoutImportReport,
  subject: string
): { text: string; tone: NoticeTone } {
  const typeHint = report.unknownTypes.length
    ? `（${report.unknownTypes.slice(0, DISPLAYED_TYPE_LIMIT).join('、')}${
        report.unknownTypes.length > DISPLAYED_TYPE_LIMIT ? ' 等' : ''
      }）`
    : ''

  if (!report.ok) {
    // 压根没声明看板 = 文件结构不对；声明了但全被剔空 = 模块下线。两种修法不同，分开说。
    if (report.declaredBoards === 0) {
      return { text: `${subject}：导入失败，${report.reason ?? '不是可识别的工作台配置'}`, tone: 'warn' }
    }
    const pieces = [
      report.droppedWidgets > 0
        ? `${report.declaredBoards} 个看板的 ${report.droppedWidgets} 个模块都不支持${typeHint}`
        : `${report.declaredBoards} 个看板里本来就没有模块`,
    ]
    if (report.invalidBoards > 0) pieces.push(`${report.invalidBoards} 项不是看板结构`)
    return { text: `${subject}：导入失败，${pieces.join('，')}，画布保持原样`, tone: 'warn' }
  }

  const head = report.legacySingleBoard
    ? `旧格式已加成 1 个看板（${report.importedWidgets} 个模块）`
    : `已导入 ${report.importedBoards} 个看板（${report.importedWidgets} 个模块）`

  const lostBoards = report.emptiedBoards + report.invalidBoards
  if (report.droppedWidgets === 0 && lostBoards === 0) return { text: `${subject}：${head}`, tone: 'ok' }

  const misses: string[] = []
  if (report.droppedWidgets > 0) misses.push(`${report.droppedWidgets} 个模块不支持${typeHint}`)
  if (report.emptiedBoards > 0) misses.push(`${report.emptiedBoards} 个看板被剔空后没有保留`)
  if (report.invalidBoards > 0) misses.push(`${report.invalidBoards} 项不是看板结构`)
  return { text: `${subject}：${head}，另有 ${misses.join('、')}未导入`, tone: 'warn' }
}
