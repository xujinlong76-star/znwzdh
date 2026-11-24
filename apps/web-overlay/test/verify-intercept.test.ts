/**
 * 品牌认官网第二步 W6：拦截链测试（守卫判定 → /verify → 两出口）。
 *
 * 本文件只测「链」，不重复 W4/W2 已有的单元矩阵：
 *  - 守卫判定矩阵（isOfficialHost / classifyOutboundUrl 全量用例）见
 *    test/lookalike-guard.test.ts（W4）；本文件只抽与拦截接线有关的
 *    判定，并把 lookalike 的结果一路带进 /verify 再带回两出口。
 *  - 比对页纯函数（normalizeDomain / diffDomains / parseVerifyParams）
 *    与页面源码守卫（两出口文案、无自动跳转、诚实口径）见
 *    test/verify-page.test.ts（W2）；本文件只测「守卫输出 → 比对页
 *    输入 → 两出口目标」这一段 round-trip。
 *
 * 接线约定（见 src/lib/lookalike-guard.ts 文件头）：
 *  - lookalike 时改跳 /verify?brand=<规范域名>&domain=<host>；
 *  - official / unknown 原样放行，不进比对页。
 * classifyOutboundUrl 只接受绝对 http(s) URL（裸域名、相对路径、
 * 非 http(s) 一律 unknown 且 host 为 ''），调用方必须传完整 URL。
 *
 * 体例：vitest + 相对路径 import；源码守卫先去注释再断言。
 * 无真实网络请求、无真实 key。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  classifyOutboundUrl,
  isOfficialHost,
  type OutboundClassification,
} from '../src/lib/lookalike-guard'
import { getVerifiedBrandByDomain } from '../src/lib/verified-brands'
import { parseVerifyParams } from '../src/app/verify/domain-diff'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

/** 去注释：源码守卫只看代码，不让注释里的词干扰断言。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * 拦截接线：lookalike 才建比对页 URL，其余原样放行（返回 null）。
 * 格式即 lookalike-guard.ts 文件头约定的
 * /verify?brand=<规范域名>&domain=<host>。
 */
function buildInterceptUrl(c: OutboundClassification): string | null {
  if (c.verdict !== 'lookalike' || !c.brand) return null
  return `/verify?brand=${c.brand.canonicalDomain}&domain=${c.host}`
}

/** 把拦截 URL 拆回参数，再走真实的 parseVerifyParams。 */
function parseInterceptUrl(interceptUrl: string) {
  const u = new URL(interceptUrl, 'https://navhub.local')
  return parseVerifyParams(u.searchParams.get('brand'), u.searchParams.get('domain'))
}

describe('接线前提：规范域名只精确匹配，官方入口才要守卫另认', () => {
  it('getVerifiedBrandByDomain 是精确匹配：子域不算官方', () => {
    expect(getVerifiedBrandByDomain('deepseek.com')?.name).toBe('DeepSeek')
    // chat.deepseek.com 是备注确认的官方入口，但它不是规范域名本身：
    // 这张表认不出它，所以守卫必须另有一份已确认入口（否则会误拦）。
    expect(getVerifiedBrandByDomain('chat.deepseek.com')).toBeNull()
    expect(getVerifiedBrandByDomain('chatgpt-cn.com')).toBeNull()
  })

  it('守卫补上了这份入口：chat.deepseek.com 是 official，不是 lookalike', () => {
    const c = classifyOutboundUrl('https://chat.deepseek.com')
    expect(c.verdict).toBe('official')
    expect(c.brand?.name).toBe('DeepSeek')
    expect(c.host).toBe('chat.deepseek.com')
    expect(buildInterceptUrl(c)).toBeNull()
  })
})

describe('守卫判定 → 是否拦截（抽查，矩阵见 W4）', () => {
  it('official 原样放行，不进比对页', () => {
    for (const url of [
      'https://chatgpt.com',
      'https://chat.deepseek.com',
      'https://www.kimi.com',
      'https://github.com/features/copilot',
      'https://figma.com',
    ]) {
      const c = classifyOutboundUrl(url)
      expect(c.verdict, url).toBe('official')
      expect(c.brand, url).not.toBeNull()
      expect(buildInterceptUrl(c), url).toBeNull()
    }
  })

  it('lookalike 才拦截：判定带品牌，拦截 URL 拼规范域名 + 用户点的 host', () => {
    const cases = [
      { url: 'https://chatgpt-cn.com', brand: 'ChatGPT', host: 'chatgpt-cn.com' },
      { url: 'https://deepseek-official.com', brand: 'DeepSeek', host: 'deepseek-official.com' },
      { url: 'https://deepseek.net', brand: 'DeepSeek', host: 'deepseek.net' },
      { url: 'https://alipay.com.cn', brand: '支付宝', host: 'alipay.com.cn' },
      { url: 'https://weixin-qq.com', brand: '微信', host: 'weixin-qq.com' },
    ] as const
    for (const { url, brand, host } of cases) {
      const c = classifyOutboundUrl(url)
      expect(c.verdict, url).toBe('lookalike')
      expect(c.brand?.name, url).toBe(brand)
      expect(c.host, url).toBe(host)
      expect(buildInterceptUrl(c), url).toBe(
        `/verify?brand=${c.brand?.canonicalDomain}&domain=${host}`,
      )
    }
  })

  it('unknown 原样放行：无关域与拿不准的都不拦截', () => {
    for (const url of [
      'https://example.com',
      'https://chat.com',
      'https://chatgpot.com',
      'https://nodebb.org',
      'https://api.claude.ai',
      'https://didi.cn',
      'https://www.rednote.com/login',
    ]) {
      const c = classifyOutboundUrl(url)
      expect(c.verdict, url).toBe('unknown')
      expect(c.brand, url).toBeNull()
      expect(buildInterceptUrl(c), url).toBeNull()
    }
  })

  it('调用方必须传绝对 http(s) URL：裸域名、非 http(s) 都判 unknown 且 host 为空', () => {
    for (const input of ['chatgpt.com', 'chatgpt-cn.com', 'javascript:alert(1)', '', '/marketplace/chatgpt']) {
      const c = classifyOutboundUrl(input)
      expect(c.verdict, JSON.stringify(input)).toBe('unknown')
      expect(c.brand, JSON.stringify(input)).toBeNull()
      expect(c.host, JSON.stringify(input)).toBe('')
      expect(buildInterceptUrl(c), JSON.stringify(input)).toBeNull()
    }
  })

  it('official 与 lookalike 互斥：lookalike 的 host 永远不是该品牌官方 host', () => {
    for (const url of ['https://chatgpt-cn.com', 'https://deepseek.net', 'https://alipay.com.cn']) {
      const c = classifyOutboundUrl(url)
      expect(c.verdict).toBe('lookalike')
      expect(c.brand).not.toBeNull()
      expect(isOfficialHost(c.host, c.brand!)).toBe(false)
    }
    for (const url of ['https://chatgpt.com', 'https://chat.deepseek.com']) {
      const c = classifyOutboundUrl(url)
      expect(c.verdict).toBe('official')
      expect(isOfficialHost(c.host, c.brand!)).toBe(true)
    }
  })
})

describe('拦截 round-trip：守卫输出 → /verify 参数 → 两出口目标', () => {
  it('lookalike 的拦截 URL 拆回后：回官网去规范域名，自行继续去用户点的域', () => {
    const cases = [
      { url: 'https://chatgpt-cn.com', official: 'https://chatgpt.com', clicked: 'https://chatgpt-cn.com' },
      { url: 'https://deepseek-official.com', official: 'https://deepseek.com', clicked: 'https://deepseek-official.com' },
      { url: 'https://alipay.com.cn', official: 'https://www.alipay.com', clicked: 'https://alipay.com.cn' },
    ] as const
    for (const { url, official, clicked } of cases) {
      const c = classifyOutboundUrl(url)
      const intercept = buildInterceptUrl(c)
      expect(intercept).not.toBeNull()
      const parsed = parseInterceptUrl(intercept!)
      expect(parsed.error, url).toBeNull()
      if (parsed.error) throw new Error('unreachable')
      expect(parsed.officialUrl, url).toBe(official)
      expect(parsed.clickedUrl, url).toBe(clicked)
      expect(parsed.identical, url).toBe(false)
      // 两出口不是同一个地方：回官网与自行继续必须分开。
      expect(new URL(parsed.officialUrl).hostname).not.toBe(new URL(parsed.clickedUrl).hostname)
    }
  })

  it('拦截 URL 的格式本身就是约定：brand=规范域名，domain=用户点的 host', () => {
    const c = classifyOutboundUrl('https://chatgpt-cn.com')
    expect(buildInterceptUrl(c)).toBe('/verify?brand=chatgpt.com&domain=chatgpt-cn.com')
  })

  it('域名逐字一致时不算拦截对象：identical 为真，两出口仍都在源码里', () => {
    const parsed = parseVerifyParams('deepseek.com', 'deepseek.com')
    expect(parsed.error).toBeNull()
    if (parsed.error) throw new Error('unreachable')
    expect(parsed.identical).toBe(true)
    expect(parsed.officialUrl).toBe('https://deepseek.com')
    expect(parsed.clickedUrl).toBe('https://deepseek.com')
    // 参数缺失/品牌不在名单里时比对页不给官网地址，也不猜一个。
    expect(parseVerifyParams('evil.com', 'evil.com').error).toBe('unknown-brand')
    expect(parseVerifyParams(null, 'chatgpt-cn.com').error).toBe('missing-brand')
    expect(parseVerifyParams('chatgpt.com', null).error).toBe('missing-domain')
  })

  it('两出口的文案与目标一一绑定：回官网→官方 URL，自行继续→用户点的 URL', () => {
    const src = readSource('src/app/verify/page.tsx')
    expect(src).toMatch(/<a href=\{parsed\.officialUrl\}>回官网<\/a>/)
    expect(src).toMatch(/<a href=\{parsed\.clickedUrl\} target="_blank" rel="noopener noreferrer">\s*自行继续\s*<\/a>/)
    expect(src).toContain('你将离开本站，前往未经核实的域名')
  })

  it('两出口始终可见：参数错误时按钮是禁用态而不是消失', () => {
    const src = stripComments(readSource('src/app/verify/page.tsx'))
    // 启用态 + 禁用态各一套：文案在源码里至少出现两次。
    expect((src.match(/回官网/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect((src.match(/自行继续/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(src).toContain('aria-disabled')
  })
})

describe('隐私审计：四条新增链路都不持久化用户查询/URL', () => {
  const LINKS = [
    'src/lib/verified-brands.ts',
    'src/lib/lookalike-guard.ts',
    'src/lib/official-card-rank.ts',
    'src/components/verified-official-card.tsx',
    'src/app/verify/page.tsx',
    'src/app/verify/domain-diff.ts',
    'src/lib/safe-browsing.ts',
    'src/app/api/safe-browsing/route.ts',
  ] as const

  /** 持久化/上报的写法：八个文件里一个都不许出现。 */
  const FORBIDDEN = [
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'sendBeacon',
    'document.cookie',
    'prisma',
    '.insert(',
    '.upsert(',
    'telemetry',
  ] as const

  it.each(LINKS)('%s：无任何持久化/上报写法', (rel) => {
    const src = stripComments(readSource(rel))
    for (const token of FORBIDDEN) {
      expect(src, `${rel} 不应包含 ${token}`).not.toContain(token)
    }
  })

  it('发请求的链路只有两条，且各只有唯一去向', () => {
    // 守卫、品牌表、卡片装配、比对纯函数、卡片组件：零请求。
    for (const rel of [
      'src/lib/verified-brands.ts',
      'src/lib/lookalike-guard.ts',
      'src/lib/official-card-rank.ts',
      'src/components/verified-official-card.tsx',
      'src/app/verify/domain-diff.ts',
      'src/app/api/safe-browsing/route.ts',
    ] as const) {
      expect(stripComments(readSource(rel)), rel).not.toContain('fetch(')
    }
    // 比对页只查本站 Safe Browsing 接口，不直接查外网。
    const page = stripComments(readSource('src/app/verify/page.tsx'))
    expect((page.match(/fetch\(/g) ?? []).length).toBe(1)
    expect(page).toContain("fetch(`/api/safe-browsing?url=")
    // Safe Browsing 模块只问 Google Safe Browsing，不问别处。
    const lib = stripComments(readSource('src/lib/safe-browsing.ts'))
    expect((lib.match(/fetch\(/g) ?? []).length).toBe(1)
    expect(lib).toContain('safebrowsing.googleapis.com')
  })

  it('搜索卡片的「去官网」只认规范域名，不拼站内条目 URL', () => {
    const card = stripComments(readSource('src/components/verified-official-card.tsx'))
    expect(card).toContain('safeHref(officialUrl)')
    expect(card).not.toContain('site.url')
  })

  it('审计范围说明：既有站内本地搜索历史（/api/search-history）不在本次审计内', () => {
    // 本测试只锁新增四条链路；既有搜索历史功能另有归属，不在这里断言。
    expect(LINKS.join('\n')).not.toContain('search-history')
  })
})
