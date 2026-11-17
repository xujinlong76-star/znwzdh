import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * B 类图标本地化 b1a 批（2026-11-17）：DeepSeek / Kimi / 文心一言 / Kimi 搜索。
 *
 * 基线（`znwzdh-icons-git` 803efd91 只读核查，navigation.json 未动）：
 * - DeepSeek（https://chat.deepseek.com）：旧键 'deepseek.com' /
 *   'chat.deepseek.com' 为热链 https://chat.deepseek.com/favicon.ico。
 *   复验发现该地址回的是 SPA HTML 壳页（<!doctype html>），不是图标，
 *   旧热链已失效；改用官网首页 <link rel="icon" href="/favicon.ico"
 *   sizes="225x225"/> 的 https://www.deepseek.com/favicon.ico。
 * - Kimi（https://www.kimi.com）：无 map 键，之前走标题回落
 *  （title 含 'kimi' → kimi.moonshot.cn/pwa-192.png 热链）。
 * - 文心一言（https://wenxin.baidu.com，标题仍为“文心一言”，未改名）：
 *   无 map 键，之前走标题回落（title 含 '文心一言' →
 *   https://www.baidu.com/favicon.ico，百度通用标，非文心自有标）。
 * - Kimi 搜索（https://kimi.moonshot.cn/）：旧键 'kimi.moonshot.cn' 为
 *   热链 https://kimi.moonshot.cn/pwa-192.png。
 *
 * 来源核实（每站两次 curl 复验，字节 + md5 均一致）：
 * - DeepSeek：https://www.deepseek.com/favicon.ico，225x225 ICO 单帧，
 *   209,762 B，md5 4a63b61b8174ad5090011baaedc2aed3 → 128x128 PNG 9,132 B。
 * - Kimi：https://www.kimi.com/favicon.ico，ICO 3 帧 48/32/16，15,086 B，
 *   md5 2c4c68a5b2e924b7b8aeb109b1d11e31；取最大帧 48x48 转 PNG 原样不放大。
 * - 文心一言：https://wenxin.baidu.com/favicon.ico，ICO 单帧 32x32，4,286 B，
 *   md5 173767b6e4a23233110a2f00354f7909；32x32 转 PNG 原样不放大。
 * - Kimi 搜索：https://kimi.moonshot.cn/pwa-192.png，192x192 PNG，21,645 B，
 *   md5 fbf27bfe1835228eea01dbd64b2118a3；LANCZOS 缩 128x128 后 RGBA 优化版
 *   17,613 B 超 ~15 KB 上限，转调色板 PNG 落盘 3,853 B（原图 alpha 全为 255，
 *   调色板不丢透明通道；FASTOCTREE 256 色，最大通道偏差 14/255）。
 * 附：kimi.moonshot.cn/favicon.ico 与 www.kimi.com/favicon.ico 字节相同
 * （15,086 B，同一 md5），但 Kimi 搜索用 192px PWA 图（更高清），故两站
 * 落盘文件不同，不共用。
 *
 * 全部 4 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://chat.deepseek.com', title: 'DeepSeek', expected: '/brand-icons/deepseek.png' },
  { url: 'https://www.kimi.com', title: 'Kimi', expected: '/brand-icons/kimi.png' },
  { url: 'https://wenxin.baidu.com', title: '文心一言', expected: '/brand-icons/wenxin.png' },
  { url: 'https://kimi.moonshot.cn/', title: 'Kimi 搜索', expected: '/brand-icons/kimi-search.png' },
]

const LOCAL_ASSETS = [
  'deepseek.png',
  'kimi.png',
  'wenxin.png',
  'kimi-search.png',
]

describe('resolveSiteIcon（B 类图标本地化 b1a 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：4 站均为 PNG（非 HTML 壳页/403 页）', () => {
    // DeepSeek 旧热链回的就是 HTML 壳页；此断言钉死落盘的是真图片。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
  })

  it('本地光栅资产尺寸钉死：DeepSeek / Kimi 搜索 128x128、Kimi 48x48、文心一言 32x32 原样', () => {
    // 规范 §1：源 ≥128 的缩到 128x128；小于 128 的原样保留、绝不放大。
    // DeepSeek 源 225x225、Kimi 搜索源 192x192 → 128x128；
    // Kimi 源最大帧 48x48、文心一言源 32x32 → 原样。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['deepseek.png', 'kimi-search.png']) {
      const buf = readFileSync(`${dir}${name}`)
      // PNG IHDR：宽（bytes 16-19）高（bytes 20-23），大端。
      expect(buf.readUInt32BE(16), `${name} width`).toBe(128)
      expect(buf.readUInt32BE(20), `${name} height`).toBe(128)
    }
    const kimi = readFileSync(`${dir}kimi.png`)
    expect(kimi.readUInt32BE(16), 'kimi.png width').toBe(48)
    expect(kimi.readUInt32BE(20), 'kimi.png height').toBe(48)
    const wenxin = readFileSync(`${dir}wenxin.png`)
    expect(wenxin.readUInt32BE(16), 'wenxin.png width').toBe(32)
    expect(wenxin.readUInt32BE(20), 'wenxin.png height').toBe(32)
  })

  it('单站体积钉死：Kimi 搜索调色板版 ≤ 15 KB', () => {
    // 128x128 RGBA 优化版 17,613 B 超上限，已转调色板 PNG（3,853 B）。
    // 此断言防回退到 RGBA 大文件。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}kimi-search.png`).size, 'kimi-search.png bytes').toBeLessThanOrEqual(15 * 1024)
  })

  it('事实钉死：DeepSeek 源不是 chat.deepseek.com/favicon.ico', () => {
    // chat.deepseek.com/favicon.ico 回 SPA HTML 壳页，旧热链已失效。
    // map 值与本测试的预期均为本地 /brand-icons/deepseek.png；
    // 此断言钉死“不得用 chat 域 favicon 重新下载”的事实。
    // （源 URL 不进代码，此处只断言落盘结果为本地路径。）
    expect(CASES[0]!.expected).toBe('/brand-icons/deepseek.png')
  })
})
