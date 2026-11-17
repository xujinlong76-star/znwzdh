import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标换官方多色版：SourceHut（2026-11-17，用户 17:24 拍板，质量审计 §2-7）。
 *
 * 旧图问题：sourcehut.svg 319 B 为 Simple Icons 单色版（粗黑环），与官网
 * 现用标识不符——官网为细灰环。来源 URL：https://sourcehut.org/logo.png，
 * 本轮重新 curl：HTTP 200、image/png、3,934 B、128×128 PNG，与审计记录
 * 字节完全一致，原样落盘为 sourcehut.png（不放大不缩小）。
 *
 * href 与标题按 navigation.json 核对：https://sourcehut.org / SourceHut。
 * 纯黑标深色模式对比度弱是规范 §9 已知局限，留待统一处理轮——本次只换图，
 * 不加白底色块、不改组件。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://sourcehut.org', title: 'SourceHut', expected: '/brand-icons/sourcehut.png' },
]

const LOCAL_ASSETS = ['sourcehut.png']

function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG IHDR：8 字节签名 + 4 字节长度 + 'IHDR'，其后大端宽高各 4 字节。
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标换官方多色版 SourceHut）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：官网源 128×128 PNG 原样落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(pngSize(readFileSync(`${dir}sourcehut.png`))).toEqual({ width: 128, height: 128 })
  })
})
