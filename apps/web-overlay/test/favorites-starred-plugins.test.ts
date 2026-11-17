/**
 * P1-6 星标 ≠ 收藏分叉：/favorites 常驻「星标插件」分区。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，组件 effect 跑不起来，
 * 所以按能真实跑到的层次分三层钉死，不拿源码 toContain 充数）：
 *
 *  1. 真行为（纯函数）：applyStarredPluginsLoad 的三态转移——失败立 failed
 *     不写空兜底、成功落 ready、失败后重试成功能恢复。
 *  2. 真渲染（renderToString）：StarredPluginsSectionView 的 loading /
 *     failed / ready-empty / ready-list 四态——断言渲染出的 HTML 文本与链接。
 *  3. 接线守卫：收藏页真的挂了分区、分区真的走 fetchPlugins({ starred: true })
 *     取星标、入口真的指向 /marketplace?starred=1（星标列表）与 /me/plugins。
 *
 * 未覆盖、需浏览器复核的缺口：挂载后 effect 真发请求、点「重试」后列表恢复、
 * 点行跳详情页的端到端链路，node 环境跑不了 effect，只能由 Playwright /
 * 真机走查验证；这里覆盖到：失败态真的渲染出可点的重试按钮、重试与首载
 * 走同一条 load（reloadToken）、状态转移失败≠空。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  STARRED_PLUGINS_HREF,
  STARRED_PLUGINS_LIMIT,
  StarredPluginsSectionView,
  applyStarredPluginsLoad,
  type StarredPluginsSnapshot,
} from '../src/app/favorites/starred-plugins-section'
import type { HubPluginItem } from '../src/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function fakePlugin(overrides: Partial<HubPluginItem>): HubPluginItem {
  return {
    id: 'p-1',
    slug: 'demo-pack',
    kind: 'site-pack',
    name: '演示网址包',
    description: '演示简介',
    status: 'published',
    version: '1.0.0',
    installCount: 3,
    starCount: 12,
    reportCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as HubPluginItem
}

describe('applyStarredPluginsLoad 三态转移', () => {
  it('取数成功：落 ready，带条目与总数', () => {
    const items = [fakePlugin({ slug: 'a' }), fakePlugin({ slug: 'b', name: '插件 B' })]
    expect(applyStarredPluginsLoad({ items, total: 2 }, false)).toEqual({
      status: 'ready',
      items,
      total: 2,
    })
  })

  it('取数失败：立 failed，不拿空兜底冒充 0 星标', () => {
    expect(applyStarredPluginsLoad({ items: [], total: 0 }, true)).toEqual({ status: 'failed' })
  })

  it('重试恢复：failed → 成功，列表恢复、失败态消失', () => {
    const failed = applyStarredPluginsLoad({ items: [], total: 0 }, true)
    expect(failed.status).toBe('failed')
    const items = [fakePlugin({ slug: 'a' })]
    expect(applyStarredPluginsLoad({ items, total: 1 }, false)).toEqual({
      status: 'ready',
      items,
      total: 1,
    })
  })
})

describe('StarredPluginsSectionView 真渲染', () => {
  const render = (snapshot: StarredPluginsSnapshot) =>
    // renderToString 在文本与表达式之间插 <!-- --> 注释：断言前去掉，
    // 否则「共 9 个星标插件」这类插值文案永远匹配不上。
    renderToString(createElement(StarredPluginsSectionView, { snapshot, onRetry: () => {} })).replaceAll(
      '<!-- -->',
      '',
    )

  it('loading：只显加载文案，不冒充空态与失败态', () => {
    const html = render({ status: 'loading' })
    expect(html).toContain('星标插件')
    expect(html).toContain('正在加载星标插件')
    expect(html).toContain('starred-plugins-section')
    expect(html).not.toContain('还没有星标任何插件')
    expect(html).not.toContain('星标插件暂时取不到')
  })

  it('failed：显失败文案 + 重试按钮 + 直达星标列表，不冒充 0 星标', () => {
    const html = render({ status: 'failed' })
    expect(html).toContain('星标插件暂时取不到')
    expect(html).toContain('这不代表你没有星标插件')
    expect(html).toContain('重试')
    expect(html).toContain('直接去星标列表看看')
    expect(html).toContain('/marketplace?starred=1')
    expect(html).not.toContain('还没有星标任何插件')
  })

  it('ready 0 条：空态解释星标在哪，给市场与插件中心两个出口', () => {
    const html = render({ status: 'ready', items: [], total: 0 })
    expect(html).toContain('还没有星标任何插件')
    expect(html).toContain('星标的插件不在收藏列表里')
    expect(html).toContain('去插件市场看看')
    expect(html).toContain('/marketplace')
    expect(html).toContain('/me/plugins')
    expect(html).not.toContain('重试')
    expect(html).not.toContain('星标插件暂时取不到')
  })

  it('ready 有数据：列出星标插件（名 + 详情链 + 星数），给总数与全部入口', () => {
    const html = render({
      status: 'ready',
      items: [
        fakePlugin({ slug: 'demo-pack', name: '演示网址包', starCount: 12 }),
        fakePlugin({ slug: 'theme-x', name: '主题 X', description: '好看的主题', starCount: 5 }),
      ],
      total: 2,
    })
    expect(html).toContain('演示网址包')
    expect(html).toContain('主题 X')
    expect(html).toContain('/marketplace/demo-pack')
    expect(html).toContain('/marketplace/theme-x')
    expect(html).toContain('12')
    expect(html).toContain('共 2 个星标插件')
    expect(html).toContain('查看全部星标插件')
    expect(html).toContain('/marketplace?starred=1')
    expect(html).toContain('/me/plugins')
  })

  it('ready 总数大于当页条数：如实说只列了前 N 个', () => {
    const html = render({
      status: 'ready',
      items: [fakePlugin({ slug: 'a' })],
      total: 9,
    })
    expect(html).toContain('共 9 个星标插件')
    expect(html).toContain('这里只列前 1 个')
  })
})

describe('/favorites 接线守卫', () => {
  it('收藏页挂了星标分区（import + 渲染），入口常量就是星标列表地址', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('StarredPluginsSection')
    expect(page).toContain('<StarredPluginsSection />')
    expect(existsSync(join(ROOT, 'src/app/favorites/starred-plugins-section.tsx'))).toBe(true)
    expect(STARRED_PLUGINS_HREF).toBe('/marketplace?starred=1')
    expect(STARRED_PLUGINS_LIMIT).toBeGreaterThan(0)
  })

  it('分区走 fetchPlugins({ starred: true }) 取星标，不改收藏模型、不碰种子', () => {
    const view = read('src/app/favorites/starred-plugins-section.tsx')
    expect(view).toContain('fetchPlugins')
    expect(view).toContain('starred: true')
    expect(view).toContain('STARRED_PLUGINS_HREF')
    expect(view).toContain('/me/plugins')
    expect(view).toContain('data-testid="starred-plugins-section"')
  })
})
