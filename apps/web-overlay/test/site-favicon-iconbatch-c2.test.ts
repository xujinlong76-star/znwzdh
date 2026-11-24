import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 2 批（2026-11-18）。
 *
 * 20 站：G1 元宝搜索 / 秘塔搜索 / 天工AI搜索；G2 Pika / Viggle AI / Genmo；
 * G3 Vidu / Krea / Deep Dream Generator；G4 Remove.bg / 魔搭 ModelScope /
 * 百度飞桨；G5 Stability AI / Mistral AI / Meta AI Developers；G6 Gitee AI /
 * Flowise / Apify；G7 Devin Desktop / Topview。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。20 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；19 站 customIcon 为本站远端
 * …/favicon.ico、1 站（Devin Desktop）为 windsurf.ai 的远端 favicon.ico，
 * 均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（逐站见各组 manifest）：
 * - 元宝：so.qq.com favicon.ico（302 至 sogoucdn，192×192）缩至 128。
 * - 秘塔：官网 apple-touch-icon.png（1024×1024）缩至 128；favicon 为深蓝
 *   透明底 M 标，深色对比度弱，未采用。
 * - 天工：www.tiangong.cn favicon.ico，ICO 内 PNG 29×28，原样不放大。
 * - Pika：官网 icon.svg；2026-11-24 深色复核 W7 已删 SVG 内 @media
 *   (prefers-color-scheme: dark) 翻转（93a8d1eed），固定为黑色静态版。
 * - Viggle：官网 favicon.svg，白外框 + 黑内芯双色 V 盾标。
 * - Genmo：www.genmo.ai favicon.ico 最大帧 48×48（32bpp，已避默认帧陷阱）。
 * - Vidu：官网 logo.svg（favicon.ico 实测 500，不可用）；自带 #03061E
 *   深海军蓝圆角底 + 浅色渐变 V 标。
 * - Krea：官网 favicon-192.png 浅色版（192×192）缩至 128；ICO 最大帧仅
 *   32×32，未采用；深色版未落盘（单文件机制不支持按主题切换）。
 * - Deep Dream Generator：官网 CDN favicon-144.png（144×144）缩至 128。
 * - Remove.bg：官网 apple-touch-icon.png（180×180）缩至 128；黄底满铺。
 * - ModelScope：官网 favicon.ico 单帧 128×128 原样提取；紫底满铺。
 * - 飞桨：官网声明的 CDN favicon-128.png 原样落盘；官网 favicon.ico 仅
 *   16×13 单帧，未采用。
 * - Stability：官网 favicon.ico（Squarespace CDN 100×100）原样不放大。
 * - Mistral：官网 favicon.svg 原样；与官网 wordmark 逐矩形比对一致。
 * - Meta AI：见下文 Wayback 说明。
 * - Gitee AI：moark.com favicon.ico 最大帧 48×48；黑盘白网格标。
 * - Flowise：官网 favicon.ico 最大帧 48×48；与官方 GitHub 仓库同文件
 *   MD5 一致；深蓝紫渐变圆角方块底。
 * - Apify：官网 favicon.svg 原样，与首页 icon0.svg MD5 一致；三色三角 A 标。
 * - Devin：官网 favicon.svg 原样；navigation.json 的 icon 字段写的是
 *   windsurf.ai 的 favicon.ico（错域，与本站无关），同样被拦截；只建
 *   'devin.ai' 键，绝不建 windsurf 键。
 * - Topview：官网声明的 webp（210×210）转 PNG 缩至 128；紫底 #731DFB 白标。
 *
 * Meta AI（dev.meta.ai）Wayback 来源——如实记录：
 * 官网直连已穷尽均失败：dev.meta.ai/、favicon.ico、favicon.svg、
 * apple-touch-icon.png、manifest.json、www.meta.ai/favicon.ico 全部
 * HTTP 403（疑似机器人防护）；browser.open 直访亦被控制面拦截。
 * 采用的来源是 Wayback Machine 存档的官网 favicon 原件：
 * https://web.archive.org/web/20261110164234id_/https://dev.meta.ai/favicon.ico
 * （快照 2026-11-10 16:42:34；CDX mimetype image/vnd.microsoft.icon、
 * statuscode 200）；ICO 含 16/32/48/64 四帧 32bpp，取最大帧 64×64 转 PNG
 * 落盘。未用任何第三方图标库或非 Meta 域名来源。键须用完整子域
 * 'dev.meta.ai'，不得简写为 'meta.ai'。
 *
 * 深色事实钉死（只记、不加底块、不改组件）：
 * - devin.svg 为透明底黑标（单条 path fill="black"，无背景 rect），
 *   深色下对比度弱是已知局限（同 Ollama / SourceHut / Notion / Radix），
 *   留待深色底块统一处理轮。
 * - moark.png 为透明底黑盘（RGBA，黑圆盘 + 白网格线），深色下盘缘可能
 *   融入背景，同属已知黑标类别，留待深色底块统一处理轮。
 * - tiangong.png 为 29×28 小尺寸原样（源 <128 不放大），渲染 24×24，
 *   亮蓝 + 亮青双色标，双主题可辨。
 * - meta-ai.png 来源为 Wayback 存档（见上文），64×64 原样不放大，
 *   透明底亮蓝渐变环，双主题可辨。
 * - 其余站自带底色或亮色标：元宝/秘塔蓝底白标、Pika 黑标（W7 已删深色翻转）、
 *   Viggle 双色标、Genmo 彩色方块、Vidu 深蓝底、Krea 浅灰底黑标、
 *   Deep Dream Generator 透明底橙标、Remove.bg 黄底、ModelScope 紫底、
 *   飞桨蓝底、Stability 紫渐变圆底黑 S.、Mistral 橙红渐变、Flowise
 *   深蓝紫渐变底、Apify 三色标、Topview 紫底白标，不处理。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // G1：域名映射；元宝/秘塔/天工的 customIcon 均为远端 …/favicon.ico
  { url: 'https://so.qq.com', title: '元宝搜索', customIcon: 'https://so.qq.com/favicon.ico', expected: '/brand-icons/yuanbao.png' },
  { url: 'https://metaso.cn/', title: '秘塔搜索', customIcon: 'https://metaso.cn/favicon.ico', expected: '/brand-icons/metaso.png' },
  { url: 'https://www.tiangong.cn/', title: '天工AI搜索', customIcon: 'https://www.tiangong.cn/favicon.ico', expected: '/brand-icons/tiangong.png' },
  // G2：域名映射；Pika / Viggle AI / Genmo 的 customIcon 均为远端 …/favicon.ico
  { url: 'https://pika.art', title: 'Pika', customIcon: 'https://pika.art/favicon.ico', expected: '/brand-icons/pika.svg' },
  { url: 'https://viggle.ai', title: 'Viggle AI', customIcon: 'https://viggle.ai/favicon.ico', expected: '/brand-icons/viggle.svg' },
  { url: 'https://genmo.ai', title: 'Genmo', customIcon: 'https://genmo.ai/favicon.ico', expected: '/brand-icons/genmo.png' },
  // G3：域名映射；Vidu / Krea / Deep Dream Generator 的 customIcon 均为远端 …/favicon.ico
  { url: 'https://www.vidu.cn', title: 'Vidu', customIcon: 'https://www.vidu.cn/favicon.ico', expected: '/brand-icons/vidu.svg' },
  { url: 'https://krea.ai', title: 'Krea', customIcon: 'https://krea.ai/favicon.ico', expected: '/brand-icons/krea.png' },
  { url: 'https://deepdreamgenerator.com', title: 'Deep Dream Generator', customIcon: 'https://deepdreamgenerator.com/favicon.ico', expected: '/brand-icons/deepdreamgenerator.png' },
  // G4：域名映射；Remove.bg / 魔搭 ModelScope / 百度飞桨的 customIcon 均为远端 …/favicon.ico
  { url: 'https://www.remove.bg', title: 'Remove.bg', customIcon: 'https://remove.bg/favicon.ico', expected: '/brand-icons/removebg.png' },
  { url: 'https://modelscope.cn', title: '魔搭 ModelScope', customIcon: 'https://modelscope.cn/favicon.ico', expected: '/brand-icons/modelscope.png' },
  { url: 'https://www.paddlepaddle.org.cn/', title: '百度飞桨', customIcon: 'https://www.paddlepaddle.org.cn/favicon.ico', expected: '/brand-icons/paddlepaddle.png' },
  // G5：域名映射；Stability AI / Mistral AI / Meta AI Developers 的 customIcon 均为远端 …/favicon.ico
  { url: 'https://stability.ai/', title: 'Stability AI', customIcon: 'https://stability.ai/favicon.ico', expected: '/brand-icons/stability.png' },
  { url: 'https://mistral.ai/', title: 'Mistral AI', customIcon: 'https://mistral.ai/favicon.ico', expected: '/brand-icons/mistral.svg' },
  { url: 'https://dev.meta.ai/', title: 'Meta AI Developers', customIcon: 'https://dev.meta.ai/favicon.ico', expected: '/brand-icons/meta-ai.png' },
  // G6：域名映射；Gitee AI / Flowise / Apify 的 customIcon 均为远端 …/favicon.ico
  { url: 'https://moark.com', title: 'Gitee AI', customIcon: 'https://moark.com/favicon.ico', expected: '/brand-icons/moark.png' },
  { url: 'https://flowiseai.com', title: 'Flowise', customIcon: 'https://flowiseai.com/favicon.ico', expected: '/brand-icons/flowise.png' },
  { url: 'https://apify.com', title: 'Apify', customIcon: 'https://apify.com/favicon.ico', expected: '/brand-icons/apify.svg' },
  // G7：域名映射；Topview 的 customIcon 为远端 …/favicon.ico；Devin 的
  // customIcon 是 windsurf.ai 的远端 favicon.ico（错域），同样被拦截，
  // 只建 'devin.ai' 键，绝不建 windsurf 键
  { url: 'https://devin.ai/desktop', title: 'Devin Desktop', customIcon: 'https://windsurf.ai/favicon.ico', expected: '/brand-icons/devin.svg' },
  { url: 'https://www.topview.ai', title: 'Topview', customIcon: 'https://www.topview.ai/favicon.ico', expected: '/brand-icons/topview.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'pika.svg', width: 0, height: 0 },
  { name: 'viggle.svg', width: 0, height: 0 },
  { name: 'vidu.svg', width: 0, height: 0 },
  { name: 'mistral.svg', width: 0, height: 0 },
  { name: 'apify.svg', width: 0, height: 0 },
  { name: 'devin.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'yuanbao.png', width: 128, height: 128 },
  { name: 'metaso.png', width: 128, height: 128 },
  { name: 'tiangong.png', width: 29, height: 28 },
  { name: 'genmo.png', width: 48, height: 48 },
  { name: 'krea.png', width: 128, height: 128 },
  { name: 'deepdreamgenerator.png', width: 128, height: 128 },
  { name: 'removebg.png', width: 128, height: 128 },
  { name: 'modelscope.png', width: 128, height: 128 },
  { name: 'paddlepaddle.png', width: 128, height: 128 },
  { name: 'stability.png', width: 100, height: 100 },
  { name: 'meta-ai.png', width: 64, height: 64 },
  { name: 'moark.png', width: 48, height: 48 },
  { name: 'flowise.png', width: 48, height: 48 },
  { name: 'topview.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 2 批）', () => {
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

  it('尺寸钉死：PNG 14 站按表，SVG 6 站只验存在与文本', () => {
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

  it('深色事实钉死：devin.svg 为透明底黑标（单条 path fill="black"，无背景 rect）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const text = readFileSync(`${dir}devin.svg`, 'utf8')
    expect(text.includes('<svg')).toBe(true)
    expect(text.includes('fill="black"')).toBe(true)
    expect(text.includes('<rect')).toBe(false)
  })

  it('深色事实钉死：moark.png 为透明底 RGBA（IHDR 色彩类型 6，黑盘白网格标）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}moark.png`)
    // IHDR：色彩类型在 offset 25；6 = RGBA（带 alpha 通道，透明底）
    expect(buf[25]).toBe(6)
  })

  it('深色事实钉死：tiangong.png 为 29×28 小尺寸原样（源 <128 不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}tiangong.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 29, height: 28 })
  })

  it('深色事实钉死：meta-ai.png 来源为 Wayback 存档、64×64 原样不放大（透明底亮蓝渐变环）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}meta-ai.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 64, height: 64 })
    // IHDR：色彩类型在 offset 25；6 = RGBA（带 alpha 通道，透明底）
    expect(buf[25]).toBe(6)
  })
})
