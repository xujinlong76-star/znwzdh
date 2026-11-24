/**
 * 官网卡片判定与装配（lib/official-card-rank）的定向测试。
 *
 * 验收（品牌认官网第二步 W1，2026-11-24）：
 *  1. 查询命中 50 家之一 → 有卡：品牌、官网地址（https:// + 规范域名）、
 *     站内条目入口（主机与规范域名一致时才有）；
 *  2. 含糊 / 多义 / 无命中 → 无卡，宁可不显示也不错认；
 *  3. 仿冒域名绝不进结果：子域、后缀包含一律不算站内条目；
 *  4. 失败态与翻页不重复出卡；零命中时卡片照常展示（品牌已核实、
 *     站内未收录也不影响卡片本身）。
 *
 * 只测纯函数，不渲染组件、不调后端、不记搜索。
 */
import { describe, expect, it } from 'vitest'

import type { HubSearchHit } from '../src/lib/navhub-api'
import {
  findOfficialSiteEntry,
  officialUrlForBrand,
  resolveOfficialCard,
  type OfficialCardSiteEntry,
} from '../src/lib/official-card-rank'
import { VERIFIED_BRANDS } from '../src/lib/verified-brands'

function hit(siteId: string, title: string, url: string): HubSearchHit {
  return {
    siteId,
    score: 0.05,
    contributions: { exact: { rank: 1, value: 0.05 } },
    site: {
      id: siteId,
      title,
      url,
      status: 'active',
    } as unknown as HubSearchHit['site'],
  }
}

function github(): HubSearchHit {
  return hit('site-github', 'GitHub', 'https://github.com')
}

describe('official-card-rank：命中 50 家之一 → 有卡', () => {
  it('精确命中 "GitHub"：品牌 + 官网地址，零命中时站内入口为空但卡片仍在', () => {
    const card = resolveOfficialCard({ query: 'GitHub', page: 1, failed: false, hits: [] })
    expect(card?.brand.name).toBe('GitHub')
    expect(card?.officialUrl).toBe('https://github.com')
    expect(card?.siteEntry).toBeNull()
  })

  it('别名与大小写不敏感："github" / "豆包" / "b站" 都命中', () => {
    expect(resolveOfficialCard({ query: 'github', page: 1, failed: false, hits: [] })?.brand.name).toBe('GitHub')
    expect(resolveOfficialCard({ query: '豆包', page: 1, failed: false, hits: [] })?.brand.name).toBe('豆包')
    expect(resolveOfficialCard({ query: 'b站', page: 1, failed: false, hits: [] })?.brand.name).toBe('哔哩哔哩')
  })

  it('规范域名带 www 的品牌官网地址保留 www：Kimi → https://www.kimi.com', () => {
    const card = resolveOfficialCard({ query: 'Kimi', page: 1, failed: false, hits: [] })
    expect(card?.officialUrl).toBe('https://www.kimi.com')
    expect(card?.brand.canonicalDomain).toBe('www.kimi.com')
  })

  it('纠正后的查询跟结果走："githb" 纠正为 "github" → 有卡', () => {
    const card = resolveOfficialCard({
      query: 'githb',
      correctedQuery: 'github',
      page: 1,
      failed: false,
      hits: [github()],
    })
    expect(card?.brand.name).toBe('GitHub')
    expect(card?.siteEntry).toEqual({ id: 'site-github', title: 'GitHub' } satisfies OfficialCardSiteEntry)
  })
})

describe('official-card-rank：含糊 / 多义 / 无命中 → 无卡', () => {
  it('"zzzz不存在的站"：无命中，不显示', () => {
    expect(resolveOfficialCard({ query: 'zzzz不存在的站', page: 1, failed: false, hits: [] })).toBeNull()
  })

  it('"中国"：同时含糊命中中国政府网与中国知网，多义，不显示', () => {
    expect(resolveOfficialCard({ query: '中国', page: 1, failed: false, hits: [] })).toBeNull()
  })

  it('空查询不显示', () => {
    expect(resolveOfficialCard({ query: '', page: 1, failed: false, hits: [] })).toBeNull()
    expect(resolveOfficialCard({ query: '   ', page: 1, failed: false, hits: [] })).toBeNull()
  })

  it('纠正后仍未命中 50 家 → 无卡（"githx" 不是任何品牌名/别名的子串）', () => {
    expect(
      resolveOfficialCard({ query: 'githb', correctedQuery: 'githx', page: 1, failed: false, hits: [] }),
    ).toBeNull()
  })
})

describe('official-card-rank：失败态与翻页不重复出卡', () => {
  it('检索服务没响应（failed）时不渲染卡片', () => {
    expect(resolveOfficialCard({ query: 'GitHub', page: 1, failed: true, hits: [github()] })).toBeNull()
  })

  it('第 2 页不再重复出卡', () => {
    expect(resolveOfficialCard({ query: 'GitHub', page: 2, failed: false, hits: [github()] })).toBeNull()
  })
})

describe('official-card-rank：站内条目入口只认规范域名主机', () => {
  it('正常结果里主机一致 → 给站内入口（链 /site/{id}，官网链接仍是规范域名）', () => {
    const card = resolveOfficialCard({ query: 'GitHub', page: 1, failed: false, hits: [github()] })
    expect(card?.siteEntry).toEqual({ id: 'site-github', title: 'GitHub' })
    expect(card?.officialUrl).toBe('https://github.com')
  })

  it('www. 前缀差异不计：站内 URL 是裸域 figma.com，规范域名 www.figma.com，仍认', () => {
    const brand = VERIFIED_BRANDS.find((b) => b.name === 'Figma')!
    expect(
      findOfficialSiteEntry(brand, [hit('site-figma', 'Figma', 'https://figma.com')]),
    ).toEqual({ id: 'site-figma', title: 'Figma' })
  })

  it('巡检打不开分区里的条目也能给入口（401/403 反爬的大站）', () => {
    const card = resolveOfficialCard({ query: 'GitHub', page: 1, failed: false, hits: [], unavailable: [github()] })
    expect(card?.siteEntry).toEqual({ id: 'site-github', title: 'GitHub' })
  })

  it('子域不算：chat.deepseek.com 不是 deepseek.com 的站内条目', () => {
    const brand = VERIFIED_BRANDS.find((b) => b.name === 'DeepSeek')!
    expect(
      findOfficialSiteEntry(brand, [hit('site-deepseek-chat', 'DeepSeek Chat', 'https://chat.deepseek.com')]),
    ).toBeNull()
  })

  it('仿冒域名绝不进结果：github.com.evil.com 不算 GitHub 条目', () => {
    const brand = VERIFIED_BRANDS.find((b) => b.name === 'GitHub')!
    expect(
      findOfficialSiteEntry(brand, [hit('site-evil', 'GitHub', 'https://github.com.evil.com')]),
    ).toBeNull()
  })

  it('非法 URL 不算条目、不抛错', () => {
    const brand = VERIFIED_BRANDS.find((b) => b.name === 'GitHub')!
    expect(findOfficialSiteEntry(brand, [hit('site-bad', 'GitHub', 'not a url')])).toBeNull()
  })
})

describe('official-card-rank：官网地址只认规范域名', () => {
  it('50 家全有 https:// + 规范域名，不拼 site.url', () => {
    for (const brand of VERIFIED_BRANDS) {
      expect(officialUrlForBrand(brand)).toBe(`https://${brand.canonicalDomain}`)
    }
    expect(VERIFIED_BRANDS).toHaveLength(50)
  })
})
