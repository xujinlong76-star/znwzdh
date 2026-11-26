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
  /**
   * U-399（2026-11-26）：可读缩放下限。提供时它优先于 maxZoom——
   * 窄屏上「不把图吹大」的上限必须让位于「节点可读可点」：直径 24px 的
   * 节点再小就点不中（WCAG 2.5.8），9px 的标签再小就读不了。
   * 不提供时行为与旧版逐字节一致（桌面路径不传）。
   */
  minReadableZoom?: number
  /**
   * U-399：视图中心对准的布局坐标。提供时 pan 以该点为中心而非包围盒
   * 中心——窄屏高缩放下包围盒中心常是环形布局的空心，定到最高连接度
   * 的节点上，首屏中央一定有个可点的节点。不提供时沿用包围盒中心。
   */
  focusPoint?: { x: number; y: number }
}

/** WCAG 2.5.8 最小目标尺寸：节点在屏上的直径不得小于 24px */
export const GRAPH_MIN_TAP_TARGET_PX = 24
/** 节点标签（11px font-mono）在屏上至少 9px 高才可读 */
export const GRAPH_MIN_LABEL_HEIGHT_PX = 9
/** 节点标签的布局字体大小（组件内写死 11，与此处保持一致） */
export const GRAPH_LABEL_FONT_SIZE = 11
/** 窄屏分界：与组件 `max-md`（768px）同一口径 */
export const GRAPH_NARROW_CONTAINER_PX = 768
/** 最小档节点半径（nodeRadiusForDegree(0)，孤点档） */
export const GRAPH_MIN_NODE_RADIUS = 14

/**
 * U-399：可读缩放下限。给定容器尺寸与最小节点半径，反推 zoom 至少要多大，
 * 才能同时满足「最小节点直径 ≥ 24 屏上 px」与「11px 标签 ≥ 9 屏上 px」。
 * 屏幕换算系数与 computeGraphFit 同口径（meet：min(宽/900, 高/600)）。
 *
 * 390×640 时 screenScale=0.4333：节点口径 24/(2×14×0.4333)≈1.98，
 * 标签口径 9/(11×0.4333)≈1.89，取大者 ≈1.98；1280×800 时 ≈0.64，
 * 低于默认 maxZoom 1.15，桌面即使误传也不会改变任何结果。
 */
export function computeGraphReadableFloor(
  containerWidth: number,
  containerHeight: number,
  minNodeRadius: number = GRAPH_MIN_NODE_RADIUS,
  viewBoxWidth = 900,
  viewBoxHeight = 600,
): number {
  const screenScale =
    Math.min(containerWidth / viewBoxWidth, containerHeight / viewBoxHeight) || 1
  const byNode =
    GRAPH_MIN_TAP_TARGET_PX / (2 * Math.max(1, minNodeRadius) * screenScale)
  const byLabel =
    GRAPH_MIN_LABEL_HEIGHT_PX / (GRAPH_LABEL_FONT_SIZE * screenScale)
  return Math.max(byNode, byLabel)
}

/**
 * 屏幕（client）坐标 → 布局（viewBox）坐标，preserveAspectRatio="xMidYMid meet"
 * 口径：先按 min(宽/900, 高/600) 缩放，再扣掉 meet 居中留下的左右/上下空边。
 * 捏合缩放锚点用它算；纯函数、可单测。
 */
export function toGraphViewBoxPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  viewBoxWidth = 900,
  viewBoxHeight = 600,
): { x: number; y: number } {
  const scale = Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight) || 1
  const offsetX = (rect.width - viewBoxWidth * scale) / 2
  const offsetY = (rect.height - viewBoxHeight * scale) / 2
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  }
}

export interface GraphPinchInput {
  /** 手势开始时的缩放 */
  startZoom: number
  /** 手势开始时的平移 */
  startPan: { x: number; y: number }
  /** 手势开始时两指中点（布局坐标） */
  startMidVb: { x: number; y: number }
  /** 手势开始时两指间距（屏幕 px） */
  startDist: number
  /** 当前两指中点（布局坐标） */
  currentMidVb: { x: number; y: number }
  /** 当前两指间距（屏幕 px） */
  currentDist: number
  /** 缩放下限（组件 +/- 按钮同口径，默认 0.5） */
  minZoom?: number
  /** 缩放上限（桌面 2 / 窄屏 3，与按钮同口径，默认 2） */
  maxZoom?: number
}

/**
 * U-399：双指捏合后的视图。zoom 按间距比缩放并夹在 [minZoom, maxZoom]；
 * pan 按「手势开始时中点下压着的那个布局点，全程跟住当前中点」解算，
 * 于是捏合既缩放又跟手，不会跳到画布中心。
 * startDist <= 0 时只跟手平移、不缩放（防除零）。
 */
export function pinchGraphView(input: GraphPinchInput): GraphFitTransform {
  const minZoom = input.minZoom ?? 0.5
  const maxZoom = input.maxZoom ?? 2
  const ratio = input.startDist > 0 ? input.currentDist / input.startDist : 1
  const zoom = Math.max(minZoom, Math.min(maxZoom, input.startZoom * ratio))
  const zoomRatio = input.startZoom > 0 ? zoom / input.startZoom : 1
  // 中点下压的布局点 c = (startMidVb - startPan) / startZoom；
  // 要求它落在 currentMidVb 下：pan = currentMidVb - c * zoom。
  return {
    zoom,
    pan: {
      x: input.currentMidVb.x - (input.startMidVb.x - input.startPan.x) * zoomRatio,
      y: input.currentMidVb.y - (input.startMidVb.y - input.startPan.y) * zoomRatio,
    },
  }
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
  // U-399：可读下限优先于放大上限（窄屏上传 1.98 > maxZoom 1.15 时仍取 1.98）；
  // 不传 minReadableZoom 时 floor 即 minZoom，与旧版逐字节一致。
  const floor = Math.max(minZoom, opts.minReadableZoom ?? 0)
  const clampedZoom = Math.max(floor, Math.min(maxZoom, zoom))
  // U-399：focusPoint 提供时视图中心对准该点（窄屏首屏定在最高连接度节点上），
  // 否则沿用包围盒中心。
  const cx = opts.focusPoint ? opts.focusPoint.x : (box.minX + box.maxX) / 2
  const cy = opts.focusPoint ? opts.focusPoint.y : (box.minY + box.maxY) / 2
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

/**
 * 开源判定（2026-11-22 图谱视觉解耦）。
 *
 * 图谱里「AI 实验室」原来占用开源翠绿 #10b981，导致「这个节点是 AI 类」
 * 与「这个节点开源」两种语义抢同一个颜色。现在分类色统一改用紫色系，
 * 开源状态改用**形状通道**表达：翠绿外环 + OS 徽标（色盲友好，
 * 不依赖颜色区分）。
 *
 * 判定口径：URL 命中 GitHub/GitLab/Codeberg 等代码托管域名即视为开源；
 * 站点自带 openSource 标记优先（显式数据胜过启发式）。
 */
export function resolveIsOpenSource(input: {
  url?: string
  openSource?: boolean
}): boolean {
  if (typeof input.openSource === 'boolean') return input.openSource
  const raw = String(input.url || '').trim().toLowerCase()
  if (!raw) return false
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    return (
      host === 'github.com' ||
      host === 'gitlab.com' ||
      host === 'codeberg.org' ||
      host === 'bitbucket.org' ||
      host.startsWith('github.') ||
      host.startsWith('gitlab.')
    )
  } catch {
    return false
  }
}
