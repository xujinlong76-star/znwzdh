import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标 A 类第 2 批前半 a2a（2026-11-17）。
 *
 * 5 站均为审计清单 A 类已确认占位（本地引用 /assets/images/logos/*
 * 但仓库中无此文件，必定显示字母徽标）。本批把占位换成官网现用
 * 真实品牌图标本地化落盘，map 条目见 worktree 根目录 map-block-a2a.txt，
 * 由总装 worker 并入 site-favicon.tsx 的 LOCAL_LOGO_MAP。
 *
 * 全部 5 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 * 尺寸钉死：TinyPNG / Adobe Fonts 为 128×128 PNG；Flaticon 源 ICO
 * 单帧 256×227，等比缩后为 128×114 PNG（thumbnail 只缩小、保宽高比，
 * 非方形源不硬压 128×128）；Google Fonts / Font Awesome 为 SVG 原样落盘。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://tinypng.com', title: 'TinyPNG', expected: '/brand-icons/tinypng.png' },
  { url: 'https://fonts.google.com', title: 'Google Fonts', expected: '/brand-icons/google-fonts.svg' },
  { url: 'https://fontawesome.com', title: 'Font Awesome', expected: '/brand-icons/font-awesome.svg' },
  { url: 'https://www.flaticon.com', title: 'Flaticon', expected: '/brand-icons/flaticon.png' },
  { url: 'https://fonts.adobe.com', title: 'Adobe Fonts', expected: '/brand-icons/adobe-fonts.png' },
]

const LOCAL_ASSETS = [
  'tinypng.png',
  'google-fonts.svg',
  'font-awesome.svg',
  'flaticon.png',
  'adobe-fonts.png',
]

function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR：8 字节签名 + 4 字节长度 + 'IHDR'，其后大端宽高各 4 字节。
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标 A 类第 2 批前半 a2a）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('光栅尺寸钉死：TinyPNG / Adobe Fonts 128×128，Flaticon 128×114', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(pngSize(readFileSync(`${dir}tinypng.png`))).toEqual({ width: 128, height: 128 })
    expect(pngSize(readFileSync(`${dir}adobe-fonts.png`))).toEqual({ width: 128, height: 128 })
    // Flaticon 源 ICO 单帧 256×227（非方形），Pillow thumbnail 等比缩到 128×114，
    // 不硬压 128×128；宽高比与源一致即合规。
    expect(pngSize(readFileSync(`${dir}flaticon.png`))).toEqual({ width: 128, height: 114 })
  })

  it('SVG 原样钉死：Google Fonts / Font Awesome 为官网 favicon SVG', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const gfonts = readFileSync(`${dir}google-fonts.svg`, 'utf8')
    expect(gfonts.startsWith('<svg')).toBe(true)
    // Google Fonts 彩色几何 A：官网 favicon.svg 的品牌色。
    expect(gfonts.includes('#F29900')).toBe(true)
    expect(gfonts.includes('#1A73E8')).toBe(true)
    const fa = readFileSync(`${dir}font-awesome.svg`, 'utf8')
    expect(fa.startsWith('<svg')).toBe(true)
    // Font Awesome 蓝旗标：官网 icon.svg 的品牌色。
    expect(fa.includes('#418FDE')).toBe(true)
  })
})
