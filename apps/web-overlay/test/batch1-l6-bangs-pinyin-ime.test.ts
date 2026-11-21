/**
 * Batch 1 L6 整合 · 04 命令面板收尾测试（bangs + 拼音接线 + IME 接线）。
 *
 * 覆盖方案 §9 验收 B1–B4（纯函数层）与 §1.4 拼音第二通道接线、§5 IME
 * 三件套的接线守卫：
 *  - bangs：三种写法同一引擎、未知前缀信号、`/gh` 不解析、模板无占位符；
 *  - 拼音：`matchSuggestionTextWithPinyin`（无键等价旧函数、有键走第二通道）、
 *    §6 总分的 name 字段拼音分、收藏夹拼音召回（环境自适应：拼音库未装好
 *    时回落旧匹配，不断言加载本身——加载成功与否由 W5 测试覆盖）；
 *  - IME / 明示行 / 薄壳：组件挂载测不了（node 环境无 jsdom，见
 *    quicklinks-wiring.test.ts），按仓库既有做法锁源码接线确实存在。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { matchQuicklinkCommand } from '../src/lib/quicklinks'
import {
  fieldMatchScore,
  getPinyinKeysForTitle,
  matchPaletteFavorites,
  matchPaletteQuicklinks,
  scoreLocalRow,
  sortLocalRowsByScore,
} from '../src/lib/palette-actions'
import { ensurePinyinLoaded, matchPinyin, type PinyinKeys } from '../src/lib/palette-pinyin'
import {
  matchSuggestionText,
  matchSuggestionTextWithPinyin,
} from '../src/lib/search-suggestions'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 手写键：pyFull=daohang（导航），pyFirst=dh，多音展开含 dao/hang/xing。 */
const NAV_KEYS: PinyinKeys = {
  pyFull: 'daohang',
  pyFirst: 'dh',
  polyphonic: ['dao', 'hang', 'xing'],
}

describe('bangs 收敛（04 §2.1/§2.2/§2.3，B1–B4）', () => {
  it('B1：!gh/@gh/gh 三种写法命中同一引擎、同一 URL', () => {
    const expected = {
      kind: 'hit',
      entry: expect.objectContaining({ quickPrefix: 'gh', title: 'GitHub' }),
      arg: 'react',
      url: 'https://github.com/search?q=react',
    }
    expect(matchQuicklinkCommand('!gh react', [])).toEqual(expected)
    expect(matchQuicklinkCommand('@gh react', [])).toEqual(expected)
    expect(matchQuicklinkCommand('gh react', [])).toEqual(expected)
  })

  it('B2：未知前缀返 unknown-prefix 信号（调用方明示、Enter 走普通搜索）', () => {
    expect(matchQuicklinkCommand('!zzz react', [])).toEqual({
      kind: 'unknown-prefix',
      prefix: 'zzz',
      arg: 'react',
    })
    // 未完成形态不判未知：裸前缀无参数、! 形态无参数都不闪提示
    expect(matchQuicklinkCommand('zzz', [])).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('!zzz', [])).toEqual({ kind: 'none' })
  })

  it('B3：/gh react 不解析（裁决 D2），按普通查询处理', () => {
    expect(matchQuicklinkCommand('/gh react', [])).toEqual({ kind: 'none' })
    expect(matchQuicklinkCommand('/g react', [])).toEqual({ kind: 'none' })
  })

  it('B4：模板无占位符返 bad-template；matchPaletteQuicklinks 不出坏行', () => {
    const bad = {
      siteId: 'bad',
      title: '坏模板',
      href: 'https://example.com/',
      quickPrefix: 'bad',
      templateUrl: 'https://example.com/search',
    }
    expect(matchQuicklinkCommand('!bad x', [bad])).toEqual({
      kind: 'bad-template',
      entry: bad,
      arg: 'x',
    })
    expect(matchPaletteQuicklinks('!bad x', [bad])).toEqual([])
  })

  it('内置引擎进 quicklink 行：!gh react 无用户收藏时仍出一条', () => {
    const items = matchPaletteQuicklinks('!gh react', [])
    expect(items).toHaveLength(1)
    expect(items[0]!.url).toBe('https://github.com/search?q=react')
    expect(matchPaletteQuicklinks('!zzz react', [])).toEqual([])
  })
})

describe('拼音第二通道接线（04 §1.4）', () => {
  it('无键时等价旧函数：旧行为一字不改', () => {
    expect(matchSuggestionTextWithPinyin('导航', '导航站')).toBe(
      matchSuggestionText('导航', '导航站'),
    )
    expect(matchSuggestionTextWithPinyin('dh', '导航')).toBe(false)
    expect(matchSuggestionTextWithPinyin('react', 'React Hooks')).toBe(true)
    expect(matchSuggestionTextWithPinyin('xyz', 'React Hooks')).toBe(false)
  })

  it('有键时拉丁查询走拼音通道：dh/daohang 命中导航键，xyz 不命中', () => {
    expect(matchSuggestionTextWithPinyin('dh', '导航', NAV_KEYS)).toBe(true)
    expect(matchSuggestionTextWithPinyin('daohang', '导航', NAV_KEYS)).toBe(true)
    expect(matchSuggestionTextWithPinyin('xyz', '导航', NAV_KEYS)).toBe(false)
    // 中文查询不进拼音通道（matchPinyin 直接返 0），只走旧路径
    expect(matchPinyin('导航', NAV_KEYS)).toBe(0)
    expect(matchSuggestionTextWithPinyin('导航', '导航', NAV_KEYS)).toBe(true)
  })

  it('§6 总分：name 字段取文本分与拼音分的较高者', () => {
    const fields = { name: '导航', keywords: '', subtitle: '' }
    expect(scoreLocalRow('dh', fields)).toBe(0)
    expect(scoreLocalRow('dh', fields, 0, NAV_KEYS)).toBe(0.5)
    expect(fieldMatchScore('dh', '导航', NAV_KEYS)).toBe(1)
  })

  it('本地行排序：拼音命中的行凭 name 分顶到前面', () => {
    const rows = [
      { name: '其他', keywords: '', subtitle: '' },
      { name: '导航', keywords: '', subtitle: '' },
    ]
    const sorted = sortLocalRowsByScore(
      'dh',
      rows,
      (r) => ({ name: r.name, keywords: r.keywords, subtitle: r.subtitle }),
      () => 0,
      (r) => (r.name === '导航' ? NAV_KEYS : undefined),
    )
    expect(sorted[0]!.name).toBe('导航')
  })

  it('收藏夹拼音召回（环境自适应）：库加载好时 dh 命中「导航」，否则回落旧匹配', async () => {
    const favs = [
      {
        siteId: 'nav-daohang',
        title: '导航',
        href: 'https://example.com/',
        description: '',
        tags: [],
      },
    ]
    const loaded = await ensurePinyinLoaded()
    const keys = getPinyinKeysForTitle('导航')
    if (loaded) {
      expect(keys).toBeDefined()
      expect(matchPaletteFavorites('dh', favs)).toHaveLength(1)
    } else {
      // 未加载时 getPinyinKeysForTitle 返 undefined、不抛错，matcher 回落旧匹配
      expect(keys).toBeUndefined()
      expect(matchPaletteFavorites('dh', favs)).toHaveLength(0)
    }
  })
})

describe('IME 三件套与明示行接线守卫（04 §5/§2.2，源码守卫）', () => {
  it('search-palette：onSearchKeyDown 顶部有 composing 守卫，且早于 aiMode 分支', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    const guardAt = src.indexOf('if (e.nativeEvent.isComposing || e.keyCode === 229) return')
    expect(guardAt).toBeGreaterThan(-1)
    const aiAt = src.indexOf("if (e.key === 'Enter' && aiMode)", guardAt)
    expect(aiAt).toBeGreaterThan(guardAt)
  })

  it('search-palette：Input 有 compositionstart/end，组词期不清空旧结果、完成后跳过防抖', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    expect(src).toContain('onCompositionStart')
    expect(src).toContain('onCompositionEnd')
    expect(src).toContain('isComposingRef.current = true')
    expect(src).toContain('isComposingRef.current = false')
    expect(src).toContain('skipDebounceRef.current = true')
    expect(src).toContain('const delay = skipDebounceRef.current ? 0 : 200')
    expect(src).toContain('if (isComposingRef.current) {')
  })

  it('search-palette：未知前缀与模板无占位符两行明示文案一字不差', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    expect(src).toContain('未找到前缀 “{quicklinkMatch.prefix}”，按 Enter 按普通搜索')
    expect(src).toContain('快捷链接模板缺少占位符，无法填入查询词')
  })

  it('search-palette：parseOmniCommand 是薄壳（只调 matchQuicklinkCommand，无正则、无引擎表）', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    expect(src).toContain('const hit = matchQuicklinkCommand(raw, [])')
    expect(src).not.toContain('export const OMNI_ENGINES')
    const start = src.indexOf('export function parseOmniCommand')
    const end = src.indexOf('\n}\n', start)
    const body = src.slice(start, end)
    expect(body).not.toContain('match(/')
    expect(body).not.toContain('OMNI_ENGINES')
  })

  it('B6：全仓唯一引擎表在 quicklinks.ts（DEFAULT_QUICKLINK_ENTRIES，9 键）', () => {
    const src = overlaySource('src/lib/quicklinks.ts')
    expect(src).toContain('export const DEFAULT_QUICKLINK_ENTRIES')
    for (const prefix of ['g', 'google', 'gh', 'github', 'npm', 'bing', 'mdn', 'baidu', 'bd']) {
      expect(src).toContain(`quickPrefix: '${prefix}'`)
    }
    const palette = overlaySource('src/components/search-palette.tsx')
    expect(palette).not.toContain('export const OMNI_ENGINES')
  })

  it('search-palette：拼音触发加载只在拉丁查询 + 面板打开时', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    expect(src).toContain('if (!isLatinQuery(query)) return')
    expect(src).toContain('void ensurePinyinLoaded().then((ok) => {')
    expect(src).toContain('if (!cancelled && ok) setPinyinReady(true)')
  })
})
