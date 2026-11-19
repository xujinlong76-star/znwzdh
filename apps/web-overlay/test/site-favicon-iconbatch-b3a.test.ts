import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * B 类第 5 批之 B3a（2026-11-17）：Luma AI、Radix UI、Notion、freeCodeCamp
 * 4 站热链本地化回归。
 *
 * 背景：B 类基线（icon-b-baseline-2026-11-17.md）核查 23 站全部为远程
 * 热链，无一站本地化。本批修第 5 批（P1-热链本地化-3）前 4 站：
 * lumalabs.ai / radix-ui.com / notion.com 三键原地替换旧热链值，
 * freecodecamp.org 新建键（须与 navigation.json.patch 同提交删 icon 行，
 * 否则 customIcon 截胡，见 R1 裁决）。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 * 全部 4 站的 href / title / icon 均按 navigation.json（349 站，
 * HEAD 803efd91）逐个核对，不可猜。本测试传三参数（url, title,
 * customIcon）复现真实解析链：Luma / Radix / Notion 的 icon 均为
 * `…/favicon.ico` 形式，会被 `isRemoteRawFavicon` 拦截，map 正常生效；
 * freeCodeCamp 的旧 icon 不被拦截，须先清 icon 行（R1），故主用例传
 * `customIcon: undefined`，另以机制断言钉死旧 hotlink 在场仍会胜出。
 *
 * 来源（2026-11-17 逐站 curl 复验，200 + image MIME + 魔数 + md5）：
 * - Luma AI：https://luma.ai/favicon.ico（lumalabs.ai/favicon.ico 已 404，
 *   改用 luma.ai 备用域名同名 favicon；ICO 15086B，3 帧 16/32/48，取最大帧
 *   48x48 转 PNG 1322B）。白底圆角标，深浅双主题可见。
 * - Radix UI：https://www.radix-ui.com/favicon-black.svg（首页声明的两个
 *   icon 之一，另一为 48x48 PNG；SVG 262B 原样落盘，viewBox 0 0 35 35，
 *   fill #1C2024 近黑标）。favicon.ico / favicon.svg / apple-touch-icon
 *   均 404。近黑透明底标与 Ollama / SourceHut 同款处理：只加普通 map
 *   条目，不做白底色块；深色模式对比度弱是已知局限，留待统一处理轮。
 * - Notion：https://www.notion.so/images/favicon.ico（notion.com/favicon.ico
 *   已 404；ICO 32038B，4 帧 16/32/48/64，取最大帧 64x64 转 PNG 1511B）。
 *   白底圆角标 + 黑色 N，深浅双主题可见。
 * - freeCodeCamp：https://www.freecodecamp.org/icons/icon-96x96.png
 *   （PNG 96x96，3822B，原样落盘不放大）。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://lumalabs.ai/app', title: 'Luma AI', customIcon: 'https://lumalabs.ai/favicon.ico', expected: '/brand-icons/luma.png' },
  { url: 'https://www.radix-ui.com', title: 'Radix UI', customIcon: 'https://www.radix-ui.com/favicon.ico', expected: '/brand-icons/radix-ui.svg' },
  { url: 'https://www.notion.com', title: 'Notion', customIcon: 'https://www.notion.com/favicon.ico', expected: '/brand-icons/notion.png' },
  { url: 'https://www.freecodecamp.org', title: 'freeCodeCamp', customIcon: undefined, expected: '/brand-icons/freecodecamp.png' },
]

const LOCAL_ASSETS = ['luma.png', 'radix-ui.svg', 'notion.png', 'freecodecamp.png']

describe('resolveSiteIcon（B 类第 5 批之 B3a）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('R1 机制钉死：freeCodeCamp 旧 hotlink 若在场仍会胜出——清 icon 行不可省', () => {
    // 若将来 resolveSiteIcon 改为 map 优先于 customIcon，本断言会失败，
    // 届时按新优先级重写本断言；在此之前它证明“清 icon 行”是生效前提。
    expect(
      resolveSiteIcon('https://www.freecodecamp.org', 'freeCodeCamp', 'https://www.freecodecamp.org/icons/icon-96x96.png'),
    ).toBe('https://www.freecodecamp.org/icons/icon-96x96.png')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：SVG 以 <svg> 开头、PNG 以魔数开头', () => {
    // 4 个文件均由 curl 重新验证后落盘（200 + image MIME + 魔数 +
    // 尺寸与轮次笔记逐个相符）。此断言把“落盘的是真图片而非
    // HTML 壳页/403 页”钉死——lumalabs.ai / notion.com 的站方
    // favicon.ico 均已 404，若误用旧地址下载，拿到的就是 HTML。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}radix-ui.svg`, 'utf8')
    expect(svg.startsWith('<svg'), 'radix-ui.svg').toBe(true)
    expect(svg, 'radix-ui.svg viewBox').toContain('viewBox="0 0 35 35"')
    // 事实钉死：Radix 标为近黑标（fill #1C2024，透明底），深色模式下
    // 对比度弱是已知局限（§9 先例），此处不做白底色块。
    expect(svg, 'radix-ui.svg fill').toContain('fill="#1C2024"')
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of ['luma.png', 'notion.png', 'freecodecamp.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
  })

  it('本地光栅资产尺寸钉死：Luma 48x48、Notion 64x64、freeCodeCamp 96x96 原样', () => {
    // 执行清单 §2 / 统一规范 §1.1：ICO 取最大帧转 PNG，小源绝不放大。
    // Luma ICO 最大帧 48x48、Notion ICO 最大帧 64x64、freeCodeCamp 源
    // 96x96 PNG——三站均原样落盘，不压成 128、不放大到 128。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const sizes: Array<[string, number, number]> = [
      ['luma.png', 48, 48],
      ['notion.png', 64, 64],
      ['freecodecamp.png', 96, 96],
    ]
    for (const [name, w, h] of sizes) {
      const buf = readFileSync(`${dir}${name}`)
      // PNG IHDR：宽（bytes 16-19）高（bytes 20-23），大端。
      expect(buf.readUInt32BE(16), `${name} width`).toBe(w)
      expect(buf.readUInt32BE(20), `${name} height`).toBe(h)
    }
  })
})
