/**
 * /brief 热榜行「站内搜」按钮可点目标守卫（进化第 71 轮 F2）：
 *  - 按钮可点目标 ≥44×44px（min-h-11 min-w-11，WCAG 2.5.5 增强档；
 *    旧版只有图标 14px + p-1 = 22×22，手机端与标题外链只隔 4px，
 *    误点一次即跳外站新标签、回访流失）；
 *  - 按钮带可见「站内搜」文字（图标 + 文字，不再是纯图标）；
 *  - 标题外链行为一字不改（仍 target=_blank 直达原平台），站内搜仍是
 *    独立 <Link>、绝不嵌进标题 <a> 里；href、aria-label、title 语义不变；
 *  - 按钮仍 shrink-0，360px 行内不挤掉标题截断。
 * 行高代价：标题链 28px → 按钮 44px 主导，行高 +16px/行（见源码注释）。
 * 源码断言模式照 me-growth-panel-lazy-guard.test.ts / brief-page.test.ts。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

describe('/brief 站内搜按钮可点目标守卫（F2）', () => {
  const page = read('src/app/brief/page.tsx')
  // HotRow 函数体：从定义处起到下一个顶层函数为止，断言只针对这一行。
  const hotRow = page.slice(page.indexOf('function HotRow'), page.indexOf('function SourceColumn'))
  // 站内搜 <Link> 块：从 <Link 起到 </Link> 止。
  const linkBlock = hotRow.slice(hotRow.indexOf('<Link'), hotRow.indexOf('</Link>'))

  it('可点目标 ≥44×44：min-h-11 min-w-11，图标仍 14px', () => {
    expect(hotRow.indexOf('function HotRow')).toBeGreaterThan(-1)
    expect(linkBlock).toContain('min-h-11')
    expect(linkBlock).toContain('min-w-11')
    // 44px 是 Tailwind h-11/w-11（2.75rem）；图标本身不放大，只放大外框
    expect(linkBlock).toContain('className="h-3.5 w-3.5"')
    // 旧版 22×22 形态（p-1 + 纯图标）不得回潮
    expect(hotRow).not.toContain('rounded-md p-1 text-muted-foreground')
  })

  it('按钮带可见「站内搜」文字：图标 + 文字，文字用现有 token、不引新颜色', () => {
    expect(linkBlock).toContain('<span>站内搜</span>')
    expect(linkBlock).toContain('text-muted-foreground')
    expect(linkBlock).toContain('hover:text-link')
    expect(linkBlock).not.toContain('text-primary')
    expect(linkBlock).not.toContain('hover:text-primary')
  })

  it('站内搜仍是独立 <Link>：href/语义不变，不嵌进标题 <a>、不开新标签', () => {
    expect(linkBlock).toContain('href={`/search?q=${encodeURIComponent(item.title)}`}')
    expect(linkBlock).toContain('aria-label={`站内搜「${item.title}」`}')
    expect(linkBlock).toContain('title={`站内搜「${item.title}」`}')
    // Link 上无 target（Next Link 默认同页跳转）；HotRow 里唯一的
    // target="_blank" 是标题直达原平台的那个 <a>
    expect(linkBlock).not.toContain('target=')
    expect(hotRow.match(/target="_blank"/g)?.length ?? 0).toBe(1)
    // 搜按钮在标题 </a> 之后，与标题链接并列，不嵌套
    expect(hotRow.indexOf('</a>')).toBeGreaterThan(-1)
    expect(hotRow.indexOf('<Link')).toBeGreaterThan(hotRow.indexOf('</a>'))
    expect(hotRow.indexOf('</Link>')).toBeGreaterThan(hotRow.indexOf('</a>'))
    // 标题仍是外链主链路
    expect(hotRow).toContain('safeHref(item.url)')
    expect(hotRow).toContain('target="_blank"')
  })

  it('行内不溢出：按钮 shrink-0，标题仍可截断', () => {
    expect(linkBlock).toContain('shrink-0')
    expect(hotRow).toContain('min-w-0 flex-1')
    expect(hotRow).toContain('truncate')
  })
})
