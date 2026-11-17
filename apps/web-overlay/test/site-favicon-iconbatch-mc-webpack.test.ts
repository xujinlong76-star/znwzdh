import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标多色版换色 — Webpack（2026-11-17，用户 17:24 拍板 7 张换色之一）。
 *
 * 旧图问题（质量审计 §2-4，2026-11-17）：本地 webpack.svg 628 B 为
 * Simple Icons 单色版，中心立方体为空心/白色；官网现用
 * https://webpack.js.org/icon_192x192.png（192×192，12,207 B）
 * 中心立方体为实心深蓝。图形轮廓一致，仅中心立方体实心/空心不同。
 *
 * 来源核实（本轮重新 curl）：HTTP 200，image/png，12,207 B，
 * md5 4ef916bd6f58cd14754e9eb59e50c9d7，与审计记录字节完全一致。
 * 按规范 §1.2 Pillow LANCZOS 等比缩到 128×128 落盘为 webpack.png
 * （PNG 保持 PNG），旧 webpack.svg 已 git rm。
 *
 * href 与标题按 navigation.json 核对：Webpack，https://webpack.js.org，
 * map 键 webpack.js.org。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://webpack.js.org', title: 'Webpack', expected: '/brand-icons/webpack.png' },
]

const LOCAL_ASSETS = ['webpack.png']

function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR：8 字节签名 + 4 字节长度 + 'IHDR'，其后大端宽高各 4 字节。
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标多色版换色 — Webpack）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('光栅尺寸钉死：Webpack 128×128 PNG', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(pngSize(readFileSync(`${dir}webpack.png`))).toEqual({ width: 128, height: 128 })
  })
})
