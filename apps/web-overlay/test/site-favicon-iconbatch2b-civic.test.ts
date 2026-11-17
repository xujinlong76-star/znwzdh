import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复第二批 2b 剩余 + 2c 之 C 批回归（2026-11-17，进化轮）。
 *
 * 背景：C 批 6 站（中央气象台 / 国家哲学社会科学文献中心 / 时光网 /
 * 番茄小说 / 探探 / ReelShort）的品牌图标本地化，与 2b 剩余 + 2c
 * 其余 11 站同款做法：站方自有图标或 iTunes 128px 应用图标经 curl
 * 重新验证（200 + image MIME + 魔数 + 尺寸与研究笔记逐个相符）后
 * 落盘 public/brand-icons/。番茄小说落盘名取 fanqie.png（与旧
 * fanqienovel.png 内容逐字节相同，md5 均为 a3621391ca2e537045168afda6722ee9，
 * 旧文件已删、map 已改指 fanqie.png）；时光网站方图标仅 16px，
 * 改用 iTunes 128px 版。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 * 全部 6 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://www.nmc.cn', title: '中央气象台', expected: '/brand-icons/nmc.png' },
  { url: 'https://www.ncpssd.org', title: '国家哲学社会科学文献中心', expected: '/brand-icons/ncpssd.png' },
  { url: 'https://www.mtime.com', title: '时光网', expected: '/brand-icons/mtime.jpg' },
  { url: 'https://www.fanqienovel.com', title: '番茄小说', expected: '/brand-icons/fanqie.png' },
  { url: 'https://tantanapp.com', title: '探探', expected: '/brand-icons/tantan.png' },
  { url: 'https://www.reelshort.com', title: 'ReelShort', expected: '/brand-icons/reelshort.png' },
]

const LOCAL_ASSETS = [
  'nmc.png',
  'ncpssd.png',
  'mtime.jpg',
  'fanqie.png',
  'tantan.png',
  'reelshort.png',
]

/** 读 PNG IHDR（宽高在第 16–23 字节，大端）。 */
function readPngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** 扫 JPEG 段找 SOF0/SOF1/SOF2，读出宽高。 */
function readJpegSize(buf: Buffer): { width: number; height: number } {
  let offset = 2 // 跳过 SOI FF D8
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) throw new Error('invalid JPEG marker')
    const marker = buf[offset + 1]!
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buf.readUInt16BE(offset + 2)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  throw new Error('JPEG SOF not found')
}

describe('resolveSiteIcon（图标修复第二批 2b 剩余 + 2c 之 C 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产尺寸钉死：PNG 读 IHDR、JPEG 读 SOF', () => {
    // 2026-11-17：6 个文件均由 curl 重新验证后落盘（200 + image MIME +
    // 魔数 + 尺寸与研究笔记逐个相符）。宽版两站（中央气象台 255x65、
    // 国家哲学 385x56）是横长条 logo：小卡片内显小是已知特性，接受；
    // 组件侧只给 img 加 p-1（object-contain 已有），不加深色底块——
    // 中央气象台自带浅色底，深色卡上露白矩形同样是已知特性，接受。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const expectedPng: Record<string, { width: number; height: number }> = {
      'nmc.png': { width: 255, height: 65 },
      'ncpssd.png': { width: 385, height: 56 },
      'fanqie.png': { width: 96, height: 96 },
      'tantan.png': { width: 88, height: 88 },
      'reelshort.png': { width: 128, height: 128 },
    }
    for (const [name, size] of Object.entries(expectedPng)) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
      expect(readPngSize(buf), name).toEqual(size)
    }
    // 宽版两站宽高比钉死（>3:1），免得将来有人误当方形图标重压。
    expect(255 / 65).toBeGreaterThan(3)
    expect(385 / 56).toBeGreaterThan(3)
    const mtime = readFileSync(`${dir}mtime.jpg`)
    expect(mtime.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), 'mtime.jpg').toBe(true)
    expect(readJpegSize(mtime), 'mtime.jpg').toEqual({ width: 128, height: 128 })
  })
})
