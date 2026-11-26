/**
 * 对比分享公开页接线守卫测试（P13，2026-11-26）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom——组件挂载测不了（见
 * compare-share-guard.test.ts 同款说明），接线与渲染纪律走源码守卫体例：
 *   - 公开页是真 <table>（首列实体名 th scope="row"，原子单元格），
 *     不再是卡片 + <dl>；
 *   - 页顶有固定方法论块（比较范围、核验日期、TTL 含义）；
 *   - 格子文案唯一来源是 compareShareCellDisplay（表格与 JSON-LD 共用），
 *     过期字段灰显 + “现待复核”，JSON-LD 只收已核验字段；
 *   - 已发布快照 URL 接入 sitemap（compareShareSitemapEntries + loader）；
 *   - /compare 本身保持 noindex + 登录墙不动；对照页一律不带佣金链。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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

const publicPage = overlaySource('src/app/pub/compare/[slug]/page.tsx')
const sitemapRoute = overlaySource('src/app/sitemap.ts')
const compareLayout = overlaySource('src/app/compare/layout.tsx')

describe('公开页：真 <table> 语义化对照表', () => {
  it('用 <table>/<thead>/<tbody>，首列是 th scope="row" 的实体名', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('<table')
    expect(code).toContain('<thead>')
    expect(code).toContain('<tbody>')
    expect(code).toContain('<th scope="row"')
    expect(code).toContain('<th scope="col"')
  })

  it('不再是卡片 + <dl> 布局', () => {
    const code = stripComments(publicPage)
    expect(code).not.toContain('<dl')
    expect(code).not.toContain('md:grid-cols-2 xl:grid-cols-3')
  })

  it('表头按白名单字段顺序列出维度名，行按站点', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('{fields.map((dim) => (')
    expect(code).toContain('{items.map((item) => (')
    expect(code).toContain('COMPARE_DIMENSION_LABELS[dim.key]')
  })
})

describe('公开页：方法论块与字段级 TTL 三态', () => {
  it('页顶固定方法论块：比较范围、核验日期、TTL 含义', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('比较方法')
    expect(code).toContain('比较范围')
    expect(code).toContain('核验日期')
    expect(code).toContain('核验有效期')
    expect(code).toContain('不比较官网域名、备注与迁移成本')
  })

  it('格子文案唯一来源是 compareShareCellDisplay（表格与 JSON-LD 共用）', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('compareShareCellDisplay')
    expect(code).toContain('display.valueText')
    expect(code).toContain('display.noteText')
  })

  it('过期字段灰显 + “现待复核”；旧的“可能过期”徽标已退役', () => {
    const code = stripComments(publicPage)
    expect(code).toContain("display.state === 'expired'")
    expect(code).toContain('opacity-60')
    expect(code).not.toContain('可能过期')
    // “现待复核”文案由 compareShareCellDisplay 产出（表格与 JSON-LD 共用），
    // 不在页面里手写第二份。
    const ttlLib = overlaySource('src/lib/compare-share-ttl.ts')
    expect(stripComments(ttlLib)).toContain('现待复核')
  })

  it('TTL 数字不手写第二份：取自 COMPARE_SHARE_FIELD_TTL_DAYS', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('COMPARE_SHARE_FIELD_TTL_DAYS.price')
    expect(code).toContain('COMPARE_SHARE_FIELD_TTL_DAYS.platform')
    expect(code).toContain('COMPARE_SHARE_FIELD_TTL_DAYS.maintenance')
  })
})

describe('公开页：WebPage JSON-LD 与可见文本一致', () => {
  it('挂 JsonLd + compareShareWebPageLd，dateModified 取快照冻结时间', () => {
    const code = stripComments(publicPage)
    expect(code).toContain('<JsonLd')
    expect(code).toContain('compareShareWebPageLd')
    expect(code).toContain('frozenAtMs')
  })

  it('JSON-LD 只收已核验字段：过滤条件写死 state === verified', () => {
    const code = stripComments(publicPage)
    expect(code).toContain(".state === 'verified'")
  })

  it('仍是只读冻结页：revalidate=60，直调 shares/:slug，不挂写入口', () => {
    const code = stripComments(publicPage)
    expect(code).toContain("hubGetProbe<CompareShareDetail>('/api/compare/shares/'")
    expect(code).toContain('export const revalidate = 60')
    expect(code).not.toContain('刷新验证')
    expect(code).not.toContain('填写价格')
  })

  it('对照页不带佣金链、不打分：无 sponsored/佣金/affiliate 字样', () => {
    const code = stripComments(publicPage)
    expect(code).not.toMatch(/sponsored|佣金|affiliate/i)
  })
})

describe('sitemap：已发布快照 URL 接入', () => {
  it('sitemap 路由拼入 compareShareSitemapEntries', () => {
    const code = stripComments(sitemapRoute)
    expect(code).toContain('compareShareSitemapEntries(origin, shares ?? [])')
    expect(code).toContain('loadPublishedCompareShares()')
  })

  it('loader 失败只产空数组，不计入四路全线失败判据', () => {
    const code = stripComments(sitemapRoute)
    expect(code).toContain("'/api/compare/shares?status=published&limit=100'")
    expect(code).toContain('if (!body) return null')
  })

  it('中枢列表接口缺失如实写进注释，不假装已打通', () => {
    expect(sitemapRoute).toContain('没有 `GET /api/compare/shares` 列表接口')
  })
})

describe('红线：/compare 本身不动', () => {
  it('/compare layout 仍是 noindex', () => {
    expect(compareLayout).toContain('noindex')
  })

  it('公开页不渲染 note / migration（服务端不返回、页面也不写）', () => {
    const code = stripComments(publicPage)
    expect(code).not.toContain("dim.key === 'note'")
    expect(code).not.toContain("dim.key === 'migration'")
  })
})
