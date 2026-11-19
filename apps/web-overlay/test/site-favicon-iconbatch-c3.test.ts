import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 3 批（2026-11-19）。
 *
 * 20 站：W1 Jasper / Copy.ai / Writesonic / Grammarly；W2 秘塔写作猫 /
 * Wordtune / Baidu Comate / Continue.dev；W3 讯飞开放平台 / Udio /
 * Soundraw / AIVA；W4 Boomy / Mubert / Loudly / Murf AI；W5 Speechify /
 * WellSaid / NaturalReader / 魔音工坊。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。20 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；20 站 customIcon 路径均含 favicon
 * （远端 …/favicon.ico、…/favicon.png 或 CDN …_favicon.png /
 * …_favicon.ico），均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（逐站见各工人证据 c3-evidence-w1..w5.md）：
 * - Jasper：官网 apple-touch-icon（Webclip）256×256 缩至 128；32 版
 *   shortcut icon 质量低未采用（与 256 版像素比对为同一标识）。
 * - Copy.ai：官网 apple-touch-icon 256×256 缩至 128；32 版同上未采用。
 * - Writesonic：官网声明的 icon.svg 原样（viewBox 0 0 64 64，橙底
 *   #FF6719 + 白 W）；favicon.ico 仅 16×16 单帧未采用。
 * - Grammarly：favicon.ico 最大帧 48×48 转 PNG 原样不放大（先例：智联
 *   48×48 原样）；header logo.svg 为宽版 wordmark，不是方标，未采用。
 * - 秘塔写作猫：favicon.ico 单帧 128×128，取帧转 PNG 原样。
 * - Wordtune：官网 apple-touch-icon 256×256 缩至 128；32 版 shortcut
 *   icon 质量低未采用（与 256 版目视同一标识：紫圆底 + 白手写 w）。
 * - Baidu Comate：favicon.ico 单帧 40×40 转 PNG 原样不放大。
 * - Continue.dev：favicon.png 256×256 缩至 128。
 * - 讯飞开放平台：favicon.ico 最大帧 32×32 转 PNG 原样不放大；与 C1
 *   的讯飞星火（xinghuo.xfyun.cn / xinghuo.png）不同站、不同图标，
 *   未混用；map 键 'xfyun.cn' 与 'xinghuo.xfyun.cn' 互不干扰。
 * - Udio：favicon.ico 最大帧 256×256 缩至 128。
 * - Soundraw：favicon.ico（含构建 hash 的路径，已下载本地化，不进代码）
 *   最大帧 256×256 缩至 128；RGBA 中间文件 15,708 B 略超 ~15 KB，按
 *   规范 §1.2 转调色板 PNG 压到 3,788 B，目视无差异。
 * - AIVA：favicon.ico 最大帧 256×256（PNG 内嵌帧）缩至 128。
 * - Boomy：manifest 的 android-icon-192x192.png 缩至 128；favicon.ico
 *   最大帧仅 48×48 未采用（大小版目视同一标识）。
 * - Mubert：apple-icon-180x180.png 缩至 128；favicon.ico 最大帧仅
 *   48×48 未采用（大小版目视同一标识）。
 * - Loudly：官网声明的 192×192 favicon 缩至 128。
 * - Murf AI：android-chrome-256x256.png 缩至 128；favicon.ico 仅
 *   32×32 单帧未采用（大小版目视同一标识）。
 * - Speechify：favicon.ico 最大帧 128×128 转 PNG 原样。
 * - WellSaid：官网同组 512×512 favicon.png 缩至 128；32×32 light 版
 *   质量低未采用。
 * - NaturalReader：favicon.ico 单帧 24×24 转 PNG 原样不放大；
 *   apple-touch-icon.png 404、站标为内联 SVG sprite 无外部文件，
 *   24×24 favicon 是唯一可下载的官网当前图标。
 * - 魔音工坊：官网声明的 favicon.svg 地址按内容解码实为 ICO（与
 *   moyin.com/favicon.ico 字节完全相同），单帧 32×32 转 PNG 原样
 *   不放大；按真实格式定后缀 .png，非 .svg。
 *
 * 事实钉死（只记、不加底块、不改组件）：
 * - writesonic.svg 为橙底（#FF6719）白标，viewBox 0 0 64 64，双主题可辨。
 * - soundraw.png 为 8-bit 调色板 PNG（IHDR 色彩类型 3），黑圆底 +
 *   黄 S + 蓝波形线，双主题可辨。
 * - naturalreader.png 为 24×24 小尺寸原样（源 <128 不放大），卡片内
 *   会显小，为已知特性。
 * - 其余站自带底色或亮色标：Jasper 红底、Copy.ai 黑底、Grammarly 绿底、
 *   秘塔写作猫蓝标、Wordtune 紫圆底、Comate 蓝立方标、Continue 浅灰圆底、
 *   讯飞蓝底、Udio 品红 U、AIVA 青圆底、Boomy 品红圆底、Mubert 蓝波形线、
 *   Loudly 青蓝渐变 L、Murf 渐变 M、Speechify 蓝底、WellSaid 蓝底、
 *   魔音工坊蓝底，不处理。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // W1：Jasper / Copy.ai / Writesonic / Grammarly 的 customIcon 均含 favicon
  { url: 'https://www.jasper.ai', title: 'Jasper', customIcon: 'https://cdn.prod.website-files.com/6807ee8d73c233fb82842313/681e121b52f97ed0b2098aab_Favicon.png', expected: '/brand-icons/jasper.png' },
  { url: 'https://www.copy.ai', title: 'Copy.ai', customIcon: 'https://cdn.prod.website-files.com/628288c5cd3e8411b90a36a4/6793eea386b5ac27242bb8eb_favicon_32x32px%20(1).png', expected: '/brand-icons/copy-ai.png' },
  { url: 'https://writesonic.com', title: 'Writesonic', customIcon: 'https://writesonic.com/favicon.ico', expected: '/brand-icons/writesonic.svg' },
  { url: 'https://www.grammarly.com', title: 'Grammarly', customIcon: 'https://static-web.grammarly.com/cms/master/public/favicon.ico', expected: '/brand-icons/grammarly.png' },
  // W2：秘塔写作猫 / Wordtune / Baidu Comate / Continue.dev 的 customIcon 均含 favicon
  { url: 'https://xiezuocat.com', title: '秘塔写作猫', customIcon: 'https://xiezuocat.com/favicon.ico', expected: '/brand-icons/xiezuocat.png' },
  { url: 'https://www.wordtune.com', title: 'Wordtune', customIcon: 'https://cdn.prod.website-files.com/5f7e0f9d75fee6f6f546df46/64edbd73b743162bd24f64bc_favicon.png', expected: '/brand-icons/wordtune.png' },
  { url: 'https://comate.baidu.com', title: 'Baidu Comate', customIcon: 'https://comate.baidu.com/favicon.ico', expected: '/brand-icons/comate.png' },
  { url: 'https://continue.dev', title: 'Continue.dev', customIcon: 'https://continue.dev/favicon.png', expected: '/brand-icons/continue.png' },
  // W3：讯飞开放平台 / Udio / Soundraw / AIVA 的 customIcon 均含 favicon
  { url: 'https://www.xfyun.cn/', title: '讯飞开放平台', customIcon: 'https://www.xfyun.cn/favicon.ico', expected: '/brand-icons/xfyun.png' },
  { url: 'https://www.udio.com', title: 'Udio', customIcon: 'https://www.udio.com/favicon.ico', expected: '/brand-icons/udio.png' },
  { url: 'https://soundraw.io', title: 'Soundraw', customIcon: 'https://soundraw.io/favicon.ico', expected: '/brand-icons/soundraw.png' },
  { url: 'https://www.aiva.ai', title: 'AIVA', customIcon: 'https://www.aiva.ai/assets/img/favicon.ico', expected: '/brand-icons/aiva.png' },
  // W4：Boomy / Mubert / Loudly / Murf AI 的 customIcon 均含 favicon
  { url: 'https://boomy.com', title: 'Boomy', customIcon: 'https://boomy.com/favicon.ico', expected: '/brand-icons/boomy.png' },
  { url: 'https://mubert.com', title: 'Mubert', customIcon: 'https://mubert.com/favicon.ico', expected: '/brand-icons/mubert.png' },
  { url: 'https://www.loudly.com', title: 'Loudly', customIcon: 'https://www.loudly.com/favicon.ico', expected: '/brand-icons/loudly.png' },
  { url: 'https://murf.ai', title: 'Murf AI', customIcon: 'https://cdn.prod.website-files.com/66b3765153a8a0c399c70981/670cb2af23deffa700aa8a09_favicon.ico', expected: '/brand-icons/murf.png' },
  // W5：Speechify / WellSaid / NaturalReader / 魔音工坊 的 customIcon 均含 favicon
  { url: 'https://speechify.com', title: 'Speechify', customIcon: 'https://speechify.com/favicon.ico', expected: '/brand-icons/speechify.png' },
  { url: 'https://www.wellsaid.io', title: 'WellSaid', customIcon: 'https://cdn.prod.website-files.com/673384264721b089c7e053a7/6af242f7fcd95abf454dceda_favicon.png', expected: '/brand-icons/wellsaid.png' },
  { url: 'https://www.naturalreaders.com', title: 'NaturalReader', customIcon: 'https://www.naturalreaders.com/favicon.ico', expected: '/brand-icons/naturalreader.png' },
  { url: 'https://moyin.com', title: '魔音工坊', customIcon: 'https://moyin.com/favicon.ico', expected: '/brand-icons/moyin.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'writesonic.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'jasper.png', width: 128, height: 128 },
  { name: 'copy-ai.png', width: 128, height: 128 },
  { name: 'grammarly.png', width: 48, height: 48 },
  { name: 'xiezuocat.png', width: 128, height: 128 },
  { name: 'wordtune.png', width: 128, height: 128 },
  { name: 'comate.png', width: 40, height: 40 },
  { name: 'continue.png', width: 128, height: 128 },
  { name: 'xfyun.png', width: 32, height: 32 },
  { name: 'udio.png', width: 128, height: 128 },
  { name: 'soundraw.png', width: 128, height: 128 },
  { name: 'aiva.png', width: 128, height: 128 },
  { name: 'boomy.png', width: 128, height: 128 },
  { name: 'mubert.png', width: 128, height: 128 },
  { name: 'loudly.png', width: 128, height: 128 },
  { name: 'murf.png', width: 128, height: 128 },
  { name: 'speechify.png', width: 128, height: 128 },
  { name: 'wellsaid.png', width: 128, height: 128 },
  { name: 'naturalreader.png', width: 24, height: 24 },
  { name: 'moyin.png', width: 32, height: 32 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 3 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（20 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(20)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 19 站按表，SVG 1 站只验存在与文本', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      if (name.endsWith('.png')) {
        const dims = readPngDimensions(buf)
        expect(dims, name).toEqual({ width, height })
      } else {
        expect(buf.toString('utf8').includes('<svg'), name).toBe(true)
      }
    }
  })

  it('单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：writesonic.svg 为橙底（#FF6719）白标、viewBox 0 0 64 64', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const text = readFileSync(`${dir}writesonic.svg`, 'utf8')
    expect(text.includes('<svg')).toBe(true)
    expect(text.includes('viewBox="0 0 64 64"')).toBe(true)
    expect(text.toLowerCase().includes('#ff6719')).toBe(true)
  })

  it('事实钉死：soundraw.png 为 8-bit 调色板 PNG（IHDR 色彩类型 3）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}soundraw.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 128, height: 128 })
    // IHDR：色彩类型在 offset 25；3 = 调色板（按规范 §1.2 压到 ≤ ~15 KB）
    expect(buf[25]).toBe(3)
  })

  it('事实钉死：naturalreader.png 为 24×24 小尺寸原样（源 <128 不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}naturalreader.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 24, height: 24 })
  })

  it('事实钉死：xfyun.png 为 32×32 原样（与讯飞星火 xinghuo.png 不同站不同图标）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}xfyun.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 32, height: 32 })
    // 'xfyun.cn' 与 'xinghuo.xfyun.cn' 各自精确命中，不串站
    expect(resolveSiteIcon('https://www.xfyun.cn/', '讯飞开放平台', 'https://www.xfyun.cn/favicon.ico')).toBe('/brand-icons/xfyun.png')
    expect(resolveSiteIcon('https://xinghuo.xfyun.cn/', '讯飞星火', 'https://xinghuo.xfyun.cn/favicon.ico')).toBe('/brand-icons/xinghuo.png')
  })
})
