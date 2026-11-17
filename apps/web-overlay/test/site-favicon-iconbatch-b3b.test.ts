import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 B 类第 3 批 b3b 回归（2026-11-17）。
 *
 * 3 站：少数派（sspai.com）、拼多多（pinduoduo.com）、微信（weixin.qq.com），
 * 全部由远程热链改为本地 public/brand-icons/ 落盘。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链——2a 批只传两参数是因为当时各站均无 customIcon。
 * 全部 3 站的 href / 标题 / customIcon 均按 navigation.json 逐个核对，不可猜。
 *
 * R1（微信）：navigation.json 里微信的 icon 是微信 CDN .ico
 * （https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico），其路径不含
 * favicon，isRemoteRawFavicon 与 isThirdPartyIcon 均不拦截，customIcon 会
 * 优先于 map 永不可达——所以 navigation.json 的该值已同步清空（仅改这一行，
 * 见 staging 的 navigation-icon-clear-b3b.patch）。本文件同时保留一个 R1
 * 反证断言：旧 customIcon 若传进来仍会截胡，钉死“必须清空”的事实。
 * 少数派与拼多多的 customIcon 均为 …/favicon.ico，isRemoteRawFavicon 会
 * 拦截（pathname 以 /favicon.ico 结尾），即使不清也会回落到 map；其中
 * 少数派的该地址实测 404（已死链），拼多多的仍 200。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // customIcon 为 …/favicon.ico → isRemoteRawFavicon 拦截 → 回落 map
  { url: 'https://sspai.com', title: '少数派', customIcon: 'https://sspai.com/favicon.ico', expected: '/brand-icons/sspai.png' },
  // 同上；www.pinduoduo.com 去 www 后命中 pinduoduo.com 键
  { url: 'https://www.pinduoduo.com', title: '拼多多', customIcon: 'https://www.pinduoduo.com/favicon.ico', expected: '/brand-icons/pinduoduo.png' },
  // 清空后的状态：customIcon 为 undefined → map 精确命中 weixin.qq.com
  { url: 'https://weixin.qq.com/', title: '微信', customIcon: undefined, expected: '/brand-icons/weixin.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  { name: 'sspai.png', width: 128, height: 128 },
  { name: 'pinduoduo.png', width: 48, height: 48 },
  { name: 'weixin.png', width: 32, height: 32 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 B 类第 3 批 b3b）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('R1 反证：微信旧 customIcon 若传进来仍会截胡 map（故 navigation.json 必须清空该值）', () => {
    expect(
      resolveSiteIcon('https://weixin.qq.com/', '微信', 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico')
    ).toBe('https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：sspai 128×128、pinduoduo 48×48（小源不放大）、weixin 32×32（小源不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('单站光栅落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('微信事实钉死：落盘文件是 PNG（源 .ico 内容实为 PNG），不是 ICO', () => {
    // 2026-11-17：微信 CDN 的 NTI4MWU5.ico 魔数为 iVBORw0KGgo（PNG），
    // 非 ICO 魔数 00 00 01 00；按规范按内容解码，落盘 weixin.png。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}weixin.png`)
    expect(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
    expect(buf.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))).toBe(false)
  })
})
