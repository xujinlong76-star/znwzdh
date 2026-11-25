import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 剩余图标补齐 W8（2026-11-25，开发者资源组 6 站）：
 * V2EX、百度知道、CS自学指南、JavaGuide、W3Schools、Exercism。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。本站的 href / 标题 / customIcon 均按当前基分支的
 * navigation.json 逐个核对，不可猜；6 站 customIcon 均为远端 favicon
 * （含 Exercism 的 …/favicon-32x32.png，路径含 favicon），被
 * isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-25，curl，Chrome UA，全部 200）：
 * - V2EX：首页声明的 icon-192.png
 *   https://www.v2ex.com/static/icon-192.png（200、image/png、13,257 B、
 *   192×192 RGBA；根 /static/favicon.ico 为 32×32 PNG 内容 1,313 B，
 *   同一 V 标，未用）。LANCZOS 192→128 落盘 v2ex.png（5,091 B，md5
 *   e7bbea518f98769a149ece0b76eaba2c）。白底浅灰渐变方块 + V 标，
 *   四角不透明（白），ASCII 渲染确认 V 形标完整。
 * - 百度知道：站方自有 favicon
 *   https://zhidao.baidu.com/favicon.ico（200、image/x-icon、5,686 B、
 *   ICO 双帧 16×16 8bpp + 32×32 32bpp）。最大帧 32×32 原样落盘
 *   zhidao.png（1,067 B，md5 2f5126e5d17f5b72a1e90cf4c79ed727），
 *   绝不放大。蓝底 #2932E1 + 白色百度“du”爪标（与 baidu.com 主标
 *   64×64 白底蓝标同一图形、反色版，像素比对确认）；首页声明的
 *   //www.baidu.com/favicon.ico 未用——本站用知道自有蓝底白标版。
 * - CS自学指南：站方唯一官方源
 *   https://csdiy.wiki/images/favicon.ico（200、image/vnd.microsoft.icon、
 *   4,286 B、ICO 单帧 32×32 32bpp；首页无 icon 声明）。32×32 原样
 *   落盘 csdiy.png（1,610 B，md5 da3720eb5ac301834ee78d62157dd0ed），
 *   绝不放大。透明底 + 蓝色 #3F8CB9 学位帽标，四角透明。
 * - JavaGuide：首页声明 /favicon.ico
 *   https://javaguide.cn/favicon.ico（200、image/x-icon、19,184 B、
 *   ICO 单帧 256×256 PNG 内嵌）。内容 bbox (41,50,213,187)，仅去
 *   透明留白（+4px 边，180×145，不重绘）后 LANCZOS 宽缩至 128 落盘
 *   javaguide.png（128×103，11,740 B，md5
 *   87e5f1352ed8c8f8a221d7753b8bab9b）。红 #D32F2F 图形 + 蓝
 *   #006699/#1E88E5 + 底部 JavaGuide 字标，透明底，ASCII 渲染确认
 *   图形与字标均完整。
 * - W3Schools：首页声明的最大尺寸 icon
 *   https://www.w3schools.com/apple-touch-icon.png（200、image/png、
 *   3,065 B、180×180 8-bit colormap，白底）。LANCZOS 180→128 落盘
 *   w3schools.png（5,377 B，md5 82ad7e2882548b4cd179958883982c92）。
 *   白底不透明 + 绿 #009A68 W3 标。根 /favicon.ico 最大帧 48×48
 *   透明底同标未用（首页声明最大尺寸优先，W2 芒果TV先例），改用
 *   48 版由复审裁决。
 * - Exercism：首页声明的最大尺寸 icon
 *   https://assets.exercism.org/meta/apple-touch-icon.png（200、image/png、
 *   21,752 B、180×180 RGBA；nav icon 字段的 favicon-32x32.png 为同标
 *   透明底 32×32 未用）。128 版 19,778 B 超 ~15KB 参考线，故取
 *   96×96 LANCZOS 落盘 exercism.png（11,537 B，md5
 *   3dcd62acf771f088a0396490fb784047；96px 在 28px 卡片与 64px 详情
 *   徽标下均 ≥1.5× 仍清晰，非放大、非重绘）。深紫渐变底 + 白色 E 形标，
 *   不透明，ASCII 渲染确认标志完好。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 388 站核对：6 键各只命中 1 站（v2ex.com→V2EX、
 *   zhidao.baidu.com→百度知道、csdiy.wiki→CS自学指南、
 *   javaguide.cn→JavaGuide、w3schools.com→W3Schools、
 *   exercism.org→Exercism），无后缀串站、无子域站；'baidu.com' 裸域键
 *   绝不加（map 内已有 yiyan/wenxin/comate/map/dumate 五个
 *   *.baidu.com 精确键，精确查找优先于后缀循环；百度主站无精确键，
 *   仍回落字母徽标，见下方守卫断言）；navigation.json 不动；其余
 *   worker 分工站本文件不碰、不断言，免得合流时互相绊住。
 * - 尺寸钉死：zhidao / csdiy 为 32×32 原样（不放大）；javaguide 为
 *   去留白后 128×103（宽 128，非方形系原标图文版式所致）；其余按表。
 *   6 文件均 ≤ 15 KB。
 * - 6 标均为真实品牌标，浅/深主题均可辨识，按统一规范 §9 不做单站
 *   底块补丁、不配 LOGO_TILE_MAP（resolveLogoTile 为 null），留待
 *   统一处理轮。
 * - 本批实施中未出现任何安全系统移除提示；17K小说网 / 书旗小说 /
 *   Adobe Color 不在本组、不碰。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.v2ex.com', title: 'V2EX', customIcon: 'https://www.v2ex.com/static/favicon.ico', expected: '/brand-icons/v2ex.png' },
  { url: 'https://zhidao.baidu.com', title: '百度知道', customIcon: 'https://zhidao.baidu.com/favicon.ico', expected: '/brand-icons/zhidao.png' },
  { url: 'https://csdiy.wiki', title: 'CS自学指南', customIcon: 'https://csdiy.wiki/images/favicon.ico', expected: '/brand-icons/csdiy.png' },
  { url: 'https://javaguide.cn', title: 'JavaGuide', customIcon: 'https://javaguide.cn/favicon.ico', expected: '/brand-icons/javaguide.png' },
  { url: 'https://www.w3schools.com', title: 'W3Schools', customIcon: 'https://www.w3schools.com/favicon.ico', expected: '/brand-icons/w3schools.png' },
  { url: 'https://exercism.org', title: 'Exercism', customIcon: 'https://assets.exercism.org/meta/favicon-32x32.png', expected: '/brand-icons/exercism.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'v2ex.png', width: 128, height: 128, bytes: 5091 },
  { name: 'zhidao.png', width: 32, height: 32, bytes: 1067 },
  { name: 'csdiy.png', width: 32, height: 32, bytes: 1610 },
  { name: 'javaguide.png', width: 128, height: 103, bytes: 11740 },
  { name: 'w3schools.png', width: 128, height: 128, bytes: 5377 },
  { name: 'exercism.png', width: 96, height: 96, bytes: 11537 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（剩余图标补齐 W8）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（6 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(6)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸与字节数钉死：PNG 6 站按表（原样 / 去留白后宽缩，不放大）', () => {
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

  it('无底块：6 站 resolveLogoTile 均为 null（规范 §9，留待统一处理轮）', () => {
    for (const { url } of CASES) {
      expect(resolveLogoTile(url), url).toBeNull()
    }
  })

  it('不串站：baidu.com 裸域无键，百度主站不解析为百度知道标', () => {
    expect(resolveSiteIcon('https://www.baidu.com', '百度')).not.toBe('/brand-icons/zhidao.png')
  })
})
