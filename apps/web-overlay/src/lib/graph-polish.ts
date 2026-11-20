/**
 * `/graph` 图谱视觉优化的纯函数层（2026-11-21 图谱打磨轮）：
 *
 * - 长名称智能截断（修「UK AI Safety Institute (」这类残缺括号）；
 * - fitView 数学：内容包围盒（含文字）→ 居中缩放 + 安全边距；
 * - 连接度分档、边胶囊文案与宽度估算。
 *
 * 全部是纯函数、可单测；组件只负责搬数据与挂事件。
 * 坐标系：布局坐标 = SVG viewBox 坐标（900×600），与组件内一致。
 */

/** 布局坐标系的包围盒 */
export interface GraphFitBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** fitView 的结果：直接写进组件的 zoom / pan state */
export interface GraphFitTransform {
  zoom: number
  pan: { x: number; y: number }
}

export interface GraphFitEdgeLike {
  source: string
  target: string
  type: 'alternative' | 'ecosystem'
  label?: string
}

/** 截断后末尾不许残留的标点（含中英文开括号与连接符） */
const TRAILING_JUNK = new Set([
  '(', '（', '[', '{', '<', '《',
  ')', '）', ']', '}', '>',
  '-', '–', '—', '/', '\\', '|', '·', '•',
  ',', '，', '.', '。', ':', '：', ';', '；', '!', '！', '?', '？',
  ' ', '　', '\t',
])

/** 默认最大显示字符数（CJK 与拉丁均按 1 计） */
export const GRAPH_LABEL_MAX_CHARS = 15

/**
 * 长名称智能截断：超过 maxChars 时截断，去掉末尾残缺标点再拼 …。
 * - 完整名称（<= maxChars）原样返回，不动；
 * - 截断点落在开括号后时（如 "UK AI Safety Institute ("）把残缺的 "(" 一并去掉，
 *   不许出现 "… (" 或 "(…" 这类半截括号；
 * - 末尾是 - / / · 等连接符时同样去掉，避免 "xxx-…" 这种断词。
 */
export function truncateGraphLabel(title: string, maxChars: number = GRAPH_LABEL_MAX_CHARS): string {
  const text = (title || '').trim()
  const chars = [...text]
  if (chars.length <= maxChars) return text
  let cut = chars.slice(0, maxChars)
  while (cut.length > 0 && TRAILING_JUNK.has(cut[cut.length - 1]!)) {
    cut.pop()
  }
  if (cut.length === 0) cut = chars.slice(0, maxChars)
  return `${cut.join('')}…`
}

/** 单字符在 font-mono 11px 下的估算宽度：CJK 全角 11px，拉丁等宽约 6.6px */
function charWidthAt11(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  // CJK 统一表意文字 / 全角标点 / 假名 / 谚文：按全角计
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xac00 && code <= 0xd7a3)
  ) {
    return 11
  }
  return 6.6
}

/** 节点标签（截断后）在 11px font-mono 下的估算像素宽 */
export function estimateGraphLabelWidth(label: string): number {
  let w = 0
  for (const ch of [...label]) w += charWidthAt11(ch)
  return w
}

/**
 * 单个节点在布局坐标系里的包围盒（含圆点 + 下方文字）：
 * 左右取圆半径与半个标签宽的最大值；下方留出标签行（基线 y+28，约到 y+34）。
 */
export function nodeContentBox(
  x: number,
  y: number,
  radius: number,
  label: string,
): GraphFitBox {
  const halfLabel = estimateGraphLabelWidth(label) / 2 + 3
  const half = Math.max(radius, halfLabel)
  return {
    minX: x - half,
    maxX: x + half,
    minY: y - radius - 2,
    maxY: y + 34,
  }
}

/** 全部可见节点的并集包围盒；空列表返回 null */
export function graphContentBox(
  nodes: ReadonlyArray<{ x?: number; y?: number }>,
  radiusFor: (index: number) => number,
  labelFor: (index: number) => string,
): GraphFitBox | null {
  if (nodes.length === 0) return null
  let box: GraphFitBox | null = null
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    const b = nodeContentBox(n.x ?? 0, n.y ?? 0, radiusFor(i), labelFor(i))
    if (!box) {
      box = b
    } else {
      box = {
        minX: Math.min(box.minX, b.minX),
        minY: Math.min(box.minY, b.minY),
        maxX: Math.max(box.maxX, b.maxX),
        maxY: Math.max(box.maxY, b.maxY),
      }
    }
  }
  return box
}

export interface GraphFitOptions {
  /** 布局坐标系宽（组件 viewBox 宽，默认 900） */
  viewBoxWidth?: number
  /** 布局坐标系高（组件 viewBox 高，默认 600） */
  viewBoxHeight?: number
  /** 四周安全内边距（屏幕像素，默认 56） */
  paddingPx?: number
  /** fit 放大的上限：节点太少时不许把图吹得过大（默认 1.15） */
  maxZoom?: number
  /** fit 缩小的下限：避免内容被压成一点（默认 0.2） */
  minZoom?: number
}

/**
 * fitView：把内容包围盒按画布实际宽高比缩放并居中，预留安全边距。
 *
 * 画布是固定 viewBox + preserveAspectRatio="xMidYMid meet"，屏幕像素与
 * viewBox 单位的换算系数 = min(容器宽 / viewBox 宽，容器高 / viewBox 高)，
 * 内边距（屏幕 px）要先除以该系数再在 viewBox 坐标系里扣。
 * 返回的 zoom / pan 可直接写进组件 state（<g transform> 用）。
 */
export function computeGraphFit(
  box: GraphFitBox,
  containerWidth: number,
  containerHeight: number,
  opts: GraphFitOptions = {},
): GraphFitTransform {
  const viewBoxWidth = opts.viewBoxWidth ?? 900
  const viewBoxHeight = opts.viewBoxHeight ?? 600
  const paddingPx = opts.paddingPx ?? 56
  const maxZoom = opts.maxZoom ?? 1.15
  const minZoom = opts.minZoom ?? 0.2

  const screenScale = Math.min(containerWidth / viewBoxWidth, containerHeight / viewBoxHeight) || 1
  const pad = paddingPx / screenScale
  const availW = Math.max(1, viewBoxWidth - pad * 2)
  const availH = Math.max(1, viewBoxHeight - pad * 2)
  const boxW = Math.max(1, box.maxX - box.minX)
  const boxH = Math.max(1, box.maxY - box.minY)

  const zoom = Math.min(availW / boxW, availH / boxH, maxZoom)
  const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoom))
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return {
    zoom: clampedZoom,
    pan: {
      x: viewBoxWidth / 2 - cx * clampedZoom,
      y: viewBoxHeight / 2 - cy * clampedZoom,
    },
  }
}

/** 每个节点的连接度（只计两端都在可见集里的边；无向计数） */
export function computeNodeDegrees(
  edges: ReadonlyArray<GraphFitEdgeLike>,
  visibleIds: ReadonlySet<string>,
): Map<string, number> {
  const degrees = new Map<string, number>()
  for (const e of edges) {
    if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue
    degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1)
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1)
  }
  return degrees
}

/**
 * 节点半径按连接度分 3 档：孤点/1 度 14，2–3 度 17，4 度以上 20（核心枢纽略大）；
 * 选中态 +4（旧值 16→23 的比例关系保留）。
 */
export function nodeRadiusForDegree(degree: number, selected = false): number {
  const base = degree >= 4 ? 20 : degree >= 2 ? 17 : 14
  return selected ? base + 4 : base
}

/**
 * 边胶囊文案（hover / 聚焦时才浮现）：
 * - 共享标签边（label 为「共享:xxx」）→「平替 · xxx」/「生态 · xxx」；
 * - 预设边自带文案（开源平替 / 竞品 / 原生部署…）原样展示；
 * - 无文案时只显示类型名。
 */
export function edgeCapsuleText(edge: GraphFitEdgeLike): string {
  const typeLabel = edge.type === 'alternative' ? '平替' : '生态'
  const label = (edge.label || '').trim()
  if (!label) return typeLabel
  if (label.startsWith('共享:')) {
    const tag = label.slice('共享:'.length).trim()
    return tag ? `${typeLabel} · ${tag}` : typeLabel
  }
  return label
}

/** 胶囊文字在 10px 下的估算宽度（CJK 按 10px，拉丁按 6px；两侧各留 8px 内边距） */
export function capsuleTextWidth(text: string, fontSize = 10): number {
  let w = 0
  for (const ch of [...text]) {
    const code = ch.codePointAt(0) ?? 0
    const isCjk =
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xac00 && code <= 0xd7a3)
    w += isCjk ? fontSize : fontSize * 0.6
  }
  return Math.ceil(w) + 16
}
