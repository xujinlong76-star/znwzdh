import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * Rollup 换官方多色版（2026-11-17，用户 17:24 拍板，质量审计 §2-3）。
 *
 * 旧图为 Simple Icons 单色版 rollupdotjs.svg（710 B，24×24，卷轴白色）；
 * 官网现用卷轴为橙黄渐变。官网 favicon https://rollupjs.org/favicon.png
 * 实测 200、image/png、5,197 B、md5 b1764806cfa631afce46d49c29776c8b，
 * 128×128 PNG 原样落盘为 rollupdotjs.png（不放大不缩小）。
 * map 键 rollupjs.org 不动，值由 .svg 改为 .png；旧 SVG 已 git rm。
 * href 与标题按 navigation.json 核对：https://rollupjs.org / Rollup。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://rollupjs.org', title: 'Rollup', expected: '/brand-icons/rollupdotjs.png' },
]

const LOCAL_ASSETS = ['rollupdotjs.png']

function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR：8 字节签名 + 4 字节长度 + 'IHDR'，其后大端宽高各 4 字节。
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（Rollup 换官方多色版）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：rollupdotjs.png 为官网源 128×128 PNG 原样', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(pngSize(readFileSync(`${dir}rollupdotjs.png`))).toEqual({ width: 128, height: 128 })
  })

  it('旧 Simple Icons 单色版已删除', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}rollupdotjs.svg`)).toBe(false)
  })
})
