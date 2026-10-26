import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MAX_ITEM_LIST,
  absUrl,
  breadcrumbLd,
  itemListLd,
  jsonLdScript,
  organizationLd,
  profilePageLd,
  softwareApplicationLd,
  webSiteLd,
} from '../src/lib/seo/json-ld'

/**
 * JSON-LD 纯函数单测。
 *
 * 重点盯三类**静默错误**（错了不报 500，只是 Google 不认）：
 * 1. position 断档 → 整条 BreadcrumbList / ItemList 被丢弃；
 * 2. 中间出现 `//` → 绝对 URL 畸形；
 * 3. `</script>` 没转义 → XSS。
 */

const ORIGIN = 'https://navhub.example.com'

describe('absUrl', () => {
  it('去掉 origin 尾斜杠，路径中间不出 //', () => {
    expect(absUrl('https://a.com/', '/sites')).toBe('https://a.com/sites')
    expect(absUrl('https://a.com///', '/sites/')).toBe('https://a.com/sites')
  })

  it('根路径返回 base + 单斜杠', () => {
    expect(absUrl('https://a.com', '/')).toBe('https://a.com/')
    expect(absUrl('https://a.com/', '/')).toBe('https://a.com/')
  })

  it('空路径按根路径处理', () => {
    expect(absUrl('https://a.com', '')).toBe('https://a.com/')
  })
})

describe('webSiteLd', () => {  it('输出最小合法 WebSite（含 name/url/inLanguage）', () => {
    const ld = webSiteLd(ORIGIN, 'NavHub', '一个导航站') as Record<string, unknown>
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('WebSite')
    expect(ld.name).toBe('NavHub')
    expect(ld.url).toBe(`${ORIGIN}/`)
    expect(ld.inLanguage).toBe('zh-CN')
    expect(ld.description).toBe('一个导航站')
  })

  it('没有 /search 页面，绝不输出 potentialAction（红线 1）', () => {
    const ld = webSiteLd(ORIGIN, 'NavHub') as Record<string, unknown>
    expect(ld.potentialAction).toBeUndefined()
  })

  it('没有评价体系，绝不输出 aggregateRating（红线 2）', () => {
    const ld = webSiteLd(ORIGIN, 'NavHub') as Record<string, unknown>
    expect(ld.aggregateRating).toBeUndefined()
  })

  it('description 超长截断、空值省略', () => {
    const long = 'x'.repeat(500)
    const ld1 = webSiteLd(ORIGIN, 'NavHub', long) as Record<string, unknown>
    expect((ld1.description as string).length).toBe(300)
    const ld2 = webSiteLd(ORIGIN, 'NavHub', '  ') as Record<string, unknown>
    expect(ld2.description).toBeUndefined()
  })

  it('name 为空时回退山羊胡，不输出空 name', () => {
    const ld = webSiteLd(ORIGIN, '   ') as Record<string, unknown>
    expect(ld.name).toBe('山羊胡')
  })
})

describe('organizationLd', () => {
  it('输出最小 Organization（name/url/绝对 logo）', () => {
    const ld = organizationLd(ORIGIN, 'NavHub 导航', '/icons/icon-512.png', '导航站') as Record<string, unknown>
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('Organization')
    expect(ld.name).toBe('NavHub 导航')
    expect(ld.url).toBe(`${ORIGIN}/`)
    expect(ld.logo).toBe(`${ORIGIN}/icons/icon-512.png`)
    expect(ld.description).toBe('导航站')
  })

  it('logo 路径归一（无前导斜杠也拼成绝对地址）', () => {
    const ld = organizationLd(ORIGIN, 'NavHub', 'icons/icon-512.png') as Record<string, unknown>
    expect(ld.logo).toBe(`${ORIGIN}/icons/icon-512.png`)
    const ld2 = organizationLd(ORIGIN, 'NavHub', '  ') as Record<string, unknown>
    expect(ld2.logo).toBe(`${ORIGIN}/icons/icon-512.png`)
  })

  it('description 超长截断、空值省略；name 空回退', () => {
    const ld = organizationLd(ORIGIN, '  ', '/icons/icon-512.png', 'x'.repeat(500)) as Record<string, unknown>
    expect(ld.name).toBe('山羊胡')
    expect((ld.description as string).length).toBe(300)
    const ld2 = organizationLd(ORIGIN, 'NavHub', '/icons/icon-512.png', '  ') as Record<string, unknown>
    expect(ld2.description).toBeUndefined()
  })

  it('不编造实体信息：无 sameAs / address / telephone / aggregateRating', () => {
    const ld = organizationLd(ORIGIN, 'NavHub') as Record<string, unknown>
    for (const field of ['sameAs', 'address', 'telephone', 'aggregateRating']) {
      expect(ld[field]).toBeUndefined()
    }
  })
})

describe('首页接线', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const root = candidates.find((p) => existsSync(join(p, 'src', 'app', 'page.tsx')))!
  const home = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8')

  it('首页同时输出 WebSite 与 Organization，且都经 JsonLd 组件序列化', () => {
    expect(home).toContain('webSiteLd(')
    expect(home).toContain('organizationLd(')
    expect([...home.matchAll(/<JsonLd\b/g)]).toHaveLength(2)
  })
})

describe('breadcrumbLd', () => {
  it('position 从 1 连续编号', () => {
    const ld = breadcrumbLd(ORIGIN, [
      { label: '首页', path: '/' },
      { label: '插件市场', path: '/marketplace' },
      { label: '某插件', path: '/marketplace/foo' },
    ]) as { itemListElement: Array<Record<string, unknown>> }
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2, 3])
    expect(ld.itemListElement[2].item).toBe(`${ORIGIN}/marketplace/foo`)
  })

  it('过滤空 label / 空 path 后 position 仍然连续（断档会被整条丢弃）', () => {
    const ld = breadcrumbLd(ORIGIN, [
      { label: '首页', path: '/' },
      { label: '   ', path: '/x' },
      { label: '', path: '/y' },
      { label: '站点目录', path: '/sites' },
    ]) as { itemListElement: Array<Record<string, unknown>> }
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2])
    expect(ld.itemListElement.map((e) => e.name)).toEqual(['首页', '站点目录'])
  })

  it('全空时输出空列表而非 undefined', () => {
    const ld = breadcrumbLd(ORIGIN, []) as { itemListElement: unknown }
    expect(ld.itemListElement).toEqual([])
  })

  it('非数组输入不抛错', () => {
    const ld = breadcrumbLd(ORIGIN, undefined as never) as { itemListElement: unknown }
    expect(ld.itemListElement).toEqual([])
  })
})

describe('itemListLd', () => {
  it('URL 走 /site/{id} 且 id 被编码（与 sitemap 同规则）', () => {
    const ld = itemListLd(ORIGIN, [{ id: 'a b/c', title: '怪名字' }]) as {
      itemListElement: Array<Record<string, unknown>>
      numberOfItems: number
    }
    expect(ld.itemListElement[0].url).toBe(`${ORIGIN}/site/a%20b%2Fc`)
    expect(ld.numberOfItems).toBe(1)
  })

  it('超过 MAX_ITEM_LIST 截断且 numberOfItems 与截断后一致', () => {
    const many = Array.from({ length: MAX_ITEM_LIST + 20 }, (_, i) => ({ id: `s${i}`, title: `t${i}` }))
    const ld = itemListLd(ORIGIN, many) as { itemListElement: unknown[]; numberOfItems: number }
    expect(ld.itemListElement).toHaveLength(MAX_ITEM_LIST)
    expect(ld.numberOfItems).toBe(MAX_ITEM_LIST)
  })

  it('position 连续、空 id / 空 title 被过滤', () => {
    const ld = itemListLd(ORIGIN, [
      { id: 'a', title: 'A' },
      { id: '', title: 'B' },
      { id: 'c', title: '' },
      { id: 'd', title: 'D' },
    ]) as { itemListElement: Array<Record<string, unknown>> }
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2])
    expect(ld.itemListElement.map((e) => e.name)).toEqual(['A', 'D'])
  })
})

describe('softwareApplicationLd', () => {
  const plugin = { slug: 'legal-pro-bundle', name: '法务与合规组合包', description: '面向法务与创业者的专业配置' }

  it('输出最小 SoftwareApplication（name/description/applicationCategory/url）', () => {
    const ld = softwareApplicationLd(ORIGIN, plugin) as Record<string, unknown>
    expect(ld['@type']).toBe('SoftwareApplication')
    expect(ld.name).toBe('法务与合规组合包')
    expect(ld.description).toBe('面向法务与创业者的专业配置')
    expect(ld.applicationCategory).toBe('WebApplication')
    expect(ld.url).toBe(`${ORIGIN}/marketplace/legal-pro-bundle`)
  })

  it('绝不输出 aggregateRating / ratingValue / reviewCount（红线 2）', () => {
    const ld = softwareApplicationLd(ORIGIN, plugin) as Record<string, unknown>
    expect(ld.aggregateRating).toBeUndefined()
    expect(ld.ratingValue).toBeUndefined()
    expect(ld.reviewCount).toBeUndefined()
  })

  it('绝不输出 offers / price（免费但不声明交易信息）', () => {
    const ld = softwareApplicationLd(ORIGIN, plugin) as Record<string, unknown>
    expect(ld.offers).toBeUndefined()
    expect(ld.price).toBeUndefined()
  })

  it('slug 被编码，description 超长截断、空值省略', () => {
    const ld = softwareApplicationLd(ORIGIN, { slug: 'a b', name: 'x', description: 'y'.repeat(500) }) as Record<string, unknown>
    expect(ld.url).toBe(`${ORIGIN}/marketplace/a%20b`)
    expect((ld.description as string).length).toBe(300)
    const ld2 = softwareApplicationLd(ORIGIN, { slug: 'x', name: 'n' }) as Record<string, unknown>
    expect(ld2.description).toBeUndefined()
  })

  it('name 为空回退山羊胡插件，slug 为空省略 url', () => {
    const ld = softwareApplicationLd(ORIGIN, { slug: '', name: '  ' }) as Record<string, unknown>
    expect(ld.name).toBe('山羊胡插件')
    expect(ld.url).toBeUndefined()
  })
})

describe('profilePageLd', () => {
  it('输出 ProfilePage + Person，url 指向作者主页', () => {
    const ld = profilePageLd(ORIGIN, {
      name: '小明',
      path: '/marketplace/author/0b2cf6fc3fe5dde6d0ef78e4',
      description: '已上架 3 个插件',
    }) as Record<string, unknown>
    expect(ld['@type']).toBe('ProfilePage')
    expect(ld.inLanguage).toBe('zh-CN')
    const person = ld.mainEntity as Record<string, unknown>
    expect(person['@type']).toBe('Person')
    expect(person.name).toBe('小明')
    expect(person.url).toBe(`${ORIGIN}/marketplace/author/0b2cf6fc3fe5dde6d0ef78e4`)
    expect(person.description).toBe('已上架 3 个插件')
  })

  it('不编造 sameAs / image / jobTitle（匿名哈希主体没有可核验资料）', () => {
    const ld = profilePageLd(ORIGIN, { name: '匿名', path: '/marketplace/author/abc12345' })
    const person = ld.mainEntity as Record<string, unknown>
    expect(person.sameAs).toBeUndefined()
    expect(person.image).toBeUndefined()
    expect(person.jobTitle).toBeUndefined()
  })

  it('name 为空回退默认作者名，description 超长截断', () => {
    const ld = profilePageLd(ORIGIN, { name: '  ', path: '/x', description: 'y'.repeat(500) })
    const person = ld.mainEntity as Record<string, unknown>
    expect(person.name).toBe('山羊胡插件作者')
    expect((person.description as string).length).toBe(300)
  })
})

describe('jsonLdScript', () => {
  it('转义 </script>，脚本上下文不能越狱（红线 3）', () => {
    const out = jsonLdScript({ name: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('\\u003c')
  })

  it('转义 U+2028 / U+2029（JS 行终止符）', () => {
    const out = jsonLdScript({ name: 'a\u2028b\u2029c' })
    expect(out).not.toMatch(/[\u2028\u2029]/)
  })

  it('转义后 JSON.parse 回来与原文一致', () => {
    const data = webSiteLd(ORIGIN, 'Nav</script>Hub', '描述 & 更多')
    expect(JSON.parse(jsonLdScript(data))).toEqual(data)
  })

  it('& 也转义，避免 HTML 实体歧义', () => {
    expect(jsonLdScript({ name: 'a & b' })).toContain('\\u0026')
  })
})
