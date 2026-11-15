/**
 * search-pack 运行时：matchSearchShortcut 与 quicklink 合并语义。
 *
 * 本文件此前不存在（只有 search-pack 的接线，没有单测）。锁两件事：
 *  1. `!` 直达的基本盘：内置 6 个引擎命中 / 未知前缀不命中 / 空参数走落地页；
 *  2. quicklink 覆盖语义：toSearchEngines(quicklink, getAllSearchEngines())
 *     的合并列表里，用户 gh 优先于内置 gh（同前缀只剩一条，且是用户的）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_ENGINES,
  getAllSearchEngines,
  matchSearchShortcut,
} from '../src/lib/plugins/search-pack-runtime'
import { toSearchEngines, type QuicklinkEntry } from '../src/lib/quicklinks'

const USER_GH: QuicklinkEntry = {
  siteId: 'my-gh',
  title: '我的 GitHub 镜像站',
  href: 'https://github.com',
  quickPrefix: 'gh',
  templateUrl: 'https://github.example.com/search?q={q}',
}

describe('matchSearchShortcut（内置引擎基本盘）', () => {
  it('内置 6 个引擎：!gh / !npm / !mdn / !so / !dd / !caniuse 命中', () => {
    expect(DEFAULT_SEARCH_ENGINES.map((e) => e.prefix)).toEqual([
      '!gh',
      '!npm',
      '!mdn',
      '!so',
      '!dd',
      '!caniuse',
    ])
    expect(matchSearchShortcut('!gh react').directUrl).toBe('https://github.com/search?q=react')
    expect(matchSearchShortcut('!npm lodash').directUrl).toBe('https://www.npmjs.com/search?q=lodash')
    expect(matchSearchShortcut('!GH React').engine?.prefix).toBe('!gh')
  })

  it('!gh 无参数走落地页（{q} → 空串）', () => {
    const hit = matchSearchShortcut('!gh')
    expect(hit.matched).toBe(true)
    expect(hit.directUrl).toBe('https://github.com/search?q=')
  })

  it('不带 ! / 未知前缀 / 拼错前缀不命中', () => {
    expect(matchSearchShortcut('gh react').matched).toBe(false)
    expect(matchSearchShortcut('!unknown x').matched).toBe(false)
    expect(matchSearchShortcut('!githb x').matched).toBe(false)
    expect(matchSearchShortcut('react hooks').matched).toBe(false)
  })

  it('参数整体 encodeURIComponent：& 与空格都转义', () => {
    expect(matchSearchShortcut('!gh a&b c').directUrl).toBe('https://github.com/search?q=a%26b%20c')
  })
})

describe('toSearchEngines 合并语义（用户 quicklink 覆盖内置）', () => {
  it('合并列表里 !gh 只剩一条，且是用户的模板', () => {
    const merged = toSearchEngines([USER_GH], getAllSearchEngines())
    const ghEngines = merged.filter((e) => e.prefix.toLowerCase() === '!gh')
    expect(ghEngines).toHaveLength(1)
    expect(ghEngines[0]).toMatchObject({
      id: 'quicklink:my-gh',
      name: '我的 GitHub 镜像站',
      searchUrl: 'https://github.example.com/search?q={q}',
    })
    expect(merged[0]).toBe(ghEngines[0])
  })

  it('命中走用户模板，不是内置 github.com', () => {
    const merged = toSearchEngines([USER_GH], getAllSearchEngines())
    expect(matchSearchShortcut('!gh react', merged).directUrl).toBe(
      'https://github.example.com/search?q=react',
    )
    // 没被覆盖的内置引擎照常工作
    expect(matchSearchShortcut('!npm lodash', merged).directUrl).toBe(
      'https://www.npmjs.com/search?q=lodash',
    )
  })

  it('无 quicklink 时合并列表与 getAllSearchEngines 一致', () => {
    expect(toSearchEngines([], getAllSearchEngines())).toEqual(getAllSearchEngines())
  })
})
