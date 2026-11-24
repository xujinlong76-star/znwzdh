/**
 * P2-13：共享 ResizeObserver + 宽度推导列数。
 *
 * 原实现：每挂载分区一个 ResizeObserver，resize 时逐个调 getComputedStyle
 * 读 gridTemplateColumns；每分类最多挂两处网格（直接组 + 子分类组），
 * observer 实例数与 getComputedStyle 调用数都随分区数线性增长。
 *
 * 新实现：
 * - 全站一个 ResizeObserver 单例，所有网格共用；回调按帧批量下发 entries。
 * - auto-fill 网格（`repeat(auto-fill, minmax(240px,1fr))`）的列数由容器内容宽
 *   直接算出，不读 getComputedStyle：列数 = floor((W + gap) / (240 + gap))。
 *   与浏览器 auto-fill 的分列规则等价（每列至少 240px，列间 gap 均摊），
 *   且与 globals.css 的断点注释一致（gap=14 时 ≥1200px 为 4 列、≥840px 为 3 列、
 *   ≥560px 为 2 列）。resize 连续触发时 getComputedStyle 调用为 0。
 * - 间隙（--density-grid-gap，密度档 10/16/22px）只在挂载时读一次并缓存；
 *   密度切换改 gap 时由单个 MutationObserver（监听 <html> data-density）失效
 *   缓存并重同步一次。窄模块的固定列数网格（class 不含 auto-fill）回退到
 *   getComputedStyle 读实际模板，正确优先（窄模块少、非常驻成本）。
 * - GRID_MIN_COL_PX 是最小列宽的唯一出处：navigation-category-section 的
 *   effectiveGridClass 用它拼 class 字符串，本模块用它算列数，两处改一处即同步。
 */

export const GRID_MIN_COL_PX = 240

/** 由容器内容宽 + 间隙 + 最小列宽推导 auto-fill 列数。 */
export function columnsForWidth(widthPx: number, gapPx: number, minPx: number = GRID_MIN_COL_PX): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1
  if (!Number.isFinite(gapPx) || gapPx < 0) gapPx = 0
  if (!Number.isFinite(minPx) || minPx <= 0) minPx = GRID_MIN_COL_PX
  return Math.max(1, Math.floor((widthPx + gapPx) / (minPx + gapPx)))
}

type GridRecord = {
  el: HTMLDivElement
  /** 挂载时读一次的列间隙（px）；密度切换时由 densityWatcher 失效重读。 */
  gapPx: number
}

const observed = new Map<Element, GridRecord>()
let observer: ResizeObserver | null = null
let densityWatcher: MutationObserver | null = null

function readGapPx(el: HTMLDivElement): number {
  try {
    const parsed = parseFloat(getComputedStyle(el).columnGap)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  } catch {
    // 读不到时用内联样式的 fallback（gap: var(--density-grid-gap, 14px)）。
  }
  return 14
}

/**
 * 从 `getComputedStyle(el).gridTemplateColumns` 精确解析真实列数。
 *
 * 根因修复：当分类区块位于视口外且挂了 `.cv-auto-section`（`content-visibility: auto`）时，
 * Chromium 跳过子树布局，`gridTemplateColumns` 返回未展开的原始模板字符串
 * `"repeat(5, minmax(0px, 1fr))"` 而非解析后的像素序列 `"218px 218px ..."`。
 * 旧实现 `template.split(' ').filter(Boolean).length` 会把 3 个空格分词误判为 3 列
 *（在 3 行模式下把 5 列算成 9 条，滚动进视口展开像素后又变成 15 条，造成跨大类密度分裂）。
 * 本解析器优先识别 `repeat(N, ...)`，再按括号层级统计顶层轨道数，视口内外恒一致。
 */
export function parseGridTemplateColumnCount(template: string | null | undefined): number {
  const raw = (template || '').trim()
  if (!raw || raw === 'none') return 0

  const repeatMatch = /^repeat\(\s*(\d+)\s*,/i.exec(raw)
  if (repeatMatch) {
    const n = Number(repeatMatch[1])
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  let depth = 0
  let count = 0
  let inToken = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (ch === '(') {
      depth++
      if (!inToken) {
        inToken = true
        count++
      }
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
    } else if (/\s/.test(ch)) {
      if (depth === 0) inToken = false
    } else if (!inToken) {
      inToken = true
      count++
    }
  }
  return count
}

function syncOne(rec: GridRecord, entry?: ResizeObserverEntry): void {
  const { el } = rec
  // className 可能随模块拖窄在 auto-fill 与固定列数之间切换，每次重判，不缓存。
  const isAutoFill = el.className.includes('auto-fill')
  let cols: number
  if (isAutoFill) {
    const width =
      entry?.contentBoxSize?.[0]?.inlineSize ?? entry?.contentRect?.width ?? el.clientWidth
    cols = columnsForWidth(width, rec.gapPx)
  } else {
    cols = parseGridTemplateColumnCount(getComputedStyle(el).gridTemplateColumns)
  }
  if (cols > 0) el.dataset.gridCols = String(cols)
}

function ensureObserver(): ResizeObserver {
  if (observer) return observer
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const rec = observed.get(entry.target)
      if (rec) syncOne(rec, entry)
    }
  })
  return observer
}

function ensureDensityWatcher(): void {
  if (densityWatcher || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
  densityWatcher = new MutationObserver(() => {
    for (const rec of observed.values()) {
      rec.gapPx = readGapPx(rec.el)
      syncOne(rec)
    }
  })
  densityWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })
}

/**
 * 网格 className 因卡片展示模式切换而改变时，容器宽度不变（ResizeObserver 不触发），
 * 需主动重算一次所有已观测网格的真实列数，确保预览行数与列数实时对齐、零孤儿行。
 */
export function resyncAllObservedGrids(): void {
  for (const rec of observed.values()) {
    rec.gapPx = readGapPx(rec.el)
    syncOne(rec)
  }
}

/**
 * 观测一个导航网格，把真实列数写进 data-grid-cols。返回取消观测函数
 *（供 React 19 ref callback 作 cleanup）。无 ResizeObserver 环境时同步写一次。
 */
export function observeGridColumns(el: HTMLDivElement): () => void {
  if (typeof ResizeObserver === 'undefined') {
    const rec: GridRecord = { el, gapPx: 14 }
    syncOne(rec)
    return () => {}
  }
  const rec: GridRecord = { el, gapPx: readGapPx(el) }
  observed.set(el, rec)
  ensureDensityWatcher()
  syncOne(rec)
  ensureObserver().observe(el)
  return () => {
    observed.delete(el)
    observer?.unobserve(el)
  }
}
