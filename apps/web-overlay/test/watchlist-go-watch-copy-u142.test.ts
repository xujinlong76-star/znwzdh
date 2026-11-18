/**
 * U-142 追剧清单 4 处「去看」文案谎报落点（测试先行，W4）。
 *
 * 根因：useWatchlist.ts:235 写死 `playUrl: platform.href`——playUrl 只是
 * 平台首页，不是剧集直达页；但 page.tsx 4 处链接文案却写裸「去看」/
 * 「去看新一集」，谎报能直达正片。修法（既定）：文案先行，不改链目标——
 * 4 处一律改为「去{平台}首页搜」诚实表述；drama-content.tsx:273 的
 * title「在{平台}站内打开」同样是事实错误，顺带改掉。
 *
 * 断言范围（coordinator 裁决，HEAD 603bbec2 实测行号）：
 *   page.tsx 文案行 :239 EntryRow、:486 日更区、:536 周排播区、
 *   :618 待看区（原文案「去看新一集」）；链行 :234/:481/:531/:613；
 *   drama-content.tsx:273 title。
 * 不断言（只扫不碰，记残留）：home-drama-cinema.tsx:238 同款
 * 「在{平台}站内打开」title，本轮守范围不改，留下一轮候选。
 *
 * 范式：源码文本断言（对照 exam-node-link-label-u124.test.ts T8 /
 * me-watchlist-entry.test.ts 源码守卫），不渲染、不跑 effect——
 * page.tsx 是 'use client' 岛，渲染断言成本高且文案在源码里是字面量，
 * 文本断言即事实源断言。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')
const page = () => read('src/app/me/watchlist/page.tsx')
const drama = () => read('src/components/drama-content.tsx')
const hook = () => read('src/hooks/useWatchlist.ts')

/** 4 个 playUrl 锚点块：<a href={safeHref(entry.playUrl)} …>…</a>。 */
function playAnchors(src: string): string[] {
  const re = /<a\s+href=\{safeHref\(entry\.playUrl\)\}[\s\S]*?<\/a>/g
  return [...src.matchAll(re)].map((m) => m[0])
}

describe('T1：4 处「去看」锚点文案均为「去{平台}首页搜」', () => {
  it('4 个 playUrl 锚点各含一次「去{platformTitle}首页搜」，无裸「去看」/「去看新一集」', () => {
    const anchors = playAnchors(page())
    expect(anchors).toHaveLength(4)
    for (const a of anchors) {
      // 「去{…platformTitle}首页搜」：插值变量名不限 entry. 前缀，只认平台字段。
      expect(a).toMatch(/去\{[^}]*platformTitle\}首页搜/)
      // 裸「去看」：后跟空格 + 图标（3 处）与「去看新一集」（待看区）都算；
      // 「去看看」区文案不在锚点内，不会被误伤。
      expect(a).not.toMatch(/去看(?!看)/)
      expect(a).not.toContain('去看新一集')
    }
  })
})

describe('T2：全量计数（防漏网/防多改）', () => {
  it('「首页搜」恰好 4 次、裸「去看 <ExternalLink」0 次、「去看新一集」0 次', () => {
    const src = page()
    expect(src.match(/首页搜/g)?.length).toBe(4)
    expect(src.match(/去\{[^}]*platformTitle\}首页搜/g)?.length).toBe(4)
    expect(src.match(/去看 <ExternalLink/g)?.length ?? 0).toBe(0)
    expect(src).not.toContain('去看新一集')
  })
})

describe('T3：链目标不变（只改文案，不改链）', () => {
  it('4 处 href 仍为 safeHref(entry.playUrl)，playUrl 仍为平台首页，安全属性不变', () => {
    const src = page()
    expect(src.match(/href=\{safeHref\(entry\.playUrl\)\}/g)?.length).toBe(4)
    for (const a of playAnchors(src)) {
      expect(a).toContain('target="_blank"')
      expect(a).toContain('rel="noopener noreferrer"')
    }
    // 链目标事实源：useWatchlist 仍写死平台首页，不偷改成假直达页。
    expect(hook().match(/playUrl: platform\.href/g)?.length).toBe(1)
  })
})

describe('T4：drama-content title 不再声称「站内打开」', () => {
  it('「站内打开」0 次，标题链接 href 与剧名渲染不变', () => {
    const src = drama()
    expect(src).not.toContain('站内打开')
    expect(src).toContain('href={safeHref(entry.playUrl)}')
    expect(src).toContain('{entry.title}')
  })
})

describe('T5：诚实的「去看看」区不动（防多改）', () => {
  it('节奏未标注区「顺手去看看 / 去看看有没有更新」文案仍在', () => {
    const src = page()
    expect(src).toContain('顺手去看看')
    expect(src).toContain('去看看有没有更新')
    expect(src).toContain('aria-label="去看看有没有更新"')
  })
})
