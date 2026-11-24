/**
 * /verify 比对页（W2）的定向测试。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：页面级断言用源码守卫（与
 * brief-hotlist-honest-empty.test.ts 同款做法）——读 verify/ 下的源码，
 * 断言两个出口、诚实口径与硬线；纯函数部分（域名归一化、逐字对照、
 * 参数解析）真测。
 *
 * 注意：本文件执行面是 vendor 镜像 apps/web/test/**（逐字节同步），
 * overlay/test 不进默认套件；改动后须经 overlay -> apps/web 同步再跑。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  VERIFIED_BRANDS_CHECKED_AT,
  diffDomains,
  normalizeDomain,
  parseVerifyParams,
} from '../src/app/verify/domain-diff'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')
const pageSrc = () => read('src/app/verify/page.tsx')
const diffSrc = () => read('src/app/verify/domain-diff.ts')
const layoutSrc = () => read('src/app/verify/layout.tsx')

describe('normalizeDomain', () => {
  it('去协议、去路径、去尾点、小写', () => {
    expect(normalizeDomain('HTTPS://ChatGPT.com.cn/login?x=1')).toBe('chatgpt.com.cn')
    expect(normalizeDomain('www.kimi.com.')).toBe('www.kimi.com')
    expect(normalizeDomain('  www.douyin.com:443 ')).toBe('www.douyin.com')
  })

  it('空输入返回空串', () => {
    expect(normalizeDomain(null)).toBe('')
    expect(normalizeDomain(undefined)).toBe('')
    expect(normalizeDomain('   ')).toBe('')
  })
})

describe('diffDomains', () => {
  it('完全一致时 identical 且无差异标签', () => {
    const d = diffDomains('chatgpt.com', 'https://chatgpt.com/')
    expect(d.identical).toBe(true)
    expect(d.differingLabels).toBe(0)
    expect(d.canonical).toEqual([{ text: 'chatgpt.com', same: true }])
  })

  it('一处字符不同：只高亮差异字符，差异标签计 1', () => {
    const d = diffDomains('www.kimi.com', 'www.kim1.com')
    expect(d.identical).toBe(false)
    expect(d.differingLabels).toBe(1)
    const clickedText = d.clicked.map((s) => s.text).join('')
    expect(clickedText).toBe('www.kim1.com')
    const diffChars = d.clicked.filter((s) => !s.same).map((s) => s.text)
    expect(diffChars).toEqual(['1'])
    const canonicalDiff = d.canonical.filter((s) => !s.same).map((s) => s.text)
    expect(canonicalDiff).toEqual(['i'])
  })

  it('缺 www 前缀：多出的标签整段标差异', () => {
    const d = diffDomains('www.kimi.com', 'kimi.com')
    expect(d.identical).toBe(false)
    expect(d.differingLabels).toBe(1)
    expect(d.canonical.filter((s) => !s.same).map((s) => s.text)).toEqual(['www'])
  })

  it('顶级域不同也只计差异标签', () => {
    const d = diffDomains('chatgpt.com', 'chatgpt.com.cn')
    expect(d.identical).toBe(false)
    expect(d.differingLabels).toBe(1)
  })

  it('片段拼回后与原域名逐字相同（无多余分隔点）', () => {
    const pairs: Array<[string, string]> = [
      ['www.kimi.com', 'www.kim1.com'],
      ['www.kimi.com', 'kimi.com'],
      ['chatgpt.com', 'chatgpt.com.cn'],
      ['www.kimi.com', 'kimi.com.cn'],
      ['chatgpt.com', 'chatgpt.net'],
    ]
    for (const [canonical, clicked] of pairs) {
      const d = diffDomains(canonical, clicked)
      expect(d.canonical.map((s) => s.text).join('')).toBe(canonical)
      expect(d.clicked.map((s) => s.text).join('')).toBe(clicked)
    }
  })
})

describe('parseVerifyParams', () => {
  it('品牌认规范域名，官网地址拼 https:// + 规范域名', () => {
    const p = parseVerifyParams('chatgpt.com', 'chatgpt.com.cn')
    expect(p.error).toBeNull()
    if (p.error) return
    expect(p.brand.name).toBe('ChatGPT')
    expect(p.brand.canonicalDomain).toBe('chatgpt.com')
    expect(p.officialUrl).toBe('https://chatgpt.com')
    expect(p.clickedUrl).toBe('https://chatgpt.com.cn')
    expect(p.identical).toBe(false)
  })

  it('品牌名也能命中（退而认品牌名/别名）', () => {
    const p = parseVerifyParams('ChatGPT', 'chatgpt.com')
    expect(p.error).toBeNull()
    if (p.error) return
    expect(p.brand.canonicalDomain).toBe('chatgpt.com')
    expect(p.identical).toBe(true)
  })

  it('不在 50 家名单里的品牌一律 unknown-brand，不猜测', () => {
    expect(parseVerifyParams('example.com', 'example.com').error).toBe('unknown-brand')
    expect(parseVerifyParams('openai.com', 'openai.com').error).toBe('unknown-brand')
  })

  it('缺参数分别报 missing-brand / missing-domain', () => {
    expect(parseVerifyParams(null, 'chatgpt.com.cn').error).toBe('missing-brand')
    expect(parseVerifyParams('', 'chatgpt.com.cn').error).toBe('missing-brand')
    expect(parseVerifyParams('chatgpt.com', null).error).toBe('missing-domain')
    expect(parseVerifyParams('chatgpt.com', '').error).toBe('missing-domain')
  })

  it('核查日期是 2026-11-24', () => {
    expect(VERIFIED_BRANDS_CHECKED_AT).toBe('2026-11-24')
  })
})

describe('verify page 源码守卫', () => {
  it('两个出口始终在源码里：回官网去 https:// + 规范域名，自行继续新标签页去用户点的域名', () => {
    const src = pageSrc()
    expect(src).toContain('回官网')
    expect(src).toContain('自行继续')
    expect(src).toContain('href={parsed.officialUrl}')
    expect(src).toContain('href={parsed.clickedUrl}')
    expect(src).toContain('target="_blank"')
    expect(src).toContain('rel="noopener noreferrer"')
    expect(src).toContain('你将离开本站，前往未经核实的域名')
  })

  it('绝不自动跳转：无路由跳转、无刷新跳转、无定时跳转', () => {
    const src = pageSrc()
    expect(src).not.toContain('useRouter')
    expect(src).not.toContain('router.replace')
    expect(src).not.toContain('router.push')
    expect(src).not.toContain('redirect(')
    expect(src).not.toContain('setTimeout')
    expect(src).not.toContain('http-equiv')
    expect(src).not.toContain('location.href')
    expect(src).not.toContain('location.replace')
  })

  it('不记录用户行为：无本地存储；纯函数模块不发请求，页面只查 safe-browsing', () => {
    const src = pageSrc() + diffSrc()
    expect(src).not.toContain('localStorage')
    expect(src).not.toContain('sessionStorage')
    expect(diffSrc()).not.toContain('fetch(')
    expect(pageSrc()).toContain('/api/safe-browsing?url=')
  })

  it('诚实口径：无数据写未查到/未公开，不写自封的安全结论', () => {
    const src = pageSrc()
    expect(src).toContain('未查到')
    expect(src).toContain('未公开/未查到')
    expect(src).toContain('VERIFIED_BRANDS_CHECKED_AT')
    expect(src).not.toContain('是安全的')
    expect(src).not.toContain('是危险的')
    expect(src).not.toContain('危险网站')
    expect(src).not.toContain('安全网站')
  })

  it('布局 noindex，不进搜索', () => {
    expect(layoutSrc()).toContain('index: false')
    expect(layoutSrc()).toContain('follow: false')
  })
})
