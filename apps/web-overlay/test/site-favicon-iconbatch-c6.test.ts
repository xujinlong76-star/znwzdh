import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 6 批（2026-11-19）。
 *
 * 20 站：天猫 / 唯品会 / 苏宁易购 / 1688 / 支付宝 / 亚马逊 /
 * 全球速卖通 / Temu / SHEIN / eBay / Shopify / 百度地图 /
 * 铁路 12306 / 高德地图 / 携程旅行 / 滴滴出行 / 大众点评 /
 * 顺丰速递 / 圆通速递 / 微博。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。20 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；20 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map / 标题规则。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c6/EVIDENCE.md）：
 * - 天猫：天猫首页 apple-touch-icon-precomposed 链接 PNG 114×114 原样。
 * - 唯品会：站方 favicon.ico 单帧 16px 4bpp，原样 16×16（见未决点）。
 * - 苏宁易购：站方 favicon.ico 单帧 40px 32bpp，原样 40×40。
 * - 1688：站方 favicon.ico 最大帧 64px（PNG 内嵌帧），原样 64×64。
 * - 支付宝：首页 shortcut icon 的 mdn 大“支”标 2600×1950 RGBA，仅裁
 *   透明边距后 LANCZOS 缩至 128×109，未改画未改色（见未决点）。
 * - 亚马逊：站方 favicon.ico 最大帧 48px 32bpp，原样 48×48。
 * - 全球速卖通：站方 favicon.ico 单帧 16px 32bpp，原样 16×16（见未决点）。
 * - Temu：首页 rel=icon 链接 PNG 512×512 缩至 128×128。
 * - SHEIN：首页 apple-touch-icon 144 链接 PNG 144×144 缩至 128×128。
 * - eBay：站方 apple-touch-icon.png 60×60 原样（<128 不放大）。
 * - Shopify：首页 apple-touch-icon 链接 PNG 120×120 原样（<128 不放大）。
 * - 百度地图：站方 favicon.ico 最大帧 48px 32bpp，原样 48×48。
 * - 铁路 12306：首页 HTML 内引 index/images/favicon.ico（根路径回 HTML
 *   不可用），9 帧 ICO 取最大 48px 32bpp 帧，原样 48×48。
 * - 高德地图：首页 shortcut icon 链接 favicon.ico 单帧 64px，原样 64×64。
 * - 携程旅行：站方 favicon.ico 单帧 16px 32bpp，原样 16×16（见未决点）。
 * - 滴滴出行：首页 shortcut icon 链接 DDlogo.ico 单帧 44px，原样 44×44。
 * - 大众点评：首页链接的站方 favicon.ico 最大帧 32px，原样 32×32。
 * - 顺丰速运：站方 favicon.ico 单帧 64px，原样 64×64。
 * - 圆通速递：站方 favicon.ico（扩展名 .ico 实为 PNG，按内容解码），64×64 原样。
 * - 微博：站方 favicon.ico 6 帧中取最大 32px 32bpp 帧（非 16 色帧），32×32。
 *
 * 事实钉死（只记、不加底块、不改组件）：
 * - 亚马逊走 '亚马逊' 标题规则（map 精确查找之前），'amazon.com' 键绝不加：
 *   后缀匹配会让 C11 的 AWS WAF（aws.amazon.com）串站解析为 amazon.png。
 *   子串 '亚马逊' 全库 365 站标题仅命中亚马逊一站；AWS WAF 由 C11 落地、
 *   解析为 aws-waf.svg（期望已随 C11 同步改）。
 * - 亚马逊与百度地图源 ICO 字节同为 15,086 B 属巧合（48px BMP 帧定长）；
 *   提取出的 48px PNG 帧 md5 不同（amazon 89fa9c6a… / baidumap dec3cd3d…），
 *   拼图目视分别为笑脸标与图钉标，无串站。
 * - 支付宝未决点：首页另有 32px ICO（蓝底白“支”方标，
 *   img.alicdn.com/tfs/TB1qEwuzrj1gK0jSZFOXXc7GpXa-32-32.ico，200，4,286 B）；
 *   本次选用高清版原样接线，如复审要求与 favicon 完全一致，改用该 32px 帧。
 * - 16px 未决点：唯品会 / 全球速卖通 / 携程旅行只有 16px 官方 favicon
 *   （首页无更大 icon 链接，标准 apple-touch-icon 路径均回 HTML/404，
 *   第三方 logo 站未采用）；按规范 §1.1 原样落盘 16×16、绝不放大。
 *   是否接受 16px 成品、还是另立“低分辨率重做”任务，待裁决。
 * - 小尺寸原样站（源 <128 不放大）：16×16（唯品会 / 全球速卖通 / 携程旅行）、
 *   32×32（大众点评 / 微博）、40×40（苏宁易购）、44×44（滴滴出行）、
 *   48×48（亚马逊 / 百度地图 / 铁路 12306）、60×60（eBay）、
 *   64×64（1688 / 高德地图 / 顺丰速运 / 圆通速递）、114×114（天猫）、
 *   120×120（Shopify）、128×109（支付宝，宽版裁边后非方形）。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 天猫 / 唯品会 / 苏宁易购 / 1688 / 支付宝 的 customIcon 均含 favicon
  { url: 'https://www.tmall.com', title: '天猫', customIcon: 'https://tmall.com/favicon.ico', expected: '/brand-icons/tmall.png' },
  { url: 'https://www.vip.com', title: '唯品会', customIcon: 'https://www.vip.com/favicon.ico', expected: '/brand-icons/vip.png' },
  { url: 'https://www.suning.com', title: '苏宁易购', customIcon: 'https://www.suning.com/favicon.ico', expected: '/brand-icons/suning.png' },
  { url: 'https://www.1688.com', title: '1688', customIcon: 'https://www.1688.com/favicon.ico', expected: '/brand-icons/1688.png' },
  { url: 'https://www.alipay.com/', title: '支付宝', customIcon: 'https://www.alipay.com/favicon.ico', expected: '/brand-icons/alipay.png' },
  // 亚马逊 / 全球速卖通 / Temu / SHEIN / eBay 的 customIcon 均含 favicon
  { url: 'https://www.amazon.com', title: '亚马逊', customIcon: 'https://www.amazon.com/favicon.ico', expected: '/brand-icons/amazon.png' },
  { url: 'https://www.aliexpress.com', title: '全球速卖通', customIcon: 'https://www.aliexpress.com/favicon.ico', expected: '/brand-icons/aliexpress.png' },
  { url: 'https://www.temu.com', title: 'Temu', customIcon: 'https://www.temu.com/favicon.ico', expected: '/brand-icons/temu.png' },
  { url: 'https://www.shein.com', title: 'SHEIN', customIcon: 'https://www.shein.com/favicon.ico', expected: '/brand-icons/shein.png' },
  { url: 'https://www.ebay.com', title: 'eBay', customIcon: 'https://www.ebay.com/favicon.ico', expected: '/brand-icons/ebay.png' },
  // Shopify / 百度地图 / 铁路 12306 / 高德地图 / 携程旅行 的 customIcon 均含 favicon
  { url: 'https://www.shopify.com', title: 'Shopify', customIcon: 'https://www.shopify.com/favicon.ico', expected: '/brand-icons/shopify.png' },
  { url: 'https://map.baidu.com', title: '百度地图', customIcon: 'https://map.baidu.com/favicon.ico', expected: '/brand-icons/baidumap.png' },
  { url: 'https://www.12306.cn', title: '铁路 12306', customIcon: 'https://12306.cn/favicon.ico', expected: '/brand-icons/12306.png' },
  { url: 'https://www.amap.com', title: '高德地图', customIcon: 'https://amap.com/favicon.ico', expected: '/brand-icons/amap.png' },
  { url: 'https://www.ctrip.com', title: '携程旅行', customIcon: 'https://www.ctrip.com/favicon.ico', expected: '/brand-icons/ctrip.png' },
  // 滴滴出行 / 大众点评 / 顺丰速运 / 圆通速递 / 微博 的 customIcon 均含 favicon
  { url: 'https://www.didiglobal.com', title: '滴滴出行', customIcon: 'https://www.didiglobal.com/favicon.ico', expected: '/brand-icons/didi.png' },
  { url: 'https://www.dianping.com', title: '大众点评', customIcon: 'https://www.dianping.com/favicon.ico', expected: '/brand-icons/dianping.png' },
  { url: 'https://www.sf-express.com', title: '顺丰速运', customIcon: 'https://www.sf-express.com/favicon.ico', expected: '/brand-icons/sf-express.png' },
  { url: 'https://www.yto.net.cn', title: '圆通速递', customIcon: 'https://www.yto.net.cn/favicon.ico', expected: '/brand-icons/yto.png' },
  { url: 'https://www.weibo.com', title: '微博', customIcon: 'https://www.weibo.com/favicon.ico', expected: '/brand-icons/weibo.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128，<128 源原样不放大；支付宝为裁透明边距后的 128×109
  { name: 'tmall.png', width: 114, height: 114 },
  { name: 'vip.png', width: 16, height: 16 },
  { name: 'suning.png', width: 40, height: 40 },
  { name: '1688.png', width: 64, height: 64 },
  { name: 'alipay.png', width: 128, height: 109 },
  { name: 'amazon.png', width: 48, height: 48 },
  { name: 'aliexpress.png', width: 16, height: 16 },
  { name: 'temu.png', width: 128, height: 128 },
  { name: 'shein.png', width: 128, height: 128 },
  { name: 'ebay.png', width: 60, height: 60 },
  { name: 'shopify.png', width: 120, height: 120 },
  { name: 'baidumap.png', width: 48, height: 48 },
  { name: '12306.png', width: 48, height: 48 },
  { name: 'amap.png', width: 64, height: 64 },
  { name: 'ctrip.png', width: 16, height: 16 },
  { name: 'didi.png', width: 44, height: 44 },
  { name: 'dianping.png', width: 32, height: 32 },
  { name: 'sf-express.png', width: 64, height: 64 },
  { name: 'yto.png', width: 64, height: 64 },
  { name: 'weibo.png', width: 32, height: 32 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 6 批）', () => {
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

  it('尺寸钉死：PNG 20 站按表（支付宝 128×109，16px 三站 16×16）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：亚马逊走标题规则，AWS WAF 不串站', () => {
    // 'amazon.com' 键绝不进 map（后缀匹配会误伤 aws.amazon.com）
    expect('amazon.com' in LOCAL_LOGO_MAP).toBe(false)
    expect(resolveSiteIcon('https://www.amazon.com', '亚马逊', 'https://www.amazon.com/favicon.ico')).toBe('/brand-icons/amazon.png')
    // AWS WAF（C11 已落地）解析为 aws-waf.svg，不被亚马逊标误指；
    // 期望已随 C11 同步改（仿 C4 同步改 C1 测试的 Trending 期望）
    expect(resolveSiteIcon('https://aws.amazon.com/waf/', 'AWS WAF', 'https://aws.amazon.com/favicon.ico')).toBe('/brand-icons/aws-waf.svg')
  })

  it('事实钉死：亚马逊与百度地图同源字节、不同标、无串站', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const amazon = readFileSync(`${dir}amazon.png`)
    const baidumap = readFileSync(`${dir}baidumap.png`)
    expect(readPngDimensions(amazon)).toEqual({ width: 48, height: 48 })
    expect(readPngDimensions(baidumap)).toEqual({ width: 48, height: 48 })
    // 源 ICO 同为 15,086 B 属巧合；提取帧 md5 不同（见文件头注释）
    expect(amazon.equals(baidumap)).toBe(false)
    expect(resolveSiteIcon('https://www.amazon.com', '亚马逊', 'https://www.amazon.com/favicon.ico')).toBe('/brand-icons/amazon.png')
    expect(resolveSiteIcon('https://map.baidu.com', '百度地图', 'https://map.baidu.com/favicon.ico')).toBe('/brand-icons/baidumap.png')
  })

  it('事实钉死：支付宝为 128×109 大“支”标原样（32px 蓝底 ICO 备选为未决点）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}alipay.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 128, height: 109 })
    expect(statSync(`${dir}alipay.png`).size).toBeLessThanOrEqual(15 * 1024)
    expect(resolveSiteIcon('https://www.alipay.com/', '支付宝', 'https://www.alipay.com/favicon.ico')).toBe('/brand-icons/alipay.png')
  })

  it('事实钉死：唯品会 / 全球速卖通 / 携程旅行只有 16px 官方 favicon（未决点）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['vip.png', 'aliexpress.png', 'ctrip.png']) {
      const buf = readFileSync(`${dir}${name}`)
      // 按规范 §1.1 原样保留、绝不放大；是否接受 16px 成品待裁决
      expect(readPngDimensions(buf), name).toEqual({ width: 16, height: 16 })
    }
    expect(resolveSiteIcon('https://www.vip.com', '唯品会', 'https://www.vip.com/favicon.ico')).toBe('/brand-icons/vip.png')
    expect(resolveSiteIcon('https://www.aliexpress.com', '全球速卖通', 'https://www.aliexpress.com/favicon.ico')).toBe('/brand-icons/aliexpress.png')
    expect(resolveSiteIcon('https://www.ctrip.com', '携程旅行', 'https://www.ctrip.com/favicon.ico')).toBe('/brand-icons/ctrip.png')
  })
})
