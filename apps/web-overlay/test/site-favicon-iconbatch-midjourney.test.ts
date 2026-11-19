import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 13 批续（2026-11-20，尾巴 1 站）。
 *
 * 1/1 站：Midjourney（AI 工具 / AI 图像生成）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。Midjourney 的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；其 customIcon 为远端
 * https://midjourney.com/favicon.ico，被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（设计 staging ~/workspace/icon-full/staging/specials/midjourney.png）：
 * - Midjourney：原属 C1 清单，当时被 Cloudflare 墙阻塞未入；现设计经
 *   Wayback 路线取回后解堵，只剩接线。128×128 PNG，9,084 B，
 *   SHA-1 与 CDX 摘要一致，md5 685a01a27d7876273584052dd06f846e。
 * - 白底不透明 PNG 原样：全图 16,384/16,384 像素不透明，深色帆船标
 *   bbox x18–109 y19–96（深色像素 1,109 个）；浅/深主题下均显白底方块。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 无底块：本轮 resolveLogoTile('https://midjourney.com') 为 null，
 *   不配底块；白底方块在深色模式下的观感留待统一处理轮，不做单站补丁。
 * - 全库 373 站核对：'midjourney.com' map 键只命中 Midjourney 一站，
 *   无后缀串站、无子域站。
 * - 计划文件原写 midjourney.svg，实际落盘为 staging 交付的
 *   midjourney.png（Wayback 取回的 PNG 原样），以实物为准。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Midjourney 的 customIcon 为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截
  { url: 'https://midjourney.com', title: 'Midjourney', customIcon: 'https://midjourney.com/favicon.ico', expected: '/brand-icons/midjourney.png' },
]

const LOCAL_ASSETS: Array<{ name: string }> = [
  { name: 'midjourney.png' },
]

describe('resolveSiteIcon（图标修复 C 类第 13 批续 Midjourney）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（1 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(1)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('PNG 原样钉死：128×128、9,084 B、白底不透明', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = statSync(`${dir}midjourney.png`)
    expect(buf.size).toBe(9084)
    // PNG 签名 + IHDR 宽高 128×128（大端 uint32，偏移 16/20）
    const bytes = readFileSync(`${dir}midjourney.png`)
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(bytes.readUInt32BE(16)).toBe(128)
    expect(bytes.readUInt32BE(20)).toBe(128)
  })

  it('事实钉死：无底块，白底方块留待统一处理轮', () => {
    expect(resolveLogoTile('https://midjourney.com')).toBeNull()
    expect(resolveSiteIcon('https://midjourney.com', 'Midjourney', 'https://midjourney.com/favicon.ico')).toBe('/brand-icons/midjourney.png')
  })

  it('事实钉死：midjourney.com 键不串站（无子域站、无同名站）', () => {
    expect(resolveSiteIcon('https://midjourney.com', 'Midjourney', 'https://midjourney.com/favicon.ico')).toBe('/brand-icons/midjourney.png')
    // 无 customIcon 时同样走 map，不回落远程 favicon.ico
    expect(resolveSiteIcon('https://midjourney.com', 'Midjourney')).toBe('/brand-icons/midjourney.png')
    // www 前缀同样归一化命中
    expect(resolveSiteIcon('https://www.midjourney.com', 'Midjourney')).toBe('/brand-icons/midjourney.png')
  })
})
