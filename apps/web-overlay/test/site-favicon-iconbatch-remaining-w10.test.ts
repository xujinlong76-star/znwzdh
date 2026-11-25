import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 剩余图标 W10（2026-11-25，AI 工具 + 效率办公组，6 站）。
 *
 * Descript / Make / SkyReels / 讯飞绘镜 / Todoist / OpusClip。
 *
 * 本批 CASES 传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。6 站的 href / 标题 / customIcon 均按当前基分支
 * feat/icons-remaining-2026-11-25 的 navigation.json 逐个核对，不可猜。
 *
 * 来源要点（设计证据 EVIDENCE-w10.md，worktree 根目录）：
 * - Descript：首页声明的 apple-touch-icon.png（180×180，与声明的
 *   favicon-96x96.png 同一暗紫圆角方块 #651A39 + 红波形标 #F73B3B，
 *   源更大故取 180 版；站根 /favicon.ico 仅 459 B 非图像文件，不可用），
 *   LANCZOS 180→128 落盘 descript.png（3,957 B）。
 * - Make：首页声明的最大档 512×512 PNG（与 48×48 档同一品红渐变缎带 M
 *   标；站根 /favicon.ico 404 不可用），LANCZOS 512→128 落盘 make.png
 *   （12,530 B）。
 * - SkyReels：首页声明 /favicon.png（71×96 非方、同一金色 S 标）；
 *   选用站根 /favicon.ico 的内容（实为 PNG 128×128、黑底圆角方块 +
 *   金色 S 标 #FFCF00），方形更适卡片，原样落盘 skyreels.png（2,449 B）。
 * - 讯飞绘镜：首页无 icon 声明；站根 /favicon.ico 为 ICO 单帧 256×256
 *   （紫 #8E4BFF + 珊瑚红 #FF5A53 抽象标，透明底），LANCZOS 256→128
 *   落盘 typemovie.png（6,077 B）。
 * - Todoist：首页声明 /static/favicon-32x32.png；选用站根 /favicon.ico
 *   的最大帧 48×48（红圆角方块 #E44332 + 白勾，ICO 3 帧 16/32/48），
 *   原样落盘 todoist.png（1,963 B）。
 * - OpusClip（远端直链本地化）：navigation.json 的 icon 字段即 Webflow
 *   CDN _ico-final.png（32×32、527 B）；首页另声明同源 apple-touch-icon
 *   webclip.png（256×256，同一黑底白 O 形标、源更大），按 C7“取官方最大
 *   档”先例取 webclip 版，LANCZOS 256→128 落盘 opusclip.png（7,226 B）。
 *
 * 事实钉死（只记、不加底块、不改组件）：
 * - Todoist 48×48 原样小图，按规范 §1.1 原样保留、绝不放大；卡片上
 *   显小是合规状态而非质量问题。
 * - OpusClip 的 navigation.json icon 字段（…_ico-final.png）路径不含
 *   'favicon'，不被 isRemoteRawFavicon 拦截，customIcon 直通优先于 map
 *   （R1 Beatoven/Sudowrite 先例：单加 map 键不可达，须同步清 icon 字段）。
 *   本任务禁改 navigation.json，故本支只落盘 + 建 map 键，卡片路径在
 *   icon 字段清空前仍走 CDN 直链；本测试把该直通事实钉死，map 本身用
 *   无 customIcon 调用验证（与 ecosystem-graph 的调用形态一致）。
 * - 六键全库各只命中一站，无后缀串站、无标题规则拦截；六标浅/深主题
 *   均可辨，按规范 §9 不做单站底块补丁、不配 LOGO_TILE_MAP。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Descript / Make / SkyReels / 讯飞绘镜 / Todoist：customIcon 均被拦截后回落 map
  { url: 'https://www.descript.com', title: 'Descript', customIcon: 'https://www.descript.com/favicon.ico', expected: '/brand-icons/descript.png' },
  { url: 'https://www.make.com', title: 'Make', customIcon: 'https://cdn.prod.website-files.com/6a294495bc84130c6dd0c4fd/6a7b944121e8a94aaf6ca04f_favicon-32x32.png', expected: '/brand-icons/make.png' },
  { url: 'https://www.skyreels.ai/', title: 'SkyReels', customIcon: 'https://www.skyreels.ai/favicon.ico', expected: '/brand-icons/skyreels.png' },
  { url: 'https://typemovie.art/', title: '讯飞绘镜', customIcon: 'https://typemovie.art/favicon.ico', expected: '/brand-icons/typemovie.png' },
  { url: 'https://todoist.com', title: 'Todoist', customIcon: 'https://todoist.com/favicon.ico', expected: '/brand-icons/todoist.png' },
]

const OPUS_CDN =
  'https://cdn.prod.website-files.com/6388604483b03a9ecb34d695/64351a9e4e9223f5e0f46d64_ico-final.png'

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number; md5: string }> = [
  { name: 'descript.png', width: 128, height: 128, bytes: 3957, md5: 'c2eb26287ebb5b7b2d15de9143889476' },
  { name: 'make.png', width: 128, height: 128, bytes: 12530, md5: '159d065b8e12bd7e79eeea87f1ee129b' },
  { name: 'skyreels.png', width: 128, height: 128, bytes: 2449, md5: '1e407229e15e2cbc00e8b531a0619f2f' },
  { name: 'typemovie.png', width: 128, height: 128, bytes: 6077, md5: '4efc13e1b569e1c3c4cae3a55b74c821' },
  { name: 'todoist.png', width: 48, height: 48, bytes: 1963, md5: '03f7e5d29329731aa83d08fc5e0e8c9e' },
  { name: 'opusclip.png', width: 128, height: 128, bytes: 7226, md5: 'c48623e0ffdf12f34e0ad43898dd2b8e' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（剩余图标 W10）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('OpusClip：map 键生效（无 customIcon 调用，与 ecosystem-graph 形态一致）', () => {
    expect(LOCAL_LOGO_MAP['opus.pro']).toBe('/brand-icons/opusclip.png')
    expect(resolveSiteIcon('https://www.opus.pro', 'OpusClip')).toBe('/brand-icons/opusclip.png')
  })

  it('事实钉死：OpusClip 的 CDN icon 字段直通（须清 navigation.json icon 行才走本地，见 R1）', () => {
    // 路径 …_ico-final.png 不含 'favicon'，isRemoteRawFavicon 不拦截；
    // customIcon 优先于 map，本支禁改 navigation.json，故此处仍为直链。
    expect(resolveSiteIcon('https://www.opus.pro', 'OpusClip', OPUS_CDN)).toBe(OPUS_CDN)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（6 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(6)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 6 站按表（Todoist 48×48 原样，其余 128×128）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('字节数与 md5 钉死：落盘文件与取材时一致', async () => {
    const { createHash } = await import('node:crypto')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, bytes, md5 } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.length, name).toBe(bytes)
      expect(createHash('md5').update(buf).digest('hex'), name).toBe(md5)
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：六键全库各只命中一站，无后缀串站', () => {
    expect(LOCAL_LOGO_MAP['descript.com']).toBe('/brand-icons/descript.png')
    expect(LOCAL_LOGO_MAP['make.com']).toBe('/brand-icons/make.png')
    expect(LOCAL_LOGO_MAP['skyreels.ai']).toBe('/brand-icons/skyreels.png')
    expect(LOCAL_LOGO_MAP['typemovie.art']).toBe('/brand-icons/typemovie.png')
    expect(LOCAL_LOGO_MAP['todoist.com']).toBe('/brand-icons/todoist.png')
    expect(LOCAL_LOGO_MAP['opus.pro']).toBe('/brand-icons/opusclip.png')
    // 六站均无子域站、无同域共享站；www 前缀去后精确命中
    expect(resolveSiteIcon('https://www.descript.com', 'Descript', 'https://www.descript.com/favicon.ico')).toBe('/brand-icons/descript.png')
    expect(resolveSiteIcon('https://www.make.com', 'Make', 'https://cdn.prod.website-files.com/6a294495bc84130c6dd0c4fd/6a7b944121e8a94aaf6ca04f_favicon-32x32.png')).toBe('/brand-icons/make.png')
  })

  it('事实钉死：Todoist 48×48 原样小图（合规，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}todoist.png`)
    // 按规范 §1.1 原样保留、绝不放大；卡片上显小是合规状态
    expect(readPngDimensions(buf)).toEqual({ width: 48, height: 48 })
  })

  it('事实钉死：六站均无底块（resolveLogoTile 为 null）', async () => {
    const { resolveLogoTile } = await import('../src/components/site-favicon')
    for (const url of [
      'https://www.descript.com',
      'https://www.make.com',
      'https://www.skyreels.ai/',
      'https://typemovie.art/',
      'https://todoist.com',
      'https://www.opus.pro',
    ]) {
      expect(resolveLogoTile(url), url).toBeNull()
    }
  })
})
