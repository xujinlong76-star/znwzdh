/**
 * 首页「今日」小部件测试（进化轮 2026-11-22-0822，规格书 today-widget-spec-0422.md §10）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom（见 handoff-card.test.ts 同款说明），
 * 换一换的点击交互测不了挂载——轮换循环走纯函数 nextHotIndex 单测；
 * 组件首屏输出走 react-dom/server 的 renderToStaticMarkup 真渲染
 *（前例见 empty-states.test.ts / exam-guokao-checklist-u285.test.ts）。
 *
 * 日期断言全部按 Asia/Shanghai 口径：nowMs 取 UTC 午夜（= 北京时间 08:00），
 * 断言与运行期 TZ 无关（shanghaiNoonDate 把上海日期拼成本地中午再算农历）。
 * 2027-02-06 精确校正断言只在东八区跑（lunar-date.test.ts 同款 skipIf）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatLunarDate, formatLunarDateExact } from '../src/lib/lunar-date'
import {
  buildTodayDateText,
  formatTodayGregorian,
  getZodiacSign,
  nextHotIndex,
  shanghaiDateParts,
  shanghaiNoonDate,
  type TodayHotItem,
} from '../src/lib/today-widget'
import { HomeTodayWidget } from '../src/components/home-today-widget'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-22 00:00 UTC = 北京时间 2026-11-22 08:00（周日）。 */
const NOV_22_2026 = Date.UTC(2026, 10, 22, 0, 0, 0)
const IN_PLUS_8 = new Date().getTimezoneOffset() === -480

function fakeSite(title: string, url: string): TodayHotItem {
  return { title, url }
}

function renderWidget(props: { nowMs?: number; trendingSites?: TodayHotItem[] | null; onOpenTodayCenter?: () => void }) {
  return renderToStaticMarkup(createElement(HomeTodayWidget, props))
}

describe('今日小部件纯函数（today-widget.ts）', () => {
  it('公历按 Asia/Shanghai 口径：2026-11-22 → 2026年11月22日 星期日', () => {
    expect(formatTodayGregorian(new Date(NOV_22_2026))).toBe('2026年11月22日 星期日')
    // 同一上海日、不同 UTC 时刻（11-21 16:00 UTC = 11-22 00:00 CST）结果相同。
    expect(formatTodayGregorian(new Date(Date.UTC(2026, 10, 21, 16, 0, 0)))).toBe('2026年11月22日 星期日')
  })

  it('上海年月日取数：2026-11-22 08:00 CST → 11月22日', () => {
    expect(shanghaiDateParts(new Date(NOV_22_2026))).toEqual({ year: 2026, month: 11, day: 22, weekday: '星期日' })
  })

  it('星座边界按通用表：11.22 天蝎、11.23 射手、12.21 射手、12.22 摩羯', () => {
    expect(getZodiacSign(11, 22)).toBe('天蝎座')
    expect(getZodiacSign(11, 23)).toBe('射手座')
    expect(getZodiacSign(12, 21)).toBe('射手座')
    expect(getZodiacSign(12, 22)).toBe('摩羯座')
  })

  it('星座另抽 3 个跨月边界：1.19 摩羯 / 1.20 水瓶、3.20 双鱼 / 3.21 白羊', () => {
    expect(getZodiacSign(1, 19)).toBe('摩羯座')
    expect(getZodiacSign(1, 20)).toBe('水瓶座')
    expect(getZodiacSign(3, 20)).toBe('双鱼座')
    expect(getZodiacSign(3, 21)).toBe('白羊座')
  })

  it('换一换循环：30 条 (i+1)%30，末尾回 0；空榜单回 0 不抛错', () => {
    expect(nextHotIndex(0, 30)).toBe(1)
    expect(nextHotIndex(29, 30)).toBe(0)
    expect(nextHotIndex(28, 30)).toBe(29)
    expect(nextHotIndex(0, 1)).toBe(0)
    expect(nextHotIndex(0, 0)).toBe(0)
    expect(nextHotIndex(5, 0)).toBe(0)
  })

  it('日期文案拼接：公历 · 农历 · 星座；农历为空时省略该段、不写假农历', () => {
    expect(buildTodayDateText(new Date(NOV_22_2026), '农历十月十四')).toBe(
      '2026年11月22日 星期日 · 农历十月十四 · 天蝎座',
    )
    expect(buildTodayDateText(new Date(NOV_22_2026), '')).toBe('2026年11月22日 星期日 · 天蝎座')
  })
})

describe('农历复用（lunar-date.ts 原样输出，节日字面串以 lib 为准）', () => {
  it('2026-11-22 → 农历十月十四（官方口径）', () => {
    expect(formatLunarDate(shanghaiNoonDate(new Date(NOV_22_2026)))).toBe('农历十月十四')
  })

  it('春节日含 · 春节：2026-02-17 正月初一', () => {
    expect(formatLunarDate(shanghaiNoonDate(new Date(Date.UTC(2026, 1, 17, 0, 0, 0))))).toBe('农历正月初一 · 春节')
  })

  it('元宵节日字面串带「节」字：2026-03-03 正月十五 → 农历正月十五 · 元宵节', () => {
    expect(formatLunarDate(shanghaiNoonDate(new Date(Date.UTC(2026, 2, 3, 0, 0, 0))))).toBe('农历正月十五 · 元宵节')
  })

  it('闰月日含「闰」字：2025-08-10 在闰六月内', () => {
    expect(formatLunarDate(shanghaiNoonDate(new Date(Date.UTC(2025, 7, 10, 0, 0, 0))))).toContain('闰')
  })

  it('除夕判定：2026-02-16（次日正月初一）含 · 除夕', () => {
    expect(formatLunarDate(shanghaiNoonDate(new Date(Date.UTC(2026, 1, 16, 0, 0, 0))))).toContain('· 除夕')
  })

  it.skipIf(!IN_PLUS_8)('2027-02-06 精确校正：东八区走 lunar-javascript 源 → 正月初一 · 春节', async () => {
    // 同步 Intl 源在 2027-02-06~03-07 整月差一天（lunar-date.ts 文件头已登记）；
    // 校正路径须修回官方口径。非东八区时 formatLunarDateExact 回退 Intl 源，本断言跳过。
    const exact = await formatLunarDateExact(shanghaiNoonDate(new Date(Date.UTC(2027, 1, 6, 0, 0, 0))))
    expect(exact).toBe('农历正月初一 · 春节')
  })
})

describe('今日小部件真渲染（renderToStaticMarkup）', () => {
  const sites = Array.from({ length: 30 }, (_, i) => fakeSite(`热点站${i + 1}`, `https://example.com/${i + 1}`))

  it('首屏一眼看到：公历 + 星期 + 农历 + 星座 + 首条热点', () => {
    const html = renderWidget({ nowMs: NOV_22_2026, trendingSites: sites, onOpenTodayCenter: () => {} })
    expect(html).toContain('2026年11月22日 星期日 · 农历十月十四 · 天蝎座')
    expect(html).toContain('热点站1')
    expect(html).toContain('换一换')
    expect(html).toContain('热榜')
  })

  it('日期段是按钮（aria-haspopup=dialog），热点标题是新窗口外链', () => {
    const html = renderWidget({ nowMs: NOV_22_2026, trendingSites: sites, onOpenTodayCenter: () => {} })
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('href="https://example.com/1"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('（新窗口打开）')
    expect(html).toContain('href="/hot"')
  })

  it('空榜单降级：热点行消失、只留日期段与热榜入口，页面不抛错', () => {
    const html = renderWidget({ nowMs: NOV_22_2026, trendingSites: [], onOpenTodayCenter: () => {} })
    expect(html).toContain('2026年11月22日 星期日 · 农历十月十四 · 天蝎座')
    expect(html).not.toContain('换一换')
    expect(html).not.toContain('热点站')
    expect(html).toContain('href="/hot"')
  })

  it('取数失败降级：trendingSites 为 null 时与空榜单一致', () => {
    const html = renderWidget({ nowMs: NOV_22_2026, trendingSites: null, onOpenTodayCenter: () => {} })
    expect(html).toContain('2026年11月22日 星期日')
    expect(html).not.toContain('换一换')
    expect(html).toContain('href="/hot"')
  })

  it('无 URL 的条目不渲染为 <a>：只剩热榜一个链接', () => {
    const html = renderWidget({
      nowMs: NOV_22_2026,
      trendingSites: [fakeSite('无链站', '')],
      onOpenTodayCenter: () => {},
    })
    expect(html).toContain('无链站')
    expect(html.match(/<a /g)?.length ?? 0).toBe(1)
    expect(html).toContain('href="/hot"')
  })

  it('单条时仍显示同一条（换一换不越界由 nextHotIndex 保证，见纯函数组）', () => {
    const html = renderWidget({
      nowMs: NOV_22_2026,
      trendingSites: [fakeSite('唯一热点', 'https://example.com/only')],
      onOpenTodayCenter: () => {},
    })
    expect(html).toContain('唯一热点')
    expect(html).toContain('href="https://example.com/only"')
  })
})

describe('今日小部件源码守卫（接线与预算）', () => {
  const widget = read('src/components/home-today-widget.tsx')
  const nav = read('src/components/navigation-content.tsx')
  const homePage = read('src/app/page.tsx')

  it('不引入新依赖、不静态 import lunar-javascript（304KB 不进首屏包）', () => {
    // 注释里会提到 lunar-javascript（说明校正路径），断言去注释后才有效——
    // 守的是「代码真的 import 了」，不是「注释里提到了」（handoff-card.test.ts 同款手法）。
    const code = widget.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    expect(code).not.toContain('lunar-javascript')
    expect(widget).not.toContain("from 'lunar-javascript'")
  })

  it('客户端零新增请求、无定时器无自动轮播：无 fetch、无 setInterval/setTimeout', () => {
    expect(widget).not.toContain('fetch(')
    expect(widget).not.toContain('setInterval')
    expect(widget).not.toContain('setTimeout')
  })

  it('热点轮换只用已下发数据：换一换走 nextHotIndex，链接走 safeHref + 新窗口', () => {
    expect(widget).toContain('nextHotIndex(')
    expect(widget).toContain('safeHref(')
    expect(widget).toContain('target="_blank"')
    expect(widget).toContain('aria-label="换一条热点"')
    expect(widget).toContain('aria-live="polite"')
  })

  it('水合校正沿用 clock-widget 模式：formatLunarDateExact + 东八区守卫', () => {
    expect(widget).toContain('formatLunarDateExact(')
    expect(widget).toContain('formatLunarDate(')
  })

  it('落点：胶囊行之后、分类网格之前，只在非工作台模式渲染', () => {
    expect(nav).toContain("from '@/components/home-today-widget'")
    expect(nav).toContain('<HomeTodayWidget')
    const widgetAt = nav.indexOf('<HomeTodayWidget')
    expect(widgetAt).toBeGreaterThan(nav.indexOf('HomeCapsuleRow'))
    // 注意：'DiyGridDragBoundary' 首次出现是文件顶部同名函数定义（:88），不是渲染落点；
    // 落点比较须用渲染用法 '<DiyGridDragBoundary'。
    expect(widgetAt).toBeLessThan(nav.indexOf('<DiyGridDragBoundary'))
    // 注意：插入块是多行 JSX（{viewMode !== 'workbench' && (\n    //   <HomeTodayWidget … />\n    // )}），单行拼接串匹配不到；改为门控唯一出现 + 顺序断言。
    expect(nav.match(/viewMode !== 'workbench' && \(/g)?.length ?? 0).toBe(1)
    expect(widgetAt).toBeGreaterThan(nav.indexOf("viewMode !== 'workbench' && ("))
    expect(widgetAt).toBeLessThan(nav.indexOf("viewMode !== 'workbench' && (") + 300)
  })

  it('首页服务端与 /hot 同口径取飙升榜：Promise.all 里加 trending?limit=30（60s 缓存）', () => {
    expect(homePage).toContain("'/api/rank/trending?limit=30'")
    expect(homePage).toContain('trendingSites={')
  })

  it('下发形状最小化：服务端把 HubSite 投影为 {title, url} 再下发（HTML 增量 <5KB 预算）', () => {
    expect(homePage).toContain('.map((s) => ({ title: s.title, url: s.url }))')
    expect(widget).toContain('TodayHotItem')
  })
})
