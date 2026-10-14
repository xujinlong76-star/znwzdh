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
  if (!Array.isArray(list)) return []
  return list.filter((item): item is T => {
    if (!item || typeof item !== 'object') return false
    const type = (item as { type?: unknown }).type
    return typeof type === 'string' && isKnownType(type)
  })
}
