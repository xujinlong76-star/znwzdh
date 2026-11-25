import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 剩余图标补齐 W5（2026-11-25，短剧组）。
 *
 * 7/7 站：ShortMax / GoodShort / NetShort / FlexTV / MoboReels / Melolo /
 * ReelShort。阻塞 0。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。7 站的 href / 标题 / customIcon 均按当前基线
 * feat/icons-remaining-2026-11-25（HEAD bef26ed）的 navigation.json
 * 逐个核对，不可猜。6 站 icon 字段均为远端 …/favicon.ico，被
 * isRemoteRawFavicon 拦截后回落 map；ReelShort 的 icon 是站方 CDN 直链，
 * 见下方 ReelShort 事实钉死。
 *
 * 来源要点（2026-11-25 19:19–19:21 CST，curl，Chrome UA，逐站实测）：
 * - ShortMax：首页 200（527,529 B，text/html），声明
 *   `<link rel="icon" sizes="32x32" href="/favicon.ico">` 与
 *   apple-touch-icon /images/logo.png；/favicon.ico 200，4,286 B，
 *   image/vnd.microsoft.icon，ICO 32×32 单帧（黑底白 S + 橙色 TV 带，
 *   底行橙色占比 75%–91%）；/images/logo.png 200，2,835 B，PNG 71×71，
 *   同标（底行橙色占比 75%–92%），取较大的 71 版原样落盘 shortmax.png。
 * - GoodShort：首页 200（269,255 B），声明
 *   `<link rel="icon" href="/public/favicon.ico" />`；/public/favicon.ico
 *   200，1,286 B，image/x-icon，内容实为 PNG 40×40（白底红橙播放三角标），
 *   与根 /favicon.ico 逐字节相同（md5 16f2e6d9…），原样落盘 goodshort.png。
 * - NetShort：首页 200（420,627 B），声明 apple-touch-icon
 *   /a2hs/apple-touch-icon.png；该文件 200，10,179 B，PNG 180×180，
 *   红橙渐变圆角方块 + 白色胶片标；根 /favicon.ico 200，20,718 B，
 *   内容实为 WebP 300×300 全幅渐变同标（路径与内容类型不符，未用）。
 *   取 180 源 Pillow LANCZOS 缩至 128×128 落盘 netshort.png。
 * - FlexTV：首页 200（706,683 B），声明
 *   `<link rel="icon" href="https://www.flextv.cc/favicon.ico">` 与
 *   apple-touch-icon https://www.flextv.cc/apple-touch-icon.png；
 *   后者 200，14,875 B，PNG 672×672（粉 #FB3867 圆角方块 + 白色电视
 *   播放标），与根 /favicon.ico 256×256 帧同标（64 档均值差异 3.70，
 *   仅重采样差）；根 ICO 270,398 B 未用。取 672 源 Pillow LANCZOS 缩至
 *   128×128 落盘 flextv.png。
 * - MoboReels：首页 200（156,338 B），仅声明
 *   `<link rel="icon" type="image/x-icon" href="/favicon.ico">`；
 *   /favicon.ico 200，4,286 B，ICO 32×32 单帧（粉红渐变方块 + 深红爱心，
 *   零白像素——32px 下白电视描边已丢失的简化版）；站内同源站方 logo
 *   /_nuxt/img/logo.1733fb4.png 200，1,586 B，PNG 80×80（同品牌粉红
 *   渐变方块 + 白电视 + 白爱心完整标），目视核对为同一品牌标的完整版，
 *   原样落盘 moboreels.png。favicon 32 版为同标简化版未用（复审如改用
 *   32 版只需换文件一行，其 md5 见 EVIDENCE-w5.md）。
 * - Melolo：首页 200（404,517 B），声明
 *   `<link rel="icon" href="/favicon.ico?favicon.1jo7br0ifgqa8.ico" sizes="64x64">`
 *   与 /favicon.png（48×48）、apple-touch-icon /icon.png；
 *   /favicon.ico 200，16,958 B，ICO 64×64 单帧（红 #B90004 圆角方块 +
 *   白电视 M 标），与 /icon.png 56×56 同标（64 档均值差异 3.92，仅重
 *   采样差）；声明的 /favicon.png 200 回 HTML 壳页不可用。ICO 64 帧解码
 *   原样落盘 melolo.png。
 * - ReelShort：首页 200（600,514 B），head 三处声明同源同文件
 *   https://v-mps.crazymaplestudios.com/images/211d3420-d721-11f0-84ad-6b5693b490dc.png
 *   （apple-touch-icon + icon）；该文件 200，14,425 B，image/png，
 *   PNG 204×204（红粉渐变圆角方块 + 白 R + 播放三角标）；站根
 *   /favicon.ico 404 未用。204→128 LANCZOS 与既有 reelshort.png
 *   逐字节一致（md5 0cd48cd0ba550cf52a474cbb8db749bf，12,804 B），
 *   故本批不改文件、只修可达性（见下方事实钉死）。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 388 站核对：6 个新键在 navigation.json href 中各只命中 1 站，
 *   无后缀串站、无子域站；navigation.json 不动。禁加的键
 *   miguvideo.com / 裸 yangshipin.cn / qq.com / github.com / adobe.com
 *   本批均未碰（下方断言）。
 * - 16px 原图不放大冒充：6 站新文件均 <128 原样或只缩小（71 / 40 /
 *   128 / 128 / 80 / 64），无一放大；卡片上小图显小是合规状态。
 * - 7 文件均 ≤ ~15 KB 参考线（最大 netshort.png 11,670 B）。
 * - ReelShort 可达性：其 navigation.json icon 为站方自有 CDN 直链，
 *   既非第三方图标服务、又非 /favicon.ico 盲猜路径，故旧解析链里
 *   customIcon 优先分支直接热链回传，map 里已有的 'reelshort.com' 键
 *   永不可达（缺口清单误记 map_key 为 null 即源于此）。本批在
 *   resolveSiteIcon 顶部加单站绕过：本站跳过 customIcon 直通、回落
 *   map；navigation.json 不动，清空 icon 字段留待合流方按 R1 裁决处理。
 *   下方 CASES 用三参数（含该 CDN customIcon）钉死解析结果为本地路径，
 *   且 CDN URL 本身不再作为解析结果出现。
 * - 7 标均为真实品牌标（目视核对：ShortMax 黑 S + 橙 TV 带、GoodShort
 *   红橙播放三角、NetShort 红橙胶片标、FlexTV 粉电视播放标、MoboReels
 *   粉电视爱心标、Melolo 红电视 M 标、ReelShort 红粉 R 播放标），浅/深
 *   主题均可见，按规范 §9 不做单站底块补丁、不配 LOGO_TILE_MAP
 *   （resolveLogoTile 为 null），留待统一处理轮。
 */

const CDN_REELSHORT =
  'https://v-mps.crazymaplestudios.com/images/211d3420-d721-11f0-84ad-6b5693b490dc.png'

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.shorttv.live/', title: 'ShortMax', customIcon: 'https://www.shorttv.live/favicon.ico', expected: '/brand-icons/shortmax.png' },
  { url: 'https://www.goodshort.com', title: 'GoodShort', customIcon: 'https://www.goodshort.com/favicon.ico', expected: '/brand-icons/goodshort.png' },
  { url: 'https://netshort.com', title: 'NetShort', customIcon: 'https://netshort.com/favicon.ico', expected: '/brand-icons/netshort.png' },
  { url: 'https://www.flextv.cc', title: 'FlexTV', customIcon: 'https://www.flextv.cc/favicon.ico', expected: '/brand-icons/flextv.png' },
  { url: 'https://www.moboreels.com', title: 'MoboReels', customIcon: 'https://www.moboreels.com/favicon.ico', expected: '/brand-icons/moboreels.png' },
  { url: 'https://melolo.com', title: 'Melolo', customIcon: 'https://melolo.com/favicon.ico', expected: '/brand-icons/melolo.png' },
  { url: 'https://www.reelshort.com', title: 'ReelShort', customIcon: CDN_REELSHORT, expected: '/brand-icons/reelshort.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number; md5: string }> = [
  { name: 'shortmax.png', width: 71, height: 71, bytes: 2835, md5: '6d09cf77f1f22b39ab5f96fcfa801aae' },
  { name: 'goodshort.png', width: 40, height: 40, bytes: 1286, md5: '16f2e6d9f8ded7c498860e65683368d9' },
  { name: 'netshort.png', width: 128, height: 128, bytes: 11670, md5: '33e43a2b22b9edc4f2a65ca4b26e3bed' },
  { name: 'flextv.png', width: 128, height: 128, bytes: 2976, md5: '46c2048d4fe1871070da720fce58a8f4' },
  { name: 'moboreels.png', width: 80, height: 80, bytes: 1586, md5: '1733fb416f82abda1a75e3b7a7b5ad8e' },
  { name: 'melolo.png', width: 64, height: 64, bytes: 3916, md5: '9c0dc3f8bb25bfaa3a5fb1236bd01c15' },
  { name: 'reelshort.png', width: 128, height: 128, bytes: 12804, md5: '0cd48cd0ba550cf52a474cbb8db749bf' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function md5(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex')
}

describe('resolveSiteIcon（剩余图标补齐 W5 短剧组）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（7 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(7)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 7 站尺寸与来源逐个相符（无一放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width, height })
    }
  })

  it('字节数与 md5 钉死：7 文件与取材来源逐个一致', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, bytes, md5: expectedMd5 } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(statSync(`${dir}${name}`).size, name).toBe(bytes)
      expect(md5(buf), name).toBe(expectedMd5)
    }
  })

  it('光栅单站落盘 ≤ ~15KB（7 文件全部未超线）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：ReelShort 不再热链——CDN customIcon 不直通、解析为本地路径', () => {
    // 旧行为：customIcon 优先分支直接回传该 CDN URL（热链）；新行为：回落 map。
    expect(resolveSiteIcon('https://www.reelshort.com', 'ReelShort', CDN_REELSHORT)).toBe('/brand-icons/reelshort.png')
    expect(resolveSiteIcon('https://www.reelshort.com', 'ReelShort', CDN_REELSHORT)).not.toBe(CDN_REELSHORT)
    // 不带 www 的 href 同样绕过（parseSiteUrl 归一后同键）。
    expect(resolveSiteIcon('https://reelshort.com', 'ReelShort', CDN_REELSHORT)).toBe('/brand-icons/reelshort.png')
    // 无 customIcon 时 map 本就命中，不受绕过影响。
    expect(resolveSiteIcon('https://www.reelshort.com', 'ReelShort')).toBe('/brand-icons/reelshort.png')
  })

  it('事实钉死：7 键不串站（全库 388 站各只命中 1 站）', () => {
    for (const { url, title, customIcon, expected } of CASES) {
      expect(resolveSiteIcon(url, title, customIcon), title).toBe(expected)
      for (const other of CASES) {
        if (other.title !== title) {
          expect(resolveSiteIcon(url, title, customIcon), `${title} 不串 ${other.title}`).not.toBe(other.expected)
        }
      }
    }
  })

  it('事实钉死：7 站均不配底块（resolveLogoTile 为 null）', () => {
    for (const { url } of CASES) {
      expect(resolveLogoTile(url), url).toBeNull()
    }
  })

  it('事实钉死：禁加的键本批均未碰', () => {
    expect('miguvideo.com' in LOCAL_LOGO_MAP).toBe(false)
    expect('yangshipin.cn' in LOCAL_LOGO_MAP).toBe(false)
    expect('qq.com' in LOCAL_LOGO_MAP).toBe(false)
    expect('github.com' in LOCAL_LOGO_MAP).toBe(false)
    expect('adobe.com' in LOCAL_LOGO_MAP).toBe(false)
  })
})
