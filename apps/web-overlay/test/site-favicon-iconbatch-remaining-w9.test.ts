import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 剩余图标补齐 W9（2026-11-25，设计与创意组 8 站）：
 * Paletton、Colormind、Photopea、Khroma、Happy Hues、Pexels（6 站落地）；
 * SiteInspire、Pixabay（2 站阻塞，未落盘、未接线）。
 *
 * CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。本站的 href / 标题 / customIcon 均按当前基分支的
 * navigation.json 逐个核对，不可猜。
 *
 * 来源要点（2026-11-25 19:2x CST，curl，Chrome UA；Pexels 由 W9 接续
 * 20:06–20:08 CST 重新复测确认）：
 * - Pexels：站方主域 www.pexels.com 全路径 403/000（Cloudflare
 *   “Just a moment...”机器人墙）；但站方自有图片 CDN images.pexels.com
 *   未墙：官方 API 品牌资产 /lib/api/pexels.png（1010×446 RGBA，200、
 *   image/png、24,726 B，md5 fa5df91be27d70e447150875f2e6b8f3），复测
 *   md5/尺寸与首测一致；Pillow LANCZOS 等比 1010×446→256×113 落盘
 *   pexels.png（13,890 B，md5 85ff250e3d2ce2f64b38711249f9ba20），与源
 *   等比缩放像素逐点一致（max abs diff 0），ASCII 渲染确认 “pexels”
 *   手写体 + 右上 P 形 swoosh 标完整。宽 wordmark 先例见库内
 *   chinatax/ncpssd/nmc；黑字标深色弱与 Khroma 同款已知局限，只加
 *   普通 map 条目、不做单站底块补丁，留待统一处理轮。nav icon 字段为
 *   远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效。
 * - Paletton：首页声明的最大档 img/favicon-128.png（128×128 RGBA，
 *   200、image/png、4,345 B，md5 f23476c6715214726e096a8d3cf8275f；彩色
 *   色轮标，ASCII 渲染确认圆环色轮完整）；根 /favicon.ico 仅 16×16
 *   ICO（1,150 B）未用。原样落盘 paletton.png（4,244 B，md5
 *   fed94784d27d8bf2e389002d133bdd1c，像素与源一致）。nav icon 字段为
 *   远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效。
 * - Colormind：首页声明 /favicon32.gif（32×32 GIF，200、image/gif、
 *   2,389 B，md5 2bc31481c2048290cd453d873c7b0d29；圆环 + 圆点品牌标，
 *   ASCII 渲染确认）；根 /favicon.ico 404 未用。GIF 转 RGBA PNG 原样
 *   32×32 落盘 colormind.png（1,509 B，md5
 *   c433be10c6a2c208411dfc13c3a4efba，像素与源一致），绝不放大。
 *   nav icon 字段即该 GIF（路径含 favicon，被拦截），map 生效。
 * - Photopea：首页声明 promo/icon512.png（512×512 RGBA，200、
 *   image/png、17,293 B，md5 59b6b69a426e8232fbbbed410badc879；青绿
 *   #00A591 + 白字标，四角透明），Pillow LANCZOS 512→128 落盘
 *   photopea.png（11,480 B，md5 edb41c65fb239d86ba3ff469b03d5dc2）。
 * - Khroma：首页声明 ../assets/icons/fav.png（31×32 RGBA，200、
 *   image/png、358 B，md5 4cd5d47db8d104df49627f4e7e44e34b；纯黑斜杠
 *   标，alpha 渲染确认斜向色带完整），字节原样落盘 khroma.png
 *   （358 B，md5 与源一致），31×32 原样不放大。纯黑标按 Ollama /
 *   SourceHut / Radix 先例：只加普通 map 条目，不做单站底块补丁，
 *   深色模式对比度弱是已知局限、留待统一处理轮。
 * - Happy Hues：首页声明的 Webflow CDN happy-hues-fav.png
 *   （32×32 RGBA，200、image/png、1,179 B，md5
 *   43924ea552e27ebba0a2e2add953ccf2；珊瑚红 #F25A4E 圆徽 + 深紫
 *   #1F1135 标，ASCII 渲染确认圆徽完整），字节原样落盘
 *   happyhues.png（1,179 B，md5 与源一致），32×32 原样不放大。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 388 站核对：6 个 map 键各只命中 1 站，无后缀串站、无子域站；
 *   'github.com' / 'adobe.com' 键未碰；navigation.json 不动；其余 worker
 *   的站本文件不碰、不断言，免得合流时互相绊住。
 * - 尺寸钉死：paletton.png / photopea.png 128×128；colormind.png /
 *   happyhues.png 32×32 原样；khroma.png 31×32 原样；pexels.png
 *   256×113（等比缩放，非放大）；6 文件均 ≤ 15 KB。
 * - 截胡事实（R1 裁决 B2a/B3a 先例）：Photopea / Khroma / Happy Hues
 *   的 nav icon 字段是远端非 favicon 直链（路径不含 favicon，不触发
 *   isRemoteRawFavicon），customIcon 优先于 map——带真实 customIcon
 *   调用时仍返回远端 URL，本地 map 键在运行时不可达；本任务禁改
 *   navigation.json，故 3 站的“停热链”须由协调方另行清空其 icon 字段
 *   才能生效。本文件把该现状钉死为通过的事实断言，不谎称已停热链；
 *   无 customIcon 时 3 站均正确解析到本地（MAP_ONLY_CASES）。
 * - 阻塞事实（2 站未落盘、未接线、无 map 键）：
 *   SiteInspire：首页与 /favicon.ico 两次 curl 均 429（25,103 B /
 *   25,098 B 限流页；间隔 20 秒复测仍 429；/favicon.svg 猜测路径
 *   同样 429），且首页声明 rel="icon" href="data:,"（无真实图标
 *   声明）——记“阻塞待浏览器实访”，不造假、不拿第三方图标库顶替。
 *   W9 接续 20:06–20:08 CST 复测：www 根、/favicon.ico、裸域、/favicon.svg
 *   四路仍 429（约 25.1 KB 同款限流页）。
 *   Pixabay：首页与 /favicon.ico 均 403 Cloudflare 验证墙
 *   （"Just a moment..."，3,291 B / 5,725 B）。W9 接续 20:06–20:08 CST
 *   复测：首页、/favicon.ico、/favicon-32x32.png、/static/img/
 *   logo.png、/static/img/logo_square.png 仍 403（约 3,289 B 同款墙）；
 *   cdn.pixabay.com 一张用户上传图 URL 403 AccessDenied，本就不是
 *   品牌资产、未采用。两站 customIcon 均为 …/favicon.ico，
 *   被 isRemoteRawFavicon 拦截后解析为空串（走渐变字母徽标兜底），
 *   不是本地图标、不是远端直链。
 * - 6 站 resolveLogoTile 均为 null（无底块）；Khroma 纯黑标、Pexels
 *   黑字标深色弱已在接线注释与 EVIDENCE-w9.md 注明，留待统一处理轮。
 * - 17K小说网、书旗小说、Adobe Color 不在本组、不碰。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://paletton.com', title: 'Paletton', customIcon: 'https://paletton.com/favicon.ico', expected: '/brand-icons/paletton.png' },
  { url: 'https://colormind.io', title: 'Colormind', customIcon: 'https://colormind.io/favicon32.gif', expected: '/brand-icons/colormind.png' },
  { url: 'https://www.pexels.com', title: 'Pexels', customIcon: 'https://www.pexels.com/favicon.ico', expected: '/brand-icons/pexels.png' },
]

// 远端直链 3 站：无 customIcon 时 map 正确解析到本地。
const MAP_ONLY_CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://www.photopea.com', title: 'Photopea', expected: '/brand-icons/photopea.png' },
  { url: 'https://www.khroma.co', title: 'Khroma', expected: '/brand-icons/khroma.png' },
  { url: 'https://www.happyhues.co', title: 'Happy Hues', expected: '/brand-icons/happyhues.png' },
]

// 截胡现状钉死：带 navigation.json 真实 customIcon 时仍走远端直链。
const PASSTHROUGH_CASES: Array<{ url: string; title: string; customIcon: string; expected: string }> = [
  { url: 'https://www.photopea.com', title: 'Photopea', customIcon: 'https://www.photopea.com/promo/icon512.png', expected: 'https://www.photopea.com/promo/icon512.png' },
  { url: 'https://www.khroma.co', title: 'Khroma', customIcon: 'https://www.khroma.co/assets/icons/fav.png', expected: 'https://www.khroma.co/assets/icons/fav.png' },
  { url: 'https://www.happyhues.co', title: 'Happy Hues', customIcon: 'https://cdn.prod.website-files.com/5dd40aa8049df8748c72d0ee/5dd9b94105da589ba59c4907_happy-hues-fav.png', expected: 'https://cdn.prod.website-files.com/5dd40aa8049df8748c72d0ee/5dd9b94105da589ba59c4907_happy-hues-fav.png' },
]

// 阻塞 2 站：无本地图标、无 map 键，远端 favicon 被拦截后解析为空串。
const BLOCKED_CASES: Array<{ url: string; title: string; customIcon: string }> = [
  { url: 'https://www.siteinspire.com', title: 'SiteInspire', customIcon: 'https://www.siteinspire.com/favicon.ico' },
  { url: 'https://pixabay.com', title: 'Pixabay', customIcon: 'https://pixabay.com/favicon.ico' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'paletton.png', width: 128, height: 128, bytes: 4244 },
  { name: 'colormind.png', width: 32, height: 32, bytes: 1509 },
  { name: 'photopea.png', width: 128, height: 128, bytes: 11480 },
  { name: 'khroma.png', width: 31, height: 32, bytes: 358 },
  { name: 'happyhues.png', width: 32, height: 32, bytes: 1179 },
  { name: 'pexels.png', width: 256, height: 113, bytes: 13890 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（剩余图标补齐 W9）', () => {
  it.each(CASES)(' $title 全链解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it.each(MAP_ONLY_CASES)(' $title 无 customIcon 时 map 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it.each(PASSTHROUGH_CASES)(' $title 带真实 customIcon 时仍走远端直链（截胡现状，待清 icon 字段）', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it.each(BLOCKED_CASES)(' $title 阻塞站无本地图标、解析为空串（字母徽标兜底）', ({ url, title, customIcon }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe('')
  })

  it('阻塞 2 站无 map 键', () => {
    for (const host of ['siteinspire.com', 'pixabay.com']) {
      expect(LOCAL_LOGO_MAP[host]).toBeUndefined()
    }
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（6 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(6)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸与字节数钉死：PNG 6 站按表（小图原样，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height, bytes } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width, height })
      expect(statSync(`${dir}${name}`).size, name).toBe(bytes)
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('6 站无底块（resolveLogoTile 为 null）', () => {
    for (const url of [
      'https://paletton.com',
      'https://colormind.io',
      'https://www.pexels.com',
      'https://www.photopea.com',
      'https://www.khroma.co',
      'https://www.happyhues.co',
    ]) {
      expect(resolveLogoTile(url), url).toBeNull()
    }
  })
})
