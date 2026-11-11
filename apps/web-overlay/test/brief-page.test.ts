/**
 * 每日简报页（/brief）与首页简报条的红线测试：
 *  - 热度格式化只做数量级换算，不改数值含义；无热度（null）不显示；
 *  - 页面外链一律过 safeHref（坏地址降级），未覆盖源必须带原因出场，
 *    中枢无数据时 metadata 走 noindex（不给搜索引擎空壳页）；
 *  - 首页简报条取不到简报时整条消失（返回 null），不许放占位假数据；
 *  - 在追提醒只走客户端岛带身份取数，SSR 壳里不出现任何用户数据。
 * 真 SSR 直出由端到端实测（临时实例 + 真实缓存）覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatClock, formatHotValue } from '../src/lib/server/brief'

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

  it('首页在导航内容之前挂简报条', () => {
    const home = read('src/app/page.tsx')
    expect(home.indexOf('<HomeBriefStrip />')).toBeGreaterThan(-1)
    expect(home.indexOf('<HomeBriefStrip />')).toBeLessThan(home.indexOf('<NavigationContent'))
  })
})
