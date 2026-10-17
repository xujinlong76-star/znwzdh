/**
 * 生态图谱的键盘导航：**几何关系放在纯函数里算**，组件只负责搬焦点。
 *
 * 真实缺陷（components/ecosystem-graph.tsx）：节点是一个只有 `onClick` 的 SVG `<g>`
 *
 *     <g transform={...} className="cursor-pointer" onClick={() => setSelectedNode(n)}>
 *
 * —— 不可聚焦、不能回车、方向键无效。整个 `/graph` 页面（本站的旗舰可视化之一）
 * 对键盘用户是**完全不可用**的：连一个节点都选不中，更别说右侧详情抽屉里的
 * 「关联拓扑」跳转。这与已修的 `/videos`（卡片改成真按钮）、`/favorites` 一致：
 * 能点的地方，键盘也必须能用。
 *
 * 图谱是二维的，Tab 顺序没有意义，所以采用「漫游 tabindex + 方向键按几何方向移动」：
 * 只有当前节点在 Tab 序列里，方向键跳到该方向上最接近的节点。判定规则很朴素 ——
 * 主方向距离 + 侧向距离×2，取最小者（直走优先于斜穿），纯函数、可穷举测试。
 */

/** 参与导航的节点只需有 id 与平面坐标 */
export interface GraphPoint {
  id: string
  x: number
  y: number
}

export type GraphDirection = 'left' | 'right' | 'up' | 'down'

/** 主方向必须为正才算是「那个方向」；留一点容差以容纳手写坐标的浮点误差 */
const MIN_PRIMARY_DISTANCE = 0.5

/** 侧向偏移的惩罚权重：越大越倾向「尽量直着走」 */
const PERPENDICULAR_PENALTY = 2

/** 按键 → 方向；不是方向键则返回 null */
export function directionFromKey(key: string): GraphDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    default:
      return null
  }
}

/** 是否「激活」键（选中节点）。空格在浏览器里还会滚动页面，调用方记得 preventDefault */
export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}

/**
 * 从 `currentId` 出发，沿 `direction` 找最接近的节点；没有更靠前的节点时返回 null。
 *
 * 打分 = 主方向距离 + 侧向距离 × 2：
 * - 主方向必须为正（在左边就不算「右」）；
 * - 侧向远近参与比较，于是「正右方、稍远」会胜过「右下方、很近」；
 * - 同分时按输入顺序取先者，结果稳定。
 */
export function nextNodeInDirection<T extends GraphPoint>(
  nodes: readonly T[],
  currentId: string,
  direction: GraphDirection,
): T | null {
  const current = nodes.find((n) => n.id === currentId)
  if (!current) return null

  let best: T | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const node of nodes) {
    if (node.id === current.id) continue

    const dx = node.x - current.x
    const dy = node.y - current.y

    let primary: number
    let perpendicular: number
    switch (direction) {
      case 'right':
        primary = dx
        perpendicular = Math.abs(dy)
        break
      case 'left':
        primary = -dx
        perpendicular = Math.abs(dy)
        break
      case 'down':
        primary = dy
        perpendicular = Math.abs(dx)
        break
      case 'up':
        primary = -dy
        perpendicular = Math.abs(dx)
        break
    }

    if (primary <= MIN_PRIMARY_DISTANCE) continue

    const score = primary + perpendicular * PERPENDICULAR_PENALTY
    if (score < bestScore) {
      bestScore = score
      best = node
    }
  }

  return best
}

/**
 * 漫游 tabindex 的落点：优先保留当前焦点，若它已被筛选掉（换分类/搜索）则回落到
 * 第一个可见节点。返回 null 表示当前没有可见节点（此时不应有节点可 Tab 进入）。
 */
export function rovingNodeId<T extends { id: string }>(
  nodes: readonly T[],
  focusedId: string | null | undefined,
): string | null {
  if (nodes.length === 0) return null
  if (focusedId && nodes.some((n) => n.id === focusedId)) return focusedId
  return nodes[0].id
}

/** 节点的可访问名：单独一个英文名对读屏用户信息量太少，带上分类 */
export function nodeAccessibleName(title: string, categoryName: string): string {
  return `${title}（${categoryName}）`
}
