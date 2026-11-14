import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /drama 深色模式：专区页此前全页零 dark: 类名，深色模式下整块白底孤岛。
 *
 * 本文件钉住「每个写死的浅色表面/文字都有 dark: 对应变体」：
 * - 卡片面 bg-white → dark:bg-zinc-900、边框 border-zinc-200 → dark:border-zinc-800、
 *   次要文字 text-zinc-600/500 → dark:text-zinc-400、琥珀徽章/横幅 → dark:bg-amber-950/40 + dark:text-amber-200、
 *   「我的追剧」深色按钮 → dark:bg-zinc-100 + dark:text-zinc-900。
 * - 作用域只限 /drama 页真实渲染的两个文件（drama-content.tsx、
 *   drama-calendar-section.tsx）。首页影院区 home-drama-cinema.tsx 与
 *   分类页横幅 drama-category-banner.tsx 不在 /drama 页，不归这里管；
 *   骨架屏 drama-content-lazy.tsx 用语义 token bg-muted 已自带深色，
 *   WatchlistAddButton 自带 15 处 dark:，也不在这里重复断言。
 * - 标题 h1/h2/h3 无显式颜色、继承全局文字色，与站内其他页同口径，
 *   这里不强制要求 dark:。
 */

const CONTENT_SRC = join(import.meta.dirname, '..', 'src', 'components', 'drama-content.tsx')
const CALENDAR_SRC = join(import.meta.dirname, '..', 'src', 'components', 'drama-calendar-section.tsx')
const content = readFileSync(CONTENT_SRC, 'utf8')
const calendar = readFileSync(CALENDAR_SRC, 'utf8')

/** 含浅色 token 的每一行都必须在同一行带 dark: 变体，否则深色下就是白底/灰字孤岛。 */
function expectNoBareLightClasses(code: string, file: string) {
  const lines = code.split('\n')
  for (const [i, line] of lines.entries()) {
    if (line.includes('bg-white') && !line.includes('dark:bg-')) {
      throw new Error(`${file}:${i + 1} 有裸 bg-white：${line.trim()}`)
    }
    if (
      (line.includes('text-zinc-600') || line.includes('text-zinc-500') || line.includes('text-zinc-700')) &&
      !line.includes('dark:text-')
    ) {
      throw new Error(`${file}:${i + 1} 有裸 zinc 文字色：${line.trim()}`)
    }
    if ((line.includes('bg-amber-100') || line.includes('bg-amber-50')) && !line.includes('dark:bg-amber-')) {
      throw new Error(`${file}:${i + 1} 有裸琥珀背景：${line.trim()}`)
    }
    if (line.includes('border-zinc-200') && !line.includes('dark:border-')) {
      throw new Error(`${file}:${i + 1} 有裸 zinc-200 边框：${line.trim()}`)
    }
    if (line.includes('border-zinc-300') && !line.includes('dark:border-')) {
      throw new Error(`${file}:${i + 1} 有裸 zinc-300 边框：${line.trim()}`)
    }
  }
}

describe('/drama 深色模式：无裸浅色类', () => {
  it('drama-content.tsx 每处浅色表面/文字都有 dark: 变体', () => {
    expectNoBareLightClasses(content, 'drama-content.tsx')
  })

  it('drama-calendar-section.tsx 每处浅色表面/文字都有 dark: 变体', () => {
    expectNoBareLightClasses(calendar, 'drama-calendar-section.tsx')
  })
})

describe('/drama 深色模式：关键位置的 dark: 取值与站内主导模式一致', () => {
  it('平台卡与剧目卡：bg-white 配 dark:bg-zinc-900，边框 dark:border-zinc-800', () => {
    expect(content).toContain('border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900')
  })

  it('日历卡片与空态盒：同上，虚线边框 dark:border-zinc-700', () => {
    expect(calendar).toContain('border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900')
    expect(calendar).toContain('border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900')
  })

  it('「我的追剧」按钮深色下翻转为浅底深字', () => {
    expect(content).toContain('dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white')
  })

  it('琥珀徽章与过期横幅深色下用 amber-950/40 底 + amber-200 字', () => {
    expect(content).toContain('dark:bg-amber-950/40 dark:text-amber-200')
    expect(calendar).toContain('bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200')
  })

  it('两文件均有足够数量的 dark: 变体（防整段被删后只剩零星变体）', () => {
    expect(content.match(/dark:/g)?.length ?? 0).toBeGreaterThanOrEqual(14)
    expect(calendar.match(/dark:/g)?.length ?? 0).toBeGreaterThanOrEqual(16)
  })
})
