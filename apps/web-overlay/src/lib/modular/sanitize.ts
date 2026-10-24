/**
 * 模块实例净化（纯函数，无依赖）。
 *
 * 为什么需要：本地存储 / 导入的 JSON 可能含有**已失效的模块类型**
 *（旧版本导出、注册表改名、手写文件）。这类实例在 UI 上会变成
 * "删不掉的僵尸卡片"——组件查不到定义，连删除入口都渲染不出来。
 * 加载与导入两条路径都必须先净化再入 state。
 *
 * 注册表以谓词注入而不是直接 import：本文件因此零依赖，
 * 可在 node:assert 脚本里直接测（见 scripts/modular-sanitize.test.ts）。
 */

/** 单个模块实例的最小结构（净化只校验存在性与类型，不重建字段） */
export interface SanitizableWidget {
  id: string
  type: string
}

/**
 * 过滤无效模块实例：非对象、缺 type、type 不在注册表的一律剔除。
 *
 * @param list          待净化的数组（来自 JSON.parse，类型未知）
 * @param isKnownType   类型是否仍在组件库中（调用方传 WIDGET_REGISTRY 查询）
 */
export function sanitizeWidgetInstances<T extends SanitizableWidget>(
  list: unknown,
  isKnownType: (type: string) => boolean
): T[] {
  return sanitizeWidgetInstancesWithReport<T>(list, isKnownType).items
}

/** 剔除原因分类：三类各自的修法不同，混成一个数字就没人知道该找谁 */
export interface SanitizeDropBreakdown {
  /** 条目本身不是对象（null / 数字 / 字符串）：文件被截断或手写错 */
  malformed: number
  /** 是对象但缺 type，或 type 不是字符串：清单结构不合规 */
  missingType: number
  /** type 是字符串但组件库查不到：模块已下线或改名 */
  unknownType: number
}

export interface SanitizeReport<T extends SanitizableWidget> {
  /** 保留下来的实例 */
  items: T[]
  /** 输入条数（不是数组时为 0） */
  total: number
  /** 剔除条数，恒等于 `total - items.length`，也等于三类之和 */
  dropped: number
  droppedByKind: SanitizeDropBreakdown
  /**
   * 查不到的类型名，按首次出现顺序去重。
   * 只用于「哪几类模块下线了」这句人话，不是全量清单：计数看 `droppedByKind`。
   */
  unknownTypes: string[]
}

/** 类型名样本上限：恶意清单可以塞几万个不同的 type，名字够解释就够了 */
const UNKNOWN_TYPE_SAMPLE_LIMIT = 6

/**
 * 与 `sanitizeWidgetInstances` 同一套判定，额外把「剔掉了多少、为什么剔」算出来。
 *
 * 为什么要带台账：净化的返回值只进 state，调用方看到的是一个变短的数组，
 * 分不清「文件本来就没这些模块」和「模块全下线了」。导入与安装两条路径都要
 * 把这件事说清楚，否则用户以为配置还原成功，实际画布空了一半。
 */
export function sanitizeWidgetInstancesWithReport<T extends SanitizableWidget>(
  list: unknown,
  isKnownType: (type: string) => boolean
): SanitizeReport<T> {
  const report: SanitizeReport<T> = {
    items: [],
    total: 0,
    dropped: 0,
    droppedByKind: { malformed: 0, missingType: 0, unknownType: 0 },
    unknownTypes: [],
  }
  if (!Array.isArray(list)) return report
  report.total = list.length
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      report.droppedByKind.malformed++
      continue
    }
    const type = (item as { type?: unknown }).type
    if (typeof type !== 'string') {
      report.droppedByKind.missingType++
      continue
    }
    if (!isKnownType(type)) {
      report.droppedByKind.unknownType++
      if (report.unknownTypes.length < UNKNOWN_TYPE_SAMPLE_LIMIT && !report.unknownTypes.includes(type)) {
        report.unknownTypes.push(type)
      }
      continue
    }
    report.items.push(item as T)
  }
  report.dropped = report.droppedByKind.malformed + report.droppedByKind.missingType + report.droppedByKind.unknownType
  return report
}
