/**
 * Batch 1 W6 PoC：本地行排序（04 §6）——`scoreLocalRow` / `sortLocalRowsByScore`。
 *
 * 验收：本地行总分公式 0.5*nameMatch + 0.3*keywordsMatch + 0.2*subtitleMatch
 * + 0.15*mruNorm；keywords 按 /\s+/ 切分（不按逗号）；服务端 hits 的 RRF
 * 排名不动（C3 lib 层：`buildPaletteNavItems` 保序 + 组件仍原样传 siteIds，
 * 后者见 batch1-w6-hotkey-badge.test.ts 的源码守卫）。
 *
 * 拼音分计入 nameMatch：本 PoC 不含拼音层（`palette-pinyin.ts` 另有 worker），
 * nameMatch 现按标题原文计分，拼音接线后同一槽位由 `matchPinyin` 供分。
 */
import { describe, expect, it } from 'vitest'

import {
  buildPaletteNavItems,
  fieldMatchScore,
  matchPaletteActions,
  matchPaletteFavorites,
  matchPaletteTools,
  scoreLocalRow,
  type PaletteFavoriteLike,
} from '@/lib/palette-actions'
import { mruScore, type RecentVisit } from '../src/lib/offline-recent'

const OPTS = { isDark: false, elderOn: false, densityLabel: '舒适' }

const DAY = 86400000
const NOW = Date.parse('2026-11-20T12:00:00Z')
const LIBRARY_START = NOW - 30 * DAY

const visit = (id: string, visitedAt: number, extra: Partial<RecentVisit> = {}): RecentVisit => ({
  id,
  title: `站点 ${id}`,
  href: `https://example.com/${id}`,
  visitedAt,
  ...extra,
})

describe('scoreLocalRow（§6 总分公式）', () => {
  it('三字段权重：仅 name 命中 0.5、仅 keywords 0.3、仅 subtitle 0.2、三者全中 1.0、都不中 0', () => {
    expect(scoreLocalRow('主题', { name: '主题', keywords: '深色 浅色', subtitle: '点一下' })).toBe(0.5)
    expect(scoreLocalRow('主题', { name: '深色模式', keywords: '主题', subtitle: '点一下' })).toBe(0.3)
    expect(scoreLocalRow('主题', { name: '深色模式', keywords: '深色', subtitle: '这是主题设置' })).toBe(0.2)
    expect(scoreLocalRow('主题', { name: '主题', keywords: '主题', subtitle: '主题' })).toBe(1)
    expect(scoreLocalRow('主题', { name: '深色模式', keywords: '深色', subtitle: '点一下' })).toBe(0)
  })

  it('字段分是命中 token 的比例：多词查询只中一半时 nameMatch = 0.5', () => {
    expect(fieldMatchScore('切换 主题', '切换到深色模式')).toBe(0.5)
    expect(scoreLocalRow('切换 主题', { name: '切换到深色模式', keywords: '深色', subtitle: '点一下' })).toBe(0.25)
  })

  it('keywords 按空白切分：罗马化词 zhuti 在「主题 zhuti」里命中（逗号切分会漏）', () => {
    expect(fieldMatchScore('zhuti', '主题 zhuti')).toBe(1)
    expect(scoreLocalRow('zhuti', { name: '深色模式', keywords: '主题 zhuti', subtitle: '点一下' })).toBe(0.3)
  })

  it('MRU 项：mruNorm 1 加 0.15；天花板 mruNorm≈1.9768 时加 ≈0.2965', () => {
    const base = { name: '主题', keywords: '深色', subtitle: '点一下' }
    expect(scoreLocalRow('主题', base, 1)).toBeCloseTo(0.65, 4)
    expect(scoreLocalRow('主题', base, 1.9768)).toBeCloseTo(0.7965, 4)
    expect(scoreLocalRow('主题', base)).toBe(0.5)
  })
})

describe('match* 按总分排序（不只过滤）', () => {
  it('「切换」：三字段全中的密度行（1.0）排在只中两字段的主题行（0.8）之前', () => {
    expect(matchPaletteActions('切换', OPTS).map((a) => a.id)).toEqual(['density', 'theme'])
  })

  it('「切换主题」：只有主题行通过过滤；打分上主题（0.3）高于密度（0）', () => {
    // 「切换主题」中间无空格，是单个 token：主题行 keywords 里有「切换主题」
    // 原串（0.3），密度行三字段里都没有（0）；密度行不是排后，是根本不出现。
    expect(matchPaletteActions('切换主题', OPTS).map((a) => a.id)).toEqual(['theme'])
    expect(
      scoreLocalRow('切换主题', {
        name: '切换到深色模式',
        keywords: '主题 深色 浅色 切换主题 换肤 夜间模式 zhuti theme dark light',
        subtitle: '当前浅色，点一下进入深色',
      }),
    ).toBe(0.3)
    expect(
      scoreLocalRow('切换主题', {
        name: '切换卡片密度（当前：舒适）',
        keywords: '密度 卡片密度 切换密度 紧凑 舒适 宽松 midu density',
        subtitle: '紧凑 / 舒适 / 宽松三档循环切换，立即生效',
      }),
    ).toBe(0)
  })

  it('「哈希」：hash-detect（1.0）在 hash-calc（0.8）之前', () => {
    expect(matchPaletteTools('哈希').map((t) => t.id)).toEqual(['hash-detect', 'hash-calc'])
    expect(
      scoreLocalRow(
        '哈希',
        { name: '哈希指纹识别', keywords: '哈希 指纹 识别 摘要 hash haxi 工具', subtitle: '填入示例摘要，即时识别是哪种哈希算法' },
      ),
    ).toBe(1)
    expect(
      scoreLocalRow(
        '哈希',
        { name: '哈希计算', keywords: '哈希 计算 摘要 MD5 SHA hash haxi 工具', subtitle: '填入 md5: 文本，即时算出摘要' },
      ),
    ).toBe(0.8)
  })

  it('收藏行：无 MRU 时保持输入顺序；有 MRU 加分时被顶上去的行翻到前面', () => {
    const favs: PaletteFavoriteLike[] = [
      { siteId: 'a', title: 'GitHub 镜像站 A', href: 'https://example.com/a' },
      { siteId: 'b', title: 'GitHub 镜像站 B', href: 'https://example.com/b' },
    ]
    expect(matchPaletteFavorites('github', favs).map((f) => f.siteId)).toEqual(['a', 'b'])
    expect(
      matchPaletteFavorites('github', favs, { mruNormBySiteId: new Map([['b', 1.5]]) }).map((f) => f.siteId),
    ).toEqual(['b', 'a'])
  })
})

describe('buildPaletteNavItems 保序（C3：服务端 hits 的 RRF 排名不动）', () => {
  it('分组顺序与组内顺序都与传入一致，站点组不重排', () => {
    const items = buildPaletteNavItems({
      suggestionIds: ['suggestion-a'],
      quicklinkIds: ['quicklink-gh'],
      diyIds: ['diy-x'],
      sceneIds: ['scene-s'],
      favoriteIds: ['favorite-f'],
      actionIds: ['action-theme'],
      toolIds: ['tool-json'],
      pluginIds: ['plugin-p'],
      siteIds: ['site-x', 'site-y', 'site-z'],
    })
    expect(items.map((i) => i.id)).toEqual([
      'suggestion-a',
      'quicklink-gh',
      'diy-x',
      'scene-s',
      'favorite-f',
      'action-theme',
      'tool-json',
      'plugin-p',
      'site-x',
      'site-y',
      'site-z',
    ])
    expect(items.map((i) => i.kind)).toEqual([
      'suggestion',
      'quicklink',
      'diy',
      'scene',
      'favorite',
      'action',
      'tool',
      'plugin',
      'site',
      'site',
      'site',
    ])
  })
})

describe('P-c 初步观察：权重 0.15 在本站量级上只做平局打破', () => {
  it('误点站（当天 1 次）与 3 天前 20 次站的 MRU 贡献只差 0.0056，匹配分说了算', () => {
    const misClick = mruScore(visit('misclick', NOW, { count: 1 }), NOW, LIBRARY_START) / 100
    const heavy = mruScore(visit('heavy', NOW - 3 * DAY, { count: 20 }), NOW, LIBRARY_START) / 100
    expect(misClick).toBeCloseTo(0.8933, 3)
    expect(heavy).toBeCloseTo(0.856, 3)
    expect(0.15 * misClick - 0.15 * heavy).toBeCloseTo(0.0056, 3)
    // 天花板：当天 50 次、建库 1 天的站，mruNorm ≈ 1.9768，贡献 ≈ 0.2965——
    // 能翻盘 0.2 以内的匹配分差（如 subtitle-only 0.2 vs keywords-only 0.3），
    // 翻不动 0.5 的字段权重差（如 name-only 0.5 vs keywords-only 0.3）。
    const max = mruScore(visit('max', NOW, { count: 50 }), NOW, NOW) / 100
    expect(max).toBeCloseTo(1.9768, 3)
    expect(0.15 * max).toBeCloseTo(0.2965, 3)
  })
})
