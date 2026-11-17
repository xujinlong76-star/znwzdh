import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复第二批 2b 之开发设计类回归（2026-11-17，进化轮）。
 *
 * 背景：第一批 + 2a 之后仍有 38 站显示渐变字母（研究笔记
 * icon-batch2-research-2026-11-17-0101.md §1：48 站剩余，2a 修了
 * 18 站）。2b 之开发设计类修其中 10 站的站方自有图标（本地落盘，
 * 与第一批/2a 同款做法）。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 * 全部 10 站的 href 与标题均按 navigation.json（342 站）逐个核对，
 * 不可猜。Naive UI 的远程路径含构建 hash、IETF 的路径含版本段
 * 12.83.2，均已下载本地化钉死，不可热链；SegmentFault 的 CDN 无
 * Referer 回 403，下载时带 Referer 且已本地化，不可热链。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://www.codegeex.cn', title: 'CodeGeeX', expected: '/brand-icons/codegeex.png' },
  { url: 'https://coding.net', title: 'Coding', expected: '/brand-icons/coding.ico' },
  { url: 'https://element-plus.org', title: 'Element Plus', expected: '/brand-icons/element-plus.svg' },
  { url: 'https://www.naiveui.com', title: 'Naive UI', expected: '/brand-icons/naiveui.svg' },
  { url: 'https://go-zero.dev/', title: 'Go Zero', expected: '/brand-icons/go-zero.svg' },
  { url: 'https://coolors.co', title: 'Coolors', expected: '/brand-icons/coolors.png' },
  { url: 'https://squoosh.app', title: 'Squoosh', expected: '/brand-icons/squoosh.png' },
  { url: 'https://segmentfault.com', title: 'SegmentFault', expected: '/brand-icons/segmentfault.png' },
  { url: 'https://gogs.io/getting-started/introduction', title: 'Gogs', expected: '/brand-icons/gogs.png' },
  { url: 'https://datatracker.ietf.org/', title: 'IETF RFC 搜索', expected: '/brand-icons/ietf.png' },
]

const LOCAL_ASSETS = [
  'codegeex.png',
  'coding.ico',
  'element-plus.svg',
  'naiveui.svg',
  'go-zero.svg',
  'coolors.png',
  'squoosh.png',
  'segmentfault.png',
  'gogs.png',
  'ietf.png',
]

describe('resolveSiteIcon（图标修复第二批 2b 之开发设计类）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：SVG 以 <svg> 开头、PNG 以魔数开头、ICO 以 00 00 01 00 开头', () => {
    // 2026-11-17：10 个文件均由 curl 重新验证后落盘（200 + image MIME +
    // 魔数 + 尺寸与研究笔记逐个相符）。此断言把“落盘的是真图片而非
    // HTML 壳页/403 页”钉死——SegmentFault 的 CDN 无 Referer 回 403，
    // 若将来有人误用热链地址重新下载，拿到的就是 HTML 而非 PNG。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['element-plus.svg', 'naiveui.svg', 'go-zero.svg']) {
      const svg = readFileSync(`${dir}${name}`, 'utf8')
      expect(svg.startsWith('<svg'), name).toBe(true)
    }
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of ['codegeex.png', 'coolors.png', 'squoosh.png', 'segmentfault.png', 'gogs.png', 'ietf.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
    const ico = readFileSync(`${dir}coding.ico`)
    expect(ico.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])), 'coding.ico').toBe(true)
  })
})
