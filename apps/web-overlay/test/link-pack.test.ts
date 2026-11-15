/**
 * 链接包（快照版，第 5 项）：
 *   1. 打包生成（标题/备注/用途齐全、空选拒绝、超限拒绝）；
 *   2. 快照冻结（原收藏改动后包内容不变）；
 *   3. 损坏包恢复（坏链接逐条标注不整页挂；信封级损坏才整页报错）；
 *   4. 导入我的收藏（去重：已收藏的不重复建，预览与实际导入同一把尺子）；
 *   5. 接线守卫：收藏页批量栏真有打包入口、/pack 页真有打开与导入、
 *      对话框真把上限与分包说明写出来。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  LINK_PACK_HASH_PREFIX,
  LINK_PACK_MAX_ENCODED_CHARS,
  LINK_PACK_MAX_ITEMS,
  buildLinkPack,
  decodeLinkPackPayload,
  describeLinkPackSnapshot,
  encodeLinkPackJson,
  formatPackDate,
  linkPackItemsToImportJson,
  openAllPackItems,
  parseLinkPack,
  planLinkPackImport,
  type LinkPackItemInput,
} from '../src/lib/link-pack'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const BASE = { origin: 'https://nav.example', pathname: '/pack' }
const PUBLISHED_AT = Date.UTC(2026, 10, 13, 8, 0, 0)

const A: LinkPackItemInput = {
  siteId: 'a',
  title: '甲站',
  href: 'https://a.example.com/docs',
  purpose: '查文档',
}
const B: LinkPackItemInput = {
  siteId: 'b',
  title: '乙站',
  href: 'https://b.example.com/',
  purpose: '看教程',
}

function buildOk(items: LinkPackItemInput[] = [A, B], title = '我的工具合集') {
  const out = buildLinkPack({ title, note: '新人必看', items, publishedAt: PUBLISHED_AT }, BASE)
  expect(out.ok).toBe(true)
  if (!out.ok) throw new Error('unexpected build failure: ' + out.reason)
  return out
}

/** 生成 → 解码 → 解析，拿到可渲染的包（测试里的标准往返路径） */
function roundTrip(items: LinkPackItemInput[] = [A, B], title = '我的工具合集') {
  const out = buildOk(items, title)
  const decoded = decodeLinkPackPayload(new URL(out.url).hash)
  expect(decoded.ok).toBe(true)
  if (!decoded.ok) throw new Error('unexpected decode failure')
  const parsed = parseLinkPack(decoded.raw)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('unexpected parse failure: ' + parsed.error)
  return { out, parsed }
}

describe('打包生成', () => {
  it('标题/备注/用途齐全，往返后一字不差', () => {
    const { out, parsed } = roundTrip()
    expect(out.url.startsWith('https://nav.example/pack#pack=')).toBe(true)
    expect(parsed.title).toBe('我的工具合集')
    expect(parsed.note).toBe('新人必看')
    expect(parsed.publishedAt).toBe(PUBLISHED_AT)
    expect(parsed.items.map((i) => [i.title, i.href, i.purpose])).toEqual([
      ['甲站', 'https://a.example.com/docs', '查文档'],
      ['乙站', 'https://b.example.com/', '看教程'],
    ])
    expect(parsed.validCount).toBe(2)
    expect(parsed.invalidCount).toBe(0)
  })

  it('空选拒绝：不生成链接，给出原因', () => {
    const out = buildLinkPack({ title: '空包', items: [] }, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('empty build should fail')
    expect(out.reason).toContain('至少 1 个')
  })

  it('无标题拒绝', () => {
    const out = buildLinkPack({ title: '   ', items: [A] }, BASE)
    expect(out.ok).toBe(false)
  })

  it('超 20 条拒绝，并明说分包', () => {
    const items = Array.from({ length: LINK_PACK_MAX_ITEMS + 1 }, (_, i) => ({
      siteId: `s${i}`,
      title: `站 ${i}`,
      href: `https://s${i}.example.com/`,
    }))
    const out = buildLinkPack({ title: '太多', items }, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('over-limit build should fail')
    expect(out.reason).toContain(String(LINK_PACK_MAX_ITEMS))
    expect(out.reason).toContain('分两次打包')
  })

  it('恰好 20 条可以通过', () => {
    const items = Array.from({ length: LINK_PACK_MAX_ITEMS }, (_, i) => ({
      siteId: `s${i}`,
      title: `站${i}`,
      href: `https://s${i}.example.com/`,
    }))
    expect(buildLinkPack({ title: '满包', items }, BASE).ok).toBe(true)
  })

  it('坏链接拒绝并点名第几条', () => {
    const out = buildLinkPack({ title: '坏链', items: [A, { title: '坏', href: 'javascript:alert(1)' }] }, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('bad href build should fail')
    expect(out.reason).toContain('第 2 个')
  })

  it('超长字段截断并记进 notes，不静默改字', () => {
    const out = buildLinkPack(
      { title: 't'.repeat(50), items: [{ ...A, purpose: '用'.repeat(60) }] },
      BASE,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('unexpected failure')
    expect(out.pack.title).toHaveLength(40)
    expect(out.pack.items[0]?.p).toHaveLength(40)
    expect(out.notes.length).toBeGreaterThan(0)
  })

  it('内容太长超 4KB 时拒绝（字节闸），不是生成一条打不开的链接', () => {
    const items = Array.from({ length: LINK_PACK_MAX_ITEMS }, (_, i) => ({
      siteId: `s${i}`,
      title: '标题'.repeat(30),
      href: `https://s${i}.example.com/` + 'p/'.repeat(60),
      purpose: '用途'.repeat(20),
    }))
    const out = buildLinkPack({ title: '超长包', items }, BASE)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('oversize build should fail')
    expect(out.reason).toContain('4KB')
  })

  it('中文编码比 DIY 的 encodeURIComponent 式更省：同样内容更短', () => {
    const json = JSON.stringify({ pack: 1, title: '中文标题合集', items: [{ t: '甲站查文档', u: 'https://a.example.com/', p: '每天用的工具' }] })
    const ours = encodeLinkPackJson(json)
    const diyStyle = btoa(encodeURIComponent(json))
    expect(ours.length).toBeLessThan(diyStyle.length)
    expect(ours.length).toBeLessThanOrEqual(LINK_PACK_MAX_ENCODED_CHARS)
    expect(ours).not.toContain('+')
    expect(ours).not.toContain('/')
  })
})

describe('快照冻结', () => {
  it('生成后改原收藏（标题/链接/用途），已发出的包内容不变', () => {
    const mutable: LinkPackItemInput = { siteId: 'a', title: '旧标题', href: 'https://a.example.com/', purpose: '旧用途' }
    const out = buildOk([mutable])
    // 生成之后原收藏大改：改名、换链、删用途、再新增一条
    mutable.title = '新标题'
    mutable.href = 'https://changed.example.com/'
    mutable.purpose = '新用途'
    const decoded = decodeLinkPackPayload(new URL(out.url).hash)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) throw new Error('unexpected decode failure')
    const parsed = parseLinkPack(decoded.raw)
    expect(parsed.ok).toBe(true)
    expect(parsed.items[0]?.title).toBe('旧标题')
    expect(parsed.items[0]?.href).toBe('https://a.example.com/')
    expect(parsed.items[0]?.purpose).toBe('旧用途')
  })

  it('接收页标注快照版与发布日期，并明说内容不再更新', () => {
    expect(describeLinkPackSnapshot(PUBLISHED_AT)).toBe('快照版 · 发布于 2026-11-13 · 内容不再更新')
    expect(formatPackDate(PUBLISHED_AT)).toBe('2026-11-13')
    expect(describeLinkPackSnapshot(null)).toContain('发布日期未知')
  })

  it('发布日期按本地日期显示：北京时间凌晨发布的包不显示成前一天', () => {
    // 2026-11-13 01:00 CST = 2026-11-12 17:00 UTC；按 UTC 取日期会错成 11-12
    const at = Date.UTC(2026, 10, 12, 17, 0, 0)
    const d = new Date(at)
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(formatPackDate(at)).toBe(expected)
    expect(describeLinkPackSnapshot(at)).toContain(`发布于 ${expected}`)
  })
})

describe('损坏包恢复', () => {
  it('hash 为空 / 不是 #pack= 时整包报错并给原因', () => {
    expect(decodeLinkPackPayload('').ok).toBe(false)
    expect(decodeLinkPackPayload('#diy=xxxx').ok).toBe(false)
  })

  it('base64 损坏 / JSON 损坏时整包报错', () => {
    expect(decodeLinkPackPayload('#pack=!!!not-base64!!!').ok).toBe(false)
    expect(decodeLinkPackPayload('#pack=' + encodeLinkPackJson('{not json')).ok).toBe(false)
  })

  it('超 4KB 的 hash 整包拒收', () => {
    const out = decodeLinkPackPayload('#pack=' + 'A'.repeat(LINK_PACK_MAX_ENCODED_CHARS + 1))
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('oversize hash should fail')
    expect(out.reason).toContain('4KB')
  })

  it('未知版本整包拒收（不猜、不降级）', () => {
    const parsed = parseLinkPack({ pack: 99, title: '未来包', publishedAt: PUBLISHED_AT, items: [{ t: '甲', u: 'https://a.example.com/' }] })
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('版本')
  })

  it('空包 / items 不是数组时整包报错', () => {
    expect(parseLinkPack({ pack: 1, title: '空', publishedAt: PUBLISHED_AT, items: [] }).ok).toBe(false)
    expect(parseLinkPack({ pack: 1, title: '坏', publishedAt: PUBLISHED_AT }).ok).toBe(false)
    expect(parseLinkPack('not-an-object').ok).toBe(false)
  })

  it('个别条目坏链接：逐条标注 invalid，其余照常可用，不整页挂', () => {
    const raw = {
      pack: 1,
      title: '半坏的包',
      publishedAt: PUBLISHED_AT,
      items: [
        { id: 'a', t: '甲站', u: 'https://a.example.com/' },
        { id: 'b', t: '坏站', u: 'javascript:alert(1)' },
        { id: 'c', t: '', u: 'https://c.example.com/' },
        'not-an-item',
      ],
    }
    const parsed = parseLinkPack(raw)
    expect(parsed.ok).toBe(true)
    expect(parsed.validCount).toBe(2)
    expect(parsed.invalidCount).toBe(2)
    expect(parsed.items[0]?.status).toBe('ok')
    expect(parsed.items[1]?.status).toBe('invalid')
    expect(parsed.items[1]?.problem).toContain('链接无效')
    expect(parsed.items[2]?.status).toBe('ok')
    expect(parsed.items[2]?.title).toBe('https://c.example.com/')
    expect(parsed.items[3]?.status).toBe('invalid')
  })

  it('无标题的包不整包报错： fallback 为「未命名链接包」并记 note', () => {
    const parsed = parseLinkPack({ pack: 1, publishedAt: PUBLISHED_AT, items: [{ t: '甲', u: 'https://a.example.com/' }] })
    expect(parsed.ok).toBe(true)
    expect(parsed.title).toBe('未命名链接包')
    expect(parsed.notes.join('')).toContain('未命名')
  })

  it('危险键 __proto__ 被深剥，不污染原型，且记进 dropped', () => {
    const raw = JSON.parse('{"pack":1,"title":"x","publishedAt":1,"items":[{"t":"甲","u":"https://a.example.com/","__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}')
    const parsed = parseLinkPack(raw)
    expect(parsed.ok).toBe(true)
    expect(parsed.dropped).toBeGreaterThan(0)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('导入我的收藏（去重）', () => {
  it('已收藏的不重复建：www / utm / 尾斜杠差异判同一条', () => {
    const { parsed } = roundTrip()
    const plan = planLinkPackImport(parsed.items, ['https://www.a.example.com/docs?utm_source=x'])
    expect(plan[0]?.status).toBe('already-saved')
    expect(plan[1]?.status).toBe('new')
  })

  it('无效条目不进导入计划', () => {
    const parsed = parseLinkPack({
      pack: 1,
      title: '半坏',
      publishedAt: PUBLISHED_AT,
      items: [
        { t: '甲', u: 'https://a.example.com/' },
        { t: '坏', u: 'javascript:alert(1)' },
      ],
    })
    expect(parsed.ok).toBe(true)
    const plan = planLinkPackImport(parsed.items, [])
    expect(plan.map((p) => p.status)).toEqual(['new', 'invalid'])
  })

  it('转换给 importJson 的输入：version 1、用途进 description、无效条目已剔除', () => {
    const parsed = parseLinkPack({
      pack: 1,
      title: '半坏',
      publishedAt: PUBLISHED_AT,
      items: [
        { id: 'a', t: '甲站', u: 'https://a.example.com/', p: '查文档' },
        { t: '坏', u: 'javascript:alert(1)' },
      ],
    })
    expect(parsed.ok).toBe(true)
    const input = JSON.parse(linkPackItemsToImportJson(parsed.items)) as {
      version: number
      items: Array<{ siteId: string; title: string; href: string; description?: string }>
    }
    expect(input.version).toBe(1)
    expect(input.items).toHaveLength(1)
    expect(input.items[0]).toMatchObject({ siteId: 'a', title: '甲站', href: 'https://a.example.com/', description: '查文档' })
  })
})

describe('一键全部打开', () => {
  it('逐条打开；被拦截的如实计数，不报「已全部打开」', () => {
    const { parsed } = roundTrip()
    const opened: string[] = []
    const result = openAllPackItems(parsed.items, (href) => {
      opened.push(href)
      return href.includes('a.example') ? { closed: false } : null
    })
    expect(result).toEqual({ attempted: 2, opened: 1, blocked: 1 })
    expect(opened).toHaveLength(2)
  })

  it('无效条目不尝试打开；opener 抛错计入拦截', () => {
    const parsed = parseLinkPack({
      pack: 1,
      title: '半坏',
      publishedAt: PUBLISHED_AT,
      items: [
        { t: '甲', u: 'https://a.example.com/' },
        { t: '坏', u: 'javascript:alert(1)' },
      ],
    })
    expect(parsed.ok).toBe(true)
    const result = openAllPackItems(parsed.items, () => {
      throw new Error('popup blocked')
    })
    expect(result).toEqual({ attempted: 1, opened: 0, blocked: 1 })
  })
})

describe('接线守卫：入口与页面真的挂上了', () => {
  it('收藏页批量栏有「打包成链接包」入口：未选时不可点并说明原因', () => {
    const src = overlaySource('src/app/favorites/page.tsx')
    expect(src).toContain('打包成链接包')
    expect(src).toContain('setShowLinkPack(true)')
    expect(src).toContain('LinkPackDialog')
    // 空状态：disabled + 可见的原因文案，不只是 title 悬停
    expect(src).toContain('选中收藏后可打包成链接包')
    expect(src).toContain('请先选中至少 1 个收藏，再打包成链接包')
    // 超限分包走对话框：页内引用上限常量
    expect(src).toContain('LINK_PACK_MAX_ITEMS')
  })

  it('/pack 接收页认 #pack=、有全部打开与一键导入、标快照', () => {
    const src = overlaySource('src/app/pack/page.tsx')
    expect(src).toContain(LINK_PACK_HASH_PREFIX)
    expect(src).toContain('全部打开')
    expect(src).toContain('一键导入我的收藏')
    expect(src).toContain('describeLinkPackSnapshot')
    expect(src).toContain('importJson')
    // 站点已删逐条核对：404 才标，网络失败不误报
    expect(src).toContain('fetchSite')
    expect(src).toContain('已从本站下架')
    // 触控：操作按钮 44px
    expect(src).toContain('min-h-11')
  })

  it('对话框把上限、分包、快照三件事都说明白', () => {
    const src = overlaySource('src/components/link-pack-dialog.tsx')
    expect(src).toContain('只打包前')
    expect(src).toContain('LINK_PACK_MAX_ITEMS')
    expect(src).toContain('快照')
    expect(src).toContain('复制链接')
    expect(src).toContain('min-h-11')
    // 共享 Dialog（Radix）提供 role="dialog" 与焦点管理：这里守住用的是它而不是手写 div
    expect(src).toContain('DialogContent')
    expect(src).toContain('DialogTitle')
  })

  it('链接包与精选合集是两回事：不碰服务端 collections 路由', () => {
    const lib = overlaySource('src/lib/link-pack.ts')
    expect(lib).not.toContain('/api/collections')
    expect(lib).not.toContain('fetch(')
    const page = overlaySource('src/app/pack/page.tsx')
    expect(page).not.toContain('/api/collections')
  })

  it('/pack 路由脚手架齐全：标题 layout + loading + error + Tailwind @source', () => {
    const layout = overlaySource('src/app/pack/layout.tsx')
    expect(layout).toContain("title: '链接包'")
    expect(layout).toContain('description:')
    expect(layout).not.toMatch(/NavHub|NavSphere|山羊胡/)
    // loading / error 缺一个，route-state-coverage 就会点名 /pack；
    // 骨架只许引用 RouteSkeleton（门禁同文件），不手写
    expect(overlaySource('src/app/pack/loading.tsx')).toContain('RouteSkeleton')
    expect(overlaySource('src/app/pack/error.tsx')).toContain('RouteError')
    // 新路由目录被 .gitignore 忽略，必须进 globals.css 的 @source 枚举，
    // 否则 Tailwind 扫不到它独有的工具类
    expect(overlaySource('src/styles/globals.css')).toContain('pack')
  })

  it('/pack 的外部链接全过安全闸：href 内联 safeHref，打开走 safeWindowOpen', () => {
    const src = overlaySource('src/app/pack/page.tsx')
    expect(src).toContain('href={safeHref(item.href')
    expect(src).toContain('safeWindowOpen(href)')
    expect(src).not.toContain('window.open(')
    // 冷区禁令：text-muted-foreground 不许带 /NN 透明度变体
    expect(src).not.toContain('text-muted-foreground/')
  })
})
