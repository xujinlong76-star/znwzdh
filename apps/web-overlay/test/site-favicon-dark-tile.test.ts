import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  LOGO_TILE_CLASSES,
  LOGO_TILE_MAP,
  resolveLogoTile,
  resolveSiteIcon,
} from '../src/components/site-favicon'

/**
 * 深色底块统一处理回归（2026-11-17，进化轮）。
 *
 * 背景：图标透明底直出，黑标/黑字标在深色模式下消失、白字标在浅色模式
 * 下消失。此前每轮都是“落地、不做特殊处理、留待统一轮”，本轮一次性还：
 * 按 logo 亮/暗属性给固定底块（LOGO_TILE_MAP + resolveLogoTile +
 * LOGO_TILE_CLASSES），先例是 Cursor 的 bg-muted/40 芯片。
 *
 * 每站形态证据（本轮亲手实测，见轮次笔记
 * evolution-round-2026-11-17-1122.md §1）：Ollama/SourceHut 为
 * fill #000000 的 SI 黑标；天音不透明像素均值亮度 10（黑字透明底）；
 * Notion 自带白底圆角方块（tile 为冗余加固）；Radix 为黑方块 + 白字形；
 * Haiper 为白字 wordmark（本地 SVG 的 fill 已钉死 #ffffff）。
 * Luma 自带白底（白像素 73%），不在点名清单内，不进 map。
 *
 * 这个测试直接执行 resolveLogoTile / resolveSiteIcon：map 键写错一个字符
 * 都不会报错，只会静默回落无底块——只有跑起来才看得见。
 */

const LIGHT_CASES: Array<{ url: string; title: string }> = [
  { url: 'https://ollama.com', title: 'Ollama' },
  { url: 'https://www.ollama.com', title: 'Ollama' },
  { url: 'https://sourcehut.org', title: 'SourceHut' },
  { url: 'https://www.notion.com', title: 'Notion' },
  { url: 'https://www.radix-ui.com', title: 'Radix UI' },
  { url: 'https://tianyin.163.com/', title: '网易天音' },
  // 2026-11-17 追加：极客公园方形标（100×100 黑底白 G）给浅色块——
  // 像素实测 10000/10000 不透明、中位亮度 9，黑底方块在深色下与底色
  // 相融，白底块是它在深色下可读的唯一保障（与 Ollama 黑标同款处理）。
  { url: 'https://www.geekpark.net', title: '极客公园' },
  { url: 'https://geekpark.net', title: '极客公园' },
]

const DARK_CASES: Array<{ url: string; title: string }> = [
  { url: 'https://haiper.ai', title: 'Haiper' },
  { url: 'https://www.haiper.ai', title: 'Haiper' },
]

const NO_TILE_CASES: Array<{ url: string | undefined; title: string }> = [
  { url: 'https://dribbble.com', title: 'Dribbble' },
  { url: 'https://www.cursor.com', title: 'Cursor' },
  { url: 'https://example.com', title: 'Example' },
  { url: undefined, title: 'No URL' },
  { url: '', title: 'Empty URL' },
]

describe('resolveLogoTile（深色底块统一处理）', () => {
  it.each(LIGHT_CASES)('$title（$url）给浅色块', ({ url }) => {
    expect(resolveLogoTile(url)).toBe('light')
  })

  it.each(DARK_CASES)('$title（$url）给深色块', ({ url }) => {
    expect(resolveLogoTile(url)).toBe('dark')
  })

  it.each(NO_TILE_CASES)('$title（$url）不给块', ({ url }) => {
    expect(resolveLogoTile(url)).toBeNull()
  })

  it('子域名后缀匹配：app.ollama.com 同样给浅色块', () => {
    expect(resolveLogoTile('https://app.ollama.com')).toBe('light')
  })

  it('底块 class 是主题无关固定色：浅色块纯白、深色块 neutral-900，且不含 dark: 变体', () => {
    // 固定底色是“浅/深模式同一块、对比度恒定”的关键——若有人改成
    // dark: 变体，两种主题下的对比度保证就丢了，此断言把它钉死。
    expect(LOGO_TILE_CLASSES.light).toContain('bg-white')
    expect(LOGO_TILE_CLASSES.dark).toContain('bg-neutral-900')
    expect(LOGO_TILE_CLASSES.light).not.toContain('dark:')
    expect(LOGO_TILE_CLASSES.dark).not.toContain('dark:')
    expect(LOGO_TILE_CLASSES.light).toContain('p-0.5')
    expect(LOGO_TILE_CLASSES.dark).toContain('p-0.5')
  })

  it('map 只含点名清单的 7 站：Luma（自带白底）不在内；极客公园 2026-11-17 由“暂缓”改为落地（见下）', () => {
    expect(Object.keys(LOGO_TILE_MAP).sort()).toEqual([
      'geekpark.net',
      'haiper.ai',
      'notion.com',
      'ollama.com',
      'radix-ui.com',
      'sourcehut.org',
      'tianyin.163.com',
    ])
  })
})

describe('resolveSiteIcon（深色底块轮：Haiper 落地、极客公园暂缓）', () => {
  it('Haiper 解析到本地 SVG', () => {
    expect(resolveSiteIcon('https://haiper.ai', 'Haiper')).toBe('/brand-icons/haiper.svg')
    expect(resolveSiteIcon('https://www.haiper.ai', 'Haiper')).toBe('/brand-icons/haiper.svg')
  })

  it('极客公园落地：方形标可读，解析到本地 PNG + 浅色底块（暂缓前提已被推翻）', () => {
    // 改写原因（R7）：上轮“暂缓”是因只有 1361x261 白字宽版（24px 卡片
    // 内只剩 3.8px、比渐变字母更差）；并行研究线找到站方 /about 页 head
    // 三重官方指定的方形标 geekpark-icon-196-black.png（curl 200、3705B、
    // 实测 100×100 黑底白 G、全像素不透明），24/36/64 三档均可读，暂缓
    // 前提已不存在。宽版仍不进 map，详情页大尺寸特判也不做。
    expect(resolveSiteIcon('https://www.geekpark.net', '极客公园')).toBe('/brand-icons/geekpark.png')
    expect(resolveSiteIcon('https://geekpark.net', '极客公园')).toBe('/brand-icons/geekpark.png')
    expect(resolveLogoTile('https://www.geekpark.net')).toBe('light')
    expect(resolveLogoTile('https://geekpark.net')).toBe('light')
  })

  it('极客公园本地 PNG 落盘：PNG 魔数、100×100、黑底白 G（像素实测）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const path = `${dir}geekpark.png`
    expect(existsSync(path), 'geekpark.png').toBe(true)
    const buf = readFileSync(path)
    // PNG 魔数 + 文件体与研究线实测一致（3705B，允许重压后小幅浮动）。
    // 注意：subarray 返回 Buffer，须与 Buffer.from 比较（Uint8Array 字面
    // 量在 vitest 的 toEqual 里会被判为不同类型，字节相同也会失败）。
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    expect(buf.length).toBeGreaterThan(1024)
    expect(buf.length).toBeLessThan(10 * 1024)
    // IHDR：宽高 100×100、位深 8、颜色类型 3（colormap，与 file 实测一致）
    expect(buf.readUInt32BE(16)).toBe(100)
    expect(buf.readUInt32BE(20)).toBe(100)
    expect(buf[24]).toBe(8)
    expect(buf[25]).toBe(3)
  })

  it('Haiper 本地 SVG 落盘：白字钉死、无 currentColor 残留、可渲染', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const path = `${dir}haiper.svg`
    expect(existsSync(path), 'haiper.svg').toBe(true)
    const svg = readFileSync(path, 'utf8')
    expect(svg.trimStart().startsWith('<!--')).toBe(true)
    expect(svg).toContain('<svg')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    // 7 条 path 的 fill 全部钉死 #ffffff（原跟随文字颜色）；残留一处
    // currentColor 都会让深色底块上的字在浅色模式下变黑、不可读。
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).not.toContain('currentColor')
    expect(svg.length).toBeLessThan(10 * 1024)
  })
})
