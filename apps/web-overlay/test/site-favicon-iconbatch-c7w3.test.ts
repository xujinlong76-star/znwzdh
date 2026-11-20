import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批补批 W3（2026-11-20，短剧组）。
 *
 * 2/2 站：DramaBox / DramaWave。两站 icon 字段均为远端 …/favicon.ico，
 * 被 isRemoteRawFavicon 拦截后回落 map；navigation.json 不动。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。2 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜。
 *
 * 来源要点（2026-11-20 15:01–15:05 CST，curl，Chrome UA，逐站实测）：
 * - DramaBox：首页 200（104,820 B，text/html），声明
 *   `<link rel="icon" href="/favicon.ico">`；/favicon.ico 200，
 *   1,393 B，image/x-icon，`file` 验为 32×32 ICO（内含 PNG）；
 *   页眉官方标 https://infocdn.dramaboxdb.com/seo/dramaboxdb/images/logo.png
 *   200，5,596 B，176×176 PNG，与 favicon 为同一粉红 D-play 标
 *   （目视核对一致），取 176 源 Pillow LANCZOS 缩至 128×128 落盘
 *   dramabox.png；m-logo.png（362×80）为宽版 wordmark，不作 tile。
 * - DramaWave：首页 200（11,271 B，text/html）；/favicon.ico 200，
 *   4,286 B，image/x-icon，32×32 ICO 单帧；首页内联 JS 默认
 *   `icon = '/dramawave.ico'`、`appleIcon = '/Logo.png'`；
 *   /dramawave.ico 200，4,286 B，与 /favicon.ico md5 相同（同一文件）；
 *   /Logo.png 200，65,374 B，512×512 PNG，与 favicon 为同一品红渐变
 *   D-play 标——32px 小图初看易误读为 W，4 倍放大核对确为 D-play 标，
 *   与 Logo.png 一致；取 512 源 Pillow LANCZOS 缩至 128×128 落盘
 *   dramawave.png。首页另有 DramaBuzz / FreeReels / TopShort 三个
 *   白标分支（各有自己的 .ico / -logo.png），默认分支即 DramaWave，
 *   本批只用默认分支的标，不碰其余分支。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 383 站核对：'dramaboxdb.com' 与 'mydramawave.com' 两键各只
 *   命中 1 站，无后缀串站；'github.com' / 'adobe.com' 键未碰。
 * - dramabox.png 15,595 B 略超光栅单站 ~15 KB 参考线（235 B）：
 *   Pillow compress_level 9 复试同尺寸，optipng 本环境不可用；按原样
 *   接线、字节数钉死（C12 chinatax.png / forestry.jpg 超线原样先例），
 *   下方 ≤15 KB 断言明确排除本文件。dramawave.png 10,521 B 未超线。
 * - 两标均为不透明渐变底（圆角外 687 / 0 透明像素仅为圆角本身），
 *   深/浅主题下均可辨，不进 LOGO_TILE_MAP，不做单站补丁。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.dramaboxdb.com', title: 'DramaBox', customIcon: 'https://www.dramaboxdb.com/favicon.ico', expected: '/brand-icons/dramabox.png' },
  { url: 'https://mydramawave.com', title: 'DramaWave', customIcon: 'https://mydramawave.com/favicon.ico', expected: '/brand-icons/dramawave.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  { name: 'dramabox.png', width: 128, height: 128 },
  { name: 'dramawave.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批补批 W3）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（2 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(2)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 2 站均为 128×128', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('光栅单站落盘 ≤ ~15KB（dramabox.png 除外，见事实钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      if (name === 'dramabox.png') continue
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：dramabox.png 超线原样接线（字节数钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}dramabox.png`))).toEqual({ width: 128, height: 128 })
    expect(statSync(`${dir}dramabox.png`).size).toBe(15595)
    expect(statSync(`${dir}dramawave.png`).size).toBe(10521)
  })

  it('事实钉死：两键不串站（全库 383 站各只命中 1 站）', () => {
    expect(resolveSiteIcon('https://www.dramaboxdb.com', 'DramaBox', 'https://www.dramaboxdb.com/favicon.ico')).toBe('/brand-icons/dramabox.png')
    expect(resolveSiteIcon('https://mydramawave.com', 'DramaWave', 'https://mydramawave.com/favicon.ico')).toBe('/brand-icons/dramawave.png')
    // 两站互不串：DramaBox 不解析为 dramawave，反之亦然。
    expect(resolveSiteIcon('https://www.dramaboxdb.com', 'DramaBox', 'https://www.dramaboxdb.com/favicon.ico')).not.toBe('/brand-icons/dramawave.png')
    expect(resolveSiteIcon('https://mydramawave.com', 'DramaWave', 'https://mydramawave.com/favicon.ico')).not.toBe('/brand-icons/dramabox.png')
  })
})
