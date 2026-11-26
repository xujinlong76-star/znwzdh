/**
 * 每日简报页（/brief）与首页简报条的红线测试：
 *  - 热度格式化只做数量级换算，不改数值含义；无热度（null）不显示；
 *  - 页面外链一律过 safeHref（坏地址降级），未覆盖源必须带原因出场，
 *    中枢无数据时 metadata 走 noindex（不给搜索引擎空壳页）；
 *  - 首页简报条取不到简报时整条消失（返回 null），不许放占位假数据；
 *  - 在追提醒只走客户端岛带身份取数，SSR 壳里不出现任何用户数据。
 *  - 热榜每行都有站内搜入口（/search?q= 全标题编码、同页跳转），标题外链仍是主链路。
 * 真 SSR 直出由端到端实测（临时实例 + 真实缓存）覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatClock } from '../src/lib/server/brief'
import { formatHotValue } from '../src/lib/format-hot-value'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

describe('formatHotValue', () => {
  it('万级取整、亿级留一位小数', () => {
    expect(formatHotValue(11790321)).toContain('1179')
    expect(formatHotValue(11790321)).toContain('万')
    expect(formatHotValue(144732460)).toContain('亿')
  })
  it('小数值原样、无热度返回 null（调用方据此不渲染）', () => {
    expect(formatHotValue(999)).toBe('999')
    expect(formatHotValue(null)).toBeNull()
    expect(formatHotValue(undefined)).toBeNull()
    expect(formatHotValue(0)).toBeNull()
  })
})

describe('formatClock', () => {
  it('输出 HH:mm', () => {
    expect(formatClock(Date.UTC(2026, 10, 11, 1, 5))).toMatch(/^\d{2}:\d{2}$/)
  })

  it('U-396：按北京时间出 HH:mm——跑在 TZ=UTC 的容器上也不晚 8 小时', () => {
    // UTC 2026-11-11 01:05 = 北京时间 09:05；旧实现（getHours 本地时区）
    // 在 UTC 容器上会出 01:05，「生成于/更新于」全部晚 8 小时。
    expect(formatClock(Date.UTC(2026, 10, 11, 1, 5))).toBe('09:05')
    // 午夜边界：UTC 16:00 = 北京时间次日 00:00，出 00:00 不出 24:00。
    expect(formatClock(Date.UTC(2026, 10, 10, 16, 0))).toBe('00:00')
    // 北京时间 23:59（UTC 15:59）不跨日。
    expect(formatClock(Date.UTC(2026, 10, 11, 15, 59))).toBe('23:59')
    expect(formatClock(null)).toBeNull()
    expect(formatClock(NaN)).toBeNull()
    expect(formatClock(0)).toBeNull()
  })
})

describe('简报页源码守卫', () => {
  const page = read('src/app/brief/page.tsx')

  it('所有外链都过 safeHref，且带 noopener', () => {
    expect(page).toContain("import { safeHref } from '@/lib/safe-url'")
    expect(page).toContain('rel="noopener noreferrer"')
    // 不许出现未经 safeHref 的裸 href={...} 直绑外部地址变量
    expect(page).not.toMatch(/href=\{item\.url\}/)
    expect(page).not.toMatch(/href=\{pick\.url\}/)
  })

  it('未覆盖源带原因渲染，不静默缺席', () => {
    expect(page).toContain('uncovered')
    expect(page).toContain('u.reason')
  })

  it('无数据时 metadata noindex，页面给降级说明而不是报错', () => {
    expect(page).toContain('index: false')
    expect(page).toContain('简报暂时不可用')
  })

  it('在追提醒走客户端岛，SSR 不带用户数据', () => {
    expect(page).toContain('<BriefWatch />')
    const island = read('src/app/brief/brief-watch.tsx')
    expect(island).toContain("hubGet<HubBrief>('/api/brief/today')")
    expect(island).toContain('/me/watchlist')
  })

  it('新收录区分「今日新增」与「最近收录」，不许把旧站冒充今日', () => {
    expect(page).toContain("newSitesScope === 'today'")
    expect(page).toContain('最近收录')
  })
})

describe('热榜站内搜入口（升级第 7 条）', () => {
  const page = read('src/app/brief/page.tsx')
  const strip = read('src/components/home-brief-strip.tsx')
  // HotRow 函数体：从定义处起到下一个顶层函数为止，断言只针对这一行。
  const hotRow = page.slice(page.indexOf('function HotRow'), page.indexOf('function SourceColumn'))

  it('HotRow 每行都有站内搜入口：q 用全标题编码，不截断', () => {
    expect(page).toContain("import { ArrowRight, ExternalLink, Flame, MessageCircleQuestion, Newspaper, Search, Sparkles } from 'lucide-react'")
    expect(hotRow).toContain('href={`/search?q=${encodeURIComponent(item.title)}`}')
    expect(hotRow).toContain('aria-label={`站内搜「${item.title}」`}')
    // q 拼的是 item.title 本身，不是对截断后的副本编码
    expect(hotRow).not.toMatch(/encodeURIComponent\(item\.title\.(slice|substring|split)/)
  })

  it('站内搜是独立的 Next Link（同页跳转），不嵌进标题外链、不抢点击区', () => {
    expect(hotRow).toMatch(/<Link[^>]*href=\{`\/search\?q=/)
    // HotRow 里唯一的 target="_blank" 是标题直达原平台的那个 <a>；
    // 站内搜 Link 上没有任何 target 属性（Next Link 默认同页跳转）。
    expect(hotRow.match(/target="_blank"/g)?.length ?? 0).toBe(1)
    // 搜按钮出现在标题 </a> 之后，与标题链接并列，不嵌套
    //（不用“站内搜”三个字定位：函数头的注释里就有它；用 <Link> 本身定位）
    expect(hotRow.indexOf('</a>')).toBeGreaterThan(-1)
    expect(hotRow.indexOf('<Link')).toBeGreaterThan(hotRow.indexOf('</a>'))
    expect(hotRow.indexOf('aria-label={`站内搜')).toBeGreaterThan(hotRow.indexOf('</a>'))
    // 标题仍是外链主链路
    expect(hotRow).toContain('safeHref(item.url)')
  })

  it('首页简报条同款：更小一号、shrink-0，不挤占标题截断', () => {
    expect(strip).toContain("import { ArrowRight, Flame, Search } from 'lucide-react'")
    expect(strip).toContain('href={`/search?q=${encodeURIComponent(pick.title)}`}')
    expect(strip).toContain('aria-label={`站内搜「${pick.title}」`}')
    expect(strip).toMatch(/<Link[^>]*href=\{`\/search\?q=/)
    expect(strip).toContain('className="h-3 w-3"')
    expect(strip).toContain('shrink-0')
    // 标题仍是直达原平台的外链，搜按钮的 <Link> 在标题 </a> 之后
    expect(strip).toContain('safeHref(pick.url)')
    const titleClose = strip.indexOf('</a>')
    expect(titleClose).toBeGreaterThan(-1)
    expect(strip.indexOf('<Link', titleClose)).toBeGreaterThan(titleClose)
  })

  it('q 编码行为：特殊字符与斜杠都编进 q，标题全量可搜', () => {
    const href = `/search?q=${encodeURIComponent('AI 工具 & 活动/测试')}`
    expect(href).toBe('/search?q=AI%20%E5%B7%A5%E5%85%B7%20%26%20%E6%B4%BB%E5%8A%A8%2F%E6%B5%8B%E8%AF%95')
  })
})

describe('首页简报条守卫', () => {
  const strip = read('src/components/home-brief-strip.tsx')

  it('取不到或全空时返回 null 不渲染', () => {
    expect(strip).toContain('if (!brief) return null')
    expect(strip).toContain('return null')
  })

  it('只露出开场白与各源第一条并链到 /brief，外链过 safeHref', () => {
    expect(strip).toContain('href="/brief"')
    expect(strip).toContain('safeHref(pick.url)')
  })

  // U-358：简报条不再经服务端 todaySlots 注入——它只在「今日中心」小窗打开时才需要，
  // 现由 NavigationContent 以 dynamic(ssr:false) 按需加载（见 navigation-content.tsx 的
  // BriefStripContent），首页首屏不再为它付取数与 JS 体积；小窗未打开时正文上方无堆叠。
  it('首页简报条由导航中心 dynamic(ssr:false) 按需加载，不在首屏上方直接堆叠渲染', () => {
    const home = read('src/app/page.tsx')
    expect(home).not.toContain('HomeBriefStrip')
    expect(home).not.toContain('todaySlots')
    const nav = read('src/components/navigation-content.tsx')
    expect(nav).toContain("() => import('@/components/home-brief-strip')")
    expect(nav).toContain('{ ssr: false')
    expect(nav).toContain('briefContent={<BriefStripContent />}')
  })
})

describe('待读岛守卫', () => {
  it('/brief 在今日重温之后挂待读岛，SSR 壳本身不带用户数据', () => {
    const page = read('src/app/brief/page.tsx')
    expect(page).toContain('<BriefResurface />')
    expect(page).toContain('<BriefTriage />')
    expect(page.indexOf('<BriefTriage />')).toBeGreaterThan(page.indexOf('<BriefResurface />'))
    const island = read('src/app/brief/brief-triage.tsx')
    expect(island).toContain("'use client'")
    // 无内容时安静消失，不拿空盒子占版面：箱空、或箱里无 24h 内到期都消失
    expect(island).toContain('if (!favorites.ready || !settings.enabled || inboxCount === 0 || picks.length === 0) return null')
    // 岛只读本机收藏与分流偏好，不读服务端简报数据
    expect(island).not.toContain('@/lib/server/brief')
    // 文案方向写清：快过期的新收 vs 好久没翻的旧藏
    expect(island).toContain('快过期的新收')
    expect(island).toContain('好久没翻的旧藏')
  })

  it('待读行共用组件：标题即重开链接，续期/值得留/移出带无障碍标签', () => {
    const row = read('src/components/triage-inbox-row.tsx')
    expect(row).toContain('onReopen(item.siteId)')
    expect(row).toContain('aria-label={`续期')
    expect(row).toContain('aria-label={`把')
    expect(row).toContain('aria-label={`移出')
    expect(row).toContain('safeHref(item.href)')
    expect(row).toContain('min-h-11')
    // 快到期（剩余 ≤ 24h）徽标标红，与普通待读行视觉区分
    expect(row).toContain('msLeft <= DAY_MS')
    expect(row).toContain('bg-rose-500/10')
  })
})
