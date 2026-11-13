/**
 * 空态 + 首次引导（研究 P0 #5）的回归测试。
 *
 * 仓库 vitest 是 node 环境、无 jsdom / Testing Library，组件无法挂载；
 * 因此分两层覆盖（与 skin-picker.test.ts 同款做法）：
 *  1. 纯函数真测：hotlist 全空判定 + 各空态文案（src/lib/empty-states）；
 *  2. 源码守卫：三个落点真的渲染了这份文案、主行动唯一且在前，
 *     而不是各写一份散文案、或把失败渲染成空。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DIY_EMPTY_COPY,
  FAVORITES_EMPTY_COPY,
  hotlistAllEmptyCopy,
  hotlistEmptyVariant,
  hotlistSourceEmptyCopy,
  type EmptyStateCopy,
  type HotlistEmptyInput,
} from '../src/lib/empty-states'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

function source(status: 'ok' | 'stale' | 'empty', itemCount: number) {
  return { status, items: Array.from({ length: itemCount }, (_, i) => ({ rank: i + 1 })) }
}

function hotlist(sources: Array<ReturnType<typeof source>>): HotlistEmptyInput {
  return { sources }
}

describe('hotlistEmptyVariant：空 ≠ 失败 ≠ 有内容', () => {
  it('中枢不可达（null）不是空态：失败走降级壳，绝不渲染「暂无」', () => {
    expect(hotlistEmptyVariant(null)).toBeNull()
  })

  it('全源从没抓过 → never-fetched（首访空白）', () => {
    expect(hotlistEmptyVariant(hotlist([source('empty', 0), source('empty', 0)]))).toBe('never-fetched')
  })

  it('源列表本身为空 → never-fetched（无物可展不是失败）', () => {
    expect(hotlistEmptyVariant(hotlist([]))).toBe('never-fetched')
  })

  it('任一源有条目 → 不是空态', () => {
    expect(hotlistEmptyVariant(hotlist([source('empty', 0), source('ok', 3)]))).toBeNull()
    expect(hotlistEmptyVariant(hotlist([source('ok', 1)]))).toBeNull()
  })

  it('全源 0 条目但抓取跑过且失败 → fetch-failed（失败不说成「没数据」）', () => {
    expect(hotlistEmptyVariant(hotlist([source('stale', 0), source('stale', 0)]))).toBe('fetch-failed')
    expect(hotlistEmptyVariant(hotlist([source('empty', 0), source('stale', 0)]))).toBe('fetch-failed')
  })

  it('条目说了算：状态写 empty 但真有条目 → 不是空态', () => {
    expect(hotlistEmptyVariant(hotlist([source('empty', 2)]))).toBeNull()
  })
})

describe('空态文案：What/Why/Next 齐全、有且只有一个主行动', () => {
  const copies: Array<{ name: string; copy: EmptyStateCopy }> = [
    { name: '收藏', copy: FAVORITES_EMPTY_COPY },
    { name: 'DIY', copy: DIY_EMPTY_COPY },
    { name: '热榜首访', copy: hotlistAllEmptyCopy('never-fetched') },
    { name: '热榜抓取失败', copy: hotlistAllEmptyCopy('fetch-failed') },
  ]

  it.each(copies)('$name：标题/原因/下一步/主行动都不为空', ({ copy }) => {
    expect(copy.title.trim()).not.toBe('')
    expect(copy.why.trim()).not.toBe('')
    expect(copy.next.trim()).not.toBe('')
    expect(copy.actionLabel.trim()).not.toBe('')
  })

  it('四个空态标题各不相同（不拿同一句「暂无数据」糊弄所有面）', () => {
    const titles = copies.map(({ copy }) => copy.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('链接型主行动都指向站内路径', () => {
    for (const { copy } of copies) {
      if (copy.actionHref === '') continue
      expect(copy.actionHref.startsWith('/')).toBe(true)
    }
    expect(FAVORITES_EMPTY_COPY.actionHref).toBe('/')
    expect(hotlistAllEmptyCopy('never-fetched').actionHref).toBe('/hot')
    expect(hotlistAllEmptyCopy('fetch-failed').actionHref).toBe('/hot')
  })

  it('DIY 主行动是回调不是链接：恢复默认布局一键成型', () => {
    expect(DIY_EMPTY_COPY.actionHref).toBe('')
    expect(DIY_EMPTY_COPY.actionLabel).toBe('恢复默认布局')
    expect(DIY_EMPTY_COPY.why).toContain('本机')
    expect(DIY_EMPTY_COPY.why).toContain('自动保存')
  })

  it('收藏空态的提示讲导入：在需要时刻出现，不做 tour', () => {
    expect(FAVORITES_EMPTY_COPY.tip).toContain('导入书签/MD')
    expect(FAVORITES_EMPTY_COPY.why).toContain('不用登录')
  })

  it('热榜首访文案讲清 cadence：每小时、第一轮', () => {
    const copy = hotlistAllEmptyCopy('never-fetched')
    expect(copy.why).toContain('每小时')
    expect(copy.why).toContain('第一轮')
    expect(copy.why).toContain('不是坏了')
  })

  it('热榜抓取失败文案不把失败说成「没数据」', () => {
    const copy = hotlistAllEmptyCopy('fetch-failed')
    expect(copy.why).toContain('失败')
    expect(copy.why).not.toContain('暂无数据')
    expect(copy.title).not.toContain('暂无')
    expect(copy.title).toContain('没能取回')
  })

  it('两种热榜空态共用同一个真实出口：/hot（站内榜永不空白）', () => {
    expect(hotlistAllEmptyCopy('never-fetched').actionLabel).toBe(
      hotlistAllEmptyCopy('fetch-failed').actionLabel,
    )
  })
})

describe('单源空体：为什么空 + 去源站的出口', () => {
  it('从没抓过 vs 抓取失败：原因文案不同', () => {
    const never = hotlistSourceEmptyCopy({ status: 'empty', name: '微博' })
    const failed = hotlistSourceEmptyCopy({ status: 'stale', name: '微博' })
    expect(never.why).not.toBe(failed.why)
    expect(never.why).toContain('首次抓取')
    expect(failed.why).toContain('没有旧缓存')
  })

  it('出口带源名、指向源站实时榜（不是回首页）', () => {
    const copy = hotlistSourceEmptyCopy({ status: 'empty', name: '微博' })
    expect(copy.actionLabel).toBe('去微博看实时热搜')
    expect(copy.actionLabel).toContain('微博')
  })
})

describe('落点守卫：三个面真的在用这份文案', () => {
  it('收藏页真空态用 FAVORITES_EMPTY_COPY（含导入提示），筛空分支 untouched', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain("import { FAVORITES_EMPTY_COPY } from '@/lib/empty-states'")
    expect(page).toContain('title={FAVORITES_EMPTY_COPY.title}')
    expect(page).toContain('FAVORITES_EMPTY_COPY.tip')
    expect(page).toContain('FAVORITES_EMPTY_COPY.actionLabel')
    expect(page).toContain('FAVORITES_EMPTY_COPY.actionHref')
    // 筛出来的空（收藏还在、只是没匹配到）仍走原分支，不许并进真空态
    expect(page).toContain('favoriteFilterEmptyMessage')
  })

  it('DIY 空画布走共享 EmptyState，主行动是恢复默认布局且排在最前', () => {
    const src = read('src/components/modular/modular-canvas.tsx')
    expect(src).toContain("import { EmptyState } from '@/components/ui/empty-state'")
    expect(src).toContain("import { DIY_EMPTY_COPY } from '@/lib/empty-states'")
    expect(src).toContain('title={DIY_EMPTY_COPY.title}')
    expect(src).toContain('DIY_EMPTY_COPY.actionLabel')
    // 旧的手写空盒与旧文案已退役
    expect(src).not.toContain('当前看板中没有小组件')
    expect(src).not.toContain('恢复默认模版')
    // 空分支内三按钮的顺序：恢复默认（主行动）在前，另两个在后
    const branchStart = src.indexOf('widgets.length === 0')
    const branchEnd = src.indexOf(') : (', branchStart)
    expect(branchStart).toBeGreaterThan(-1)
    expect(branchEnd).toBeGreaterThan(branchStart)
    const branch = src.slice(branchStart, branchEnd)
    expect(branch).toContain('onClick={resetToDefault}')
    expect(branch).toContain('setIsLibraryOpen(true)')
    expect(branch).toContain('setIsTemplateOpen(true)')
    expect(branch).toContain('套用预设模版')
    expect(branch.indexOf('onClick={resetToDefault}')).toBeLessThan(
      branch.indexOf('setIsLibraryOpen(true)'),
    )
    expect(branch.indexOf('setIsLibraryOpen(true)')).toBeLessThan(
      branch.indexOf('setIsTemplateOpen(true)'),
    )
  })

  it('简报页：全空时用 EmptyState 代替一排死盒子，单源空体有去源站的出口', () => {
    const page = read('src/app/brief/page.tsx')
    expect(page).toContain('hotlistEmptyVariant')
    expect(page).toContain('hotlistAllEmptyCopy')
    expect(page).toContain('hotlistSourceEmptyCopy')
    expect(page).toContain('hotlistEmptyVariant(hotlist)')
    expect(page).toContain('hotlistCopy ? (')
    // 裸「暂无条目」死盒子已退役
    expect(page).not.toContain('暂无条目')
    // 单源空体讲原因 + 给源站出口（文案字面在 lib 里，页里是接线）
    expect(page).toContain('hotlistSourceEmptyCopy(source).why')
    expect(page).toContain('hotlistSourceEmptyCopy(source).actionLabel')
    expect(page).toContain('safeHref(source.homeUrl)')
    // 非空时仍渲染源列（空态只代替全空，不吃掉正常榜单）
    expect(page).toContain('hotlist.sources.map')
  })

  it('文案模块写明「解释、不造假种子」的决定', () => {
    const lib = read('src/lib/empty-states.ts')
    expect(lib).toContain('解释，不造假种子')
    expect(lib).toContain('不拿空榜单')
    expect(lib).toContain('看实时热搜')
  })
})
