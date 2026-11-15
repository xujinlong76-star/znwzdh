/**
 * 价格数值字段接线守卫测试（Batch 4 Phase 2 P2-2）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 compare-page-guard.test.ts 同款说明），接线与渲染纪律走
 * 源码守卫体例；纯逻辑（归一化拾取、金额换算、robots 本机记忆）直接调
 * lib/compare.ts 的导出函数断言。
 *   - 价格行在 pricing 之后（COMPARE_DIMENSIONS 顺序即表内行顺序）；
 *   - stale 琥珀色“可能过期”徽标；expired 整格灰显 + “未验证”；
 *     无记录显“未验证”且有“填写价格”按钮；
 *   - 内联编辑：表单字段齐全（金额/货币/周期/免费档/官方 URL），提交调
 *     POST /api/sites/:id/price，成功后重拉 /api/compare 回填；
 *   - 抓取：按钮只在有 source_url 时启用，调 POST /price/scrape，
 *     候选点选预填表单、确认后才调 POST 写库（带服务端签发的 confirmToken，
 *     核对通过才写 official_scrape；客户端自称 sourceType 一律不认）；
 *   - 裸 ¥ 候选 currency 为空时不默认货币，须用户选货币才能提交。
 *   - robots 禁抓本机记忆键与 verify 的键分开。
 * 行为逻辑见服务端 price-api.test.ts 与 core site-comparison-price.test.ts。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  COMPARE_DIMENSIONS,
  isPriceRobotsDisallowedSite,
  normalizeComparisonItem,
  priceAmountToMinor,
  priceMinorToAmount,
  readPriceRobotsDisallowedSiteIds,
  rememberPriceRobotsDisallowedSiteId,
  COMPARE_PRICE_ROBOTS_KEY,
  type CompareNotesStore,
} from '../src/lib/compare'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const view = overlaySource('src/components/compare-view.tsx')
const compareLib = overlaySource('src/lib/compare.ts')

function memoryStore(): CompareNotesStore & { dump: () => Record<string, string> } {
  const data: Record<string, string> = {}
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
    dump: () => ({ ...data }),
  }
}

describe('价格行位置：pricing 之后第二行', () => {
  it('COMPARE_DIMENSIONS 里 price 紧跟 pricing', () => {
    const keys = COMPARE_DIMENSIONS.map((d) => d.key)
    expect(keys.indexOf('pricing')).toBe(0)
    expect(keys.indexOf('price')).toBe(1)
    expect(COMPARE_DIMENSIONS[1]).toEqual({ key: 'price', label: '价格（数值）' })
  })

  it('对照表按 COMPARE_DIMENSIONS 渲染行（源码守卫）', () => {
    expect(stripComments(view)).toContain('COMPARE_DIMENSIONS.map((dim)')
  })
})

describe('价格格渲染：stale 徽标 / expired 灰显 / 无记录未验证', () => {
  it('stale 加琥珀色“可能过期”徽标', () => {
    const code = stripComments(view)
    expect(code).toContain('可能过期')
    expect(code).toContain('bg-amber-500/10')
    expect(code).toContain('cell.stale === true')
  })

  it('expired（verified false 但有值）整格灰显 + “未验证”', () => {
    const code = stripComments(view)
    expect(code).toContain('opacity-60')
    expect(code).toContain("!cell.verified && hasValue")
  })

  it('无记录显“未验证”且有“填写价格”按钮', () => {
    const code = stripComments(view)
    expect(code).toContain('填写价格')
    expect(code).toContain("formatCellValue(cell) === '未验证'")
  })
})

describe('价格格内联编辑：表单字段与提交回填', () => {
  it('表单字段齐全：金额、货币下拉、周期下拉、免费档上限、官方定价页 URL', () => {
    const code = stripComments(view)
    expect(code).toContain('PRICE_CURRENCIES')
    expect(code).toContain('PRICE_PERIODS')
    expect(code).toContain('免费档上限')
    expect(code).toContain('官方定价页 URL')
    expect(code).toContain('保存价格')
  })

  it('提交调 POST /api/sites/:id/price，成功后重拉 /api/compare 回填', () => {
    const code = stripComments(view)
    expect(code).toContain("'/api/sites/' + encodeURIComponent(siteId) + '/price'")
    expect(code).toContain('fetchCompareItems(siteIds)')
    expect(code).toContain('setItems(reloaded)')
  })

  it('已填有“修改 / 删除”按钮', () => {
    const code = stripComments(view)
    expect(code).toContain('修改')
    expect(code).toContain('删除')
    expect(code).toContain('handleDeletePrice')
  })
})

describe('官方定价页抓取：只列候选，确认后才写库', () => {
  it('抓取按钮只在有 source_url 时启用，调 POST /price/scrape', () => {
    const code = stripComments(view)
    expect(code).toContain('从官方定价页抓取')
    expect(code).toContain("'/api/sites/' + encodeURIComponent(siteId) + '/price/scrape'")
    expect(code).toContain('!cell.sourceUrl')
    expect(code).toContain('handleScrapePrice')
  })

  it('候选点选预填表单、带 confirmToken 确认，确认后才调 POST 写库', () => {
    const code = stripComments(view)
    expect(code).toContain('handlePickPriceCandidate')
    // 新流程：点选只把服务端签发的一次性凭证存进表单 state，保存时随 POST 带上；
    // 旧流程的 setPriceFormSourceType('official_scrape') 已删除——客户端自称
    // 来源后端一律不认（无凭证一律写 manual），写库不再发 sourceType。
    expect(code).toContain('setPriceConfirmToken(candidate.confirmToken')
    expect(code).toContain('confirmToken: priceConfirmToken')
    expect(code).not.toContain("setPriceFormSourceType('official_scrape')")
    expect(code).not.toContain('setPriceFormSourceType')
    expect(code).not.toContain('sourceType:')
    expect(code).toContain('抓取本身不写库')
  })

  it('点选预填：amountMinor 为空时用原文金额 amount，不沿用表单旧值', () => {
    const code = stripComments(view)
    // 裸 ¥ 候选 amountMinor 为 null：预填金额取 candidate.amount（本位），
    // 货币已知且 amountMinor present 时才按 minor 回填；两种分支都不读旧值。
    expect(code).toContain('String(candidate.amount)')
    expect(code).toContain('candidate.amountMinor')
    expect(code).not.toContain('candidate.currency ?? prev.currency')
    expect(code).not.toContain('prev.amount')
  })

  it('robots 禁抓有独立的本机记忆键，与 verify 的键分开', () => {
    expect(COMPARE_PRICE_ROBOTS_KEY).toBe('navhub.price.robots-disallowed.v1')
    expect(compareLib).toContain('navhub.price.robots-disallowed.v1')
    expect(compareLib).toContain('navhub.verify.robots-disallowed.v1')
    expect(COMPARE_PRICE_ROBOTS_KEY).not.toBe('navhub.verify.robots-disallowed.v1')
  })

  it('robots 本机记忆读写与 verify 同模式', () => {
    const store = memoryStore()
    expect(isPriceRobotsDisallowedSite('site-x', store)).toBe(false)
    expect(readPriceRobotsDisallowedSiteIds(store)).toEqual([])
    const next = rememberPriceRobotsDisallowedSiteId('site-x', store)
    expect(next).toEqual(['site-x'])
    expect(isPriceRobotsDisallowedSite('site-x', store)).toBe(true)
    expect(readPriceRobotsDisallowedSiteIds(store)).toEqual(['site-x'])
    // 重复记忆不重复追加
    expect(rememberPriceRobotsDisallowedSiteId('site-x', store)).toEqual(['site-x'])
  })
})

describe('抓取候选类型：与后端 PriceScrapeCandidate 同形', () => {
  it('PriceScrapeCandidate 带 amount 与 confirmToken（与后端同形）', () => {
    const lib = stripComments(compareLib)
    expect(lib).toContain('export interface PriceScrapeCandidate')
    expect(lib).toContain('amount: number | null')
    expect(lib).toContain('amountMinor: number | null')
    expect(lib).toContain('currency: string | null')
    expect(lib).toContain('period: string | null')
    expect(lib).toContain('confirmToken: string | null')
  })
})

describe('裸 ¥ 候选：currency 为空时强制选货币，不默认回旧值或 CNY', () => {
  it('点选时 currency 留空：不回 prev.currency、不回 CNY', () => {
    const code = stripComments(view)
    expect(code).toContain("currency: candidate.currency ?? ''")
    expect(code).not.toContain('candidate.currency ?? prev.currency')
    expect(code).not.toContain("candidate.currency ?? 'CNY'")
  })

  it('表单校验 + 可见提示：未选货币时确认按钮不可提交', () => {
    const code = stripComments(view)
    // 下拉带“请选择货币”空选项，货币为空时表单上方出可见提示，
    // 保存按钮 disabled，提交入口先拦货币再算金额。
    expect(code).toContain('请选择货币')
    expect(code).toContain('货币未定')
    expect(code).toContain('请先选择货币')
    expect(code).toContain('disabled={Boolean(savingPriceIds[item.siteId]) || !priceForm.currency}')
    expect(code).toContain('PRICE_CURRENCIES.some((c) => c.value === priceForm.currency)')
  })

  it('裸 ¥ 金额按用户选定的货币换算：JPY 不乘 100', () => {
    // 换算本身走 priceAmountToMinor：amount 预填为原文金额（本位），
    // 用户选 JPY 后保存时按 JPY 口径算 minor，不乘 100。
    expect(priceAmountToMinor('500', 'JPY')).toBe(500)
    expect(priceAmountToMinor('500', 'CNY')).toBe(50000)
    expect(priceMinorToAmount(500, 'JPY')).toBe('500')
  })
})

describe('归一化：price 格逐键拾取（含 stale / sourceUrl / 回填字段）', () => {
  it('normalizeComparisonItem 拾取 price 格的 stale、sourceUrl 与回填字段', () => {
    const item = normalizeComparisonItem({
      siteId: 'site-a',
      title: '甲工具',
      url: 'https://a.example.com',
      price: {
        value: '¥19.9/月',
        source: '手工填写',
        verified: true,
        verifiedAt: 123,
        stale: true,
        sourceUrl: 'https://a.example.com/pricing',
        amountMinor: 1990,
        currency: 'CNY',
        period: 'month',
        freeTierLimit: '100次/月',
      },
    })
    expect(item?.price).toMatchObject({
      value: '¥19.9/月',
      verified: true,
      stale: true,
      sourceUrl: 'https://a.example.com/pricing',
      amountMinor: 1990,
      currency: 'CNY',
      period: 'month',
      freeTierLimit: '100次/月',
    })
  })

  it('缺 price 键落“未验证”格，不抛错', () => {
    const item = normalizeComparisonItem({ siteId: 'site-a', title: '甲', url: 'https://a.example.com' })
    expect(item?.price).toMatchObject({ value: null, verified: false, verifiedAt: null })
  })
})

describe('金额换算：表单本位 ↔ 最小货币单位', () => {
  it('19.9 CNY → 1990；20 → 2000；非法/非正/超大 → null', () => {
    expect(priceAmountToMinor('19.9', 'CNY')).toBe(1990)
    expect(priceAmountToMinor('20', 'CNY')).toBe(2000)
    expect(priceAmountToMinor('0', 'CNY')).toBeNull()
    expect(priceAmountToMinor('-5', 'CNY')).toBeNull()
    expect(priceAmountToMinor('abc', 'CNY')).toBeNull()
    expect(priceAmountToMinor('99999999.99', 'CNY')).toBeNull()
  })

  it('JPY/KRW 不乘 100：500 → 500', () => {
    expect(priceAmountToMinor('500', 'JPY')).toBe(500)
    expect(priceAmountToMinor('9900', 'KRW')).toBe(9900)
    expect(priceMinorToAmount(500, 'JPY')).toBe('500')
  })

  it('回填：1990 → 19.9，2000 → 20', () => {
    expect(priceMinorToAmount(1990, 'CNY')).toBe('19.9')
    expect(priceMinorToAmount(2000, 'CNY')).toBe('20')
  })
})
