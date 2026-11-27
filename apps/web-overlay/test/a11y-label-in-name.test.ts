/**
 * WCAG 2.5.3 Label in Name（R5-A Lighthouse 2026-11-27，U-460 / U-461）。
 *
 * Lighthouse 在 main eeca6c14 上对三处报 `label-content-name-mismatch` 0 分：
 * - 首页 DIY 排版按钮：可见文案 `DIY 排版`，aria-label 却不含它；
 * - 首页移动端工作区触发器：可见文案是当前工作区名，aria-label 却不含它；
 * - /graph 节点 `<g role="button">`：可见的 monogram 字母 / `OS` 徽标 / 截断标签
 *   都不在 accessible name 内。
 *
 * 修法（与 Lighthouse 规则对齐）：
 * - 可见文案是 accessible name 的子串（DIY / 工作区触发器把可见文案放进
 *   aria-label 最前；图谱节点把截断后的可见标签放进 name 最前）；
 * - 图谱里纯装饰的可见文本（monogram 字母、`OS` 徽标）移出 `<g role="button">`
 *   子树（与按钮同处一个定位 `<g>` 下的兄弟节点，视觉位置不变）——
 *   axe 的 label-content-name-mismatch 按「可见文本」比对，aria-hidden 只藏
 *   AT、不藏视线，单加 aria-hidden 仍会被该规则计入（实测：axe-core 4.14
 *   对移出前的结构仍报 1 处违规），所以必须移出子树；aria-hidden 仍保留，
 *   让读屏浏览 SVG 时不逐字念出装饰字母；
 * - 下方标签文本保持在按钮内、保持可见，它是 name 必须包含的文案。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nodeAccessibleName } from '../src/lib/graph-nav'
import { truncateGraphLabel } from '../src/lib/graph-polish'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/** 取出源码里某行 aria-label="..." 的完整字符串值 */
function ariaLabelValue(src: string, anchor: string): string {
  const idx = src.indexOf(anchor)
  expect(idx, '找不到锚点 ' + anchor).toBeGreaterThan(-1)
  const m = src.slice(idx, idx + 1000).match(/aria-label="([^"]*)"/)
  expect(m, '锚点附近没有 aria-label="..."').not.toBeNull()
  return m![1]!
}

describe('U-460 首页：可见文案必须在 accessible name 内', () => {
  it('DIY 排版按钮：aria-label 以可见文案「DIY 排版」开头', () => {
    const src = overlaySource('src/components/navigation-toolbar.tsx')
    // Rebase（2026-11-27，基底 7933bde5）：main 的 WIP 回滚删掉了 DIY 按钮的
    // data-testid="diy-toggle-btn"，故定位锚点改用按钮上唯一且紧贴 aria-label 的
    // title（下一行即 aria-label）；断言本身不变（可见文案在 name 内且在最前）。
    // 按钮内可见文案
    expect(src).toContain('>DIY 排版</span>')
    const label = ariaLabelValue(src, 'title="DIY 排版、外观与皮肤（打开外观向导小窗）"')
    expect(label).toContain('DIY 排版')
    expect(label.startsWith('DIY 排版')).toBe(true)
  })

  it('移动端工作区触发器：aria-label 以当前工作区名开头', () => {
    const src = overlaySource('src/components/home-capsule-row.tsx')
    // 按钮内可见文案就是当前工作区名
    expect(src).toContain('<span>{currentWorkspace.label}</span>')
    // aria-label 是模板串：可见的工作区名在最前，再补功能说明
    expect(src).toContain('aria-label={`${currentWorkspace.label}：切换工作区与快捷功能`}')
    expect(src).not.toContain('aria-label="切换工作区与快捷功能"')
  })
})

describe('U-461 /graph 节点：可见标签必须在 accessible name 内', () => {
  it('未截断的标题：沿用「全名（分类）」，不重复念名字', () => {
    expect(nodeAccessibleName('Next.js', '开发基建')).toBe('Next.js（开发基建）')
    // 第三参数缺省时与旧行为一致（graph-keyboard.test.ts 的旧断言仍成立）
    expect(nodeAccessibleName('Next.js', '开发基建', 'Next.js')).toBe('Next.js（开发基建）')
  })

  it('截断的标题：可见标签（截断版）在 name 最前，再补全名与分类', () => {
    const title = 'UK AI Safety Institute'
    const label = truncateGraphLabel(title)
    expect(label).toBe('UK AI Safety In…')
    const name = nodeAccessibleName(title, 'AI 安全', label)
    expect(name.startsWith(label)).toBe(true)
    expect(name).toContain(title)
    expect(name).toContain('AI 安全')
  })

  it('图谱组件把截断后的可见标签传给 nodeAccessibleName', () => {
    const src = overlaySource('src/components/ecosystem-graph.tsx')
    expect(src).toContain('const label = truncateGraphLabel(n.title)')
    expect(src).toContain(
      'aria-label={nodeAccessibleName(n.title, CATEGORY_COLORS[n.category].name, label)}',
    )
  })

  it('装饰性文本加 aria-hidden：monogram 字母与 OS 徽标不再被读屏逐字念出', () => {
    const src = overlaySource('src/components/ecosystem-graph.tsx')
    // 每个 <text ...>...</text> 块单独检查，避免远处另一处的 aria-hidden 蒙混过关
    const textBlocks = src.match(/<text[\s\S]*?<\/text>/g) ?? []
    expect(textBlocks.length).toBeGreaterThan(0)
    const monogram = textBlocks.find((b) => b.includes('extractFaviconMonogram(n.title)'))
    expect(monogram, '找不到 monogram 文本块').toBeTruthy()
    expect(monogram).toContain('aria-hidden="true"')
    const osBadge = textBlocks.find((b) => b.includes('>OS</text>'))
    expect(osBadge, '找不到 OS 徽标文本块').toBeTruthy()
    expect(osBadge).toContain('aria-hidden="true"')
  })

  it('装饰性文本在按钮子树之外：按钮内可见文本只剩标签（否则 axe 仍报违规）', () => {
    const src = overlaySource('src/components/ecosystem-graph.tsx')
    const start = src.indexOf('{displayNodes.map((n) => {')
    expect(start, '找不到节点渲染层').toBeGreaterThan(-1)
    const end = src.indexOf('})}', start)
    expect(end).toBeGreaterThan(start)
    const layer = src.slice(start, end)
    // 按钮 <g> 内无嵌套 <g>，role="button" 之后第一个 </g> 就是按钮的闭标签
    const btnClose = layer.indexOf('</g>', layer.indexOf('role="button"'))
    expect(btnClose, '找不到按钮闭标签').toBeGreaterThan(0)
    const labelIdx = layer.indexOf('{label}')
    const monoIdx = layer.indexOf('extractFaviconMonogram(n.title)')
    const osIdx = layer.indexOf('>OS</text>')
    expect(labelIdx, '找不到标签文本').toBeGreaterThan(0)
    expect(labelIdx).toBeLessThan(btnClose) // 标签在按钮内
    expect(monoIdx, '找不到 monogram 文本').toBeGreaterThan(btnClose) // monogram 在按钮外
    expect(osIdx, '找不到 OS 徽标').toBeGreaterThan(btnClose) // OS 在按钮外
  })

  it('下方标签文本保持可见：它是 name 必须包含的文案，不能顺手隐藏', () => {
    const src = overlaySource('src/components/ecosystem-graph.tsx')
    const textBlocks = src.match(/<text[\s\S]*?<\/text>/g) ?? []
    const labelBlock = textBlocks.find((b) => b.includes('{label}'))
    expect(labelBlock, '找不到标签文本块').toBeTruthy()
    expect(labelBlock).not.toContain('aria-hidden')
  })
})
