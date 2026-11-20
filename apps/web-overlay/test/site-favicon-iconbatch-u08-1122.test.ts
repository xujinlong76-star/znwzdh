import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * U-08 补站三站（2026-11-20 进化轮 11:22）：彩云天气（气象与环境 5→6）、
 * Iconfont（图标与字体 7→8）、Microsoft Learn（官方文档 7→8），总站 380→383。
 *
 * 三站 navigation.json 条目均带 icon 字段（远端 …/favicon.ico），解析时被
 * isRemoteRawFavicon 拦截、回落 LOCAL_LOGO_MAP 的 hostname 精确查找；
 * 故本批 CASES 必须传三参数（url, title, customIcon）。href / 标题均按
 * 当前 main 的 navigation.json 逐个核对，不可猜。
 *
 * 来源要点（实施线实测 2026-11-20 11:27–11:40）：
 * - 彩云天气：www.caiyunapp.com/ 200×3（110,624 B，标题「彩云科技」为公司
 *   首页，非天气页）；在线天气查询入口 /weather 302 至 h5.caiyunapp.com/
 *   200×3（301,616 B，标题「彩云天气」），故 href 用 /weather。站方
 *   favicon.ico 内容实为 PNG 190×190（7,165 B，白圆角底 + 橙绿渐变云标，
 *   四角透明），原样落盘 caiyun.png，md5 1452fa082142f0db9dff9a9ad7ea27a9。
 * - Iconfont：www.iconfont.cn/ 200×3（2,840 B，SPA 壳，标题
 *   「iconfont-阿里巴巴矢量图标库」）；favicon.ico 302 至 img.alicdn.com
 *   官方标 SVG（83×82，5,688 B），原样落盘 iconfont.svg，md5
 *   dcc980d06bc7209d1c9ec24870620f0d。原 map 值上游底座 44×44 WebP
 *   （/assets/images/logos/iconfont.webp）同步改指本 SVG，旧值不再被引用。
 * - Microsoft Learn：learn.microsoft.com/zh-cn/ 200×3（约 26,963 B），
 *   最终 URL 仍为 zh-cn，未跳回 /en-us/。站方 favicon.ico 为 6 尺寸 ICO，
 *   最大 128×128 帧为微软四色方块标（#F25022/#7FBA00/#00A4EF/#FFB900，
 *   间隙透明），PIL 转 RGBA PNG 原样落盘 microsoft-learn.png（426 B），
 *   md5 b61c4227f5dcd0ed5368ea1ab8a42ad6；按「官网在用图标」原样接线
 *   （仿 Java 官方文档的 Oracle 红 O 标先例），未擅自换标。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 三标均彩色明亮，无需底块（resolveLogoTile 均为 null），不做单站补丁。
 * - 全库 383 站核对：'caiyunapp.com' / 'iconfont.cn' /
 *   'learn.microsoft.com' 三键各只命中本站，无后缀串站；不建
 *   'microsoft.com' 裸域键（防后缀串站）。
 * - 定价：彩云天气 freemium（免费版 + SVIP ¥9/月、¥90/年，Pro 解锁专属
 *   降雨提醒与去广告）；Iconfont freemium（基础功能与图标资源免费，部分
 *   优质商用资源与团队增值服务付费）；Microsoft Learn free（微软官方 FAQ：
 *   Learn 培训免费、向所有人开放，认证考试另行付费）。
 */

const CASES: Array<{ url: string; title: string; customIcon: string; expected: string }> = [
  // 彩云天气：href 用 /weather（在线天气查询入口），icon 字段走 map
  { url: 'https://www.caiyunapp.com/weather', title: '彩云天气', customIcon: 'https://www.caiyunapp.com/favicon.ico', expected: '/brand-icons/caiyun.png' },
  { url: 'https://caiyunapp.com/weather', title: '彩云天气', customIcon: 'https://www.caiyunapp.com/favicon.ico', expected: '/brand-icons/caiyun.png' },
  // Iconfont：icon 字段走 map（改指后的 brand-icons/iconfont.svg）
  { url: 'https://www.iconfont.cn', title: 'Iconfont', customIcon: 'https://www.iconfont.cn/favicon.ico', expected: '/brand-icons/iconfont.svg' },
  { url: 'https://iconfont.cn', title: 'Iconfont', customIcon: 'https://www.iconfont.cn/favicon.ico', expected: '/brand-icons/iconfont.svg' },
  // Microsoft Learn：中文版 href，icon 字段走 map
  { url: 'https://learn.microsoft.com/zh-cn/', title: 'Microsoft Learn', customIcon: 'https://learn.microsoft.com/favicon.ico', expected: '/brand-icons/microsoft-learn.png' },
  { url: 'https://learn.microsoft.com/zh-cn', title: 'Microsoft Learn', customIcon: 'https://learn.microsoft.com/favicon.ico', expected: '/brand-icons/microsoft-learn.png' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function md5(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex')
}

describe('resolveSiteIcon（U-08 补站三站 2026-11-20 11:22）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it("LOCAL_LOGO_MAP 三键指向 brand-icons 本地资产", () => {
    expect(LOCAL_LOGO_MAP['caiyunapp.com']).toBe('/brand-icons/caiyun.png')
    expect(LOCAL_LOGO_MAP['iconfont.cn']).toBe('/brand-icons/iconfont.svg')
    expect(LOCAL_LOGO_MAP['learn.microsoft.com']).toBe('/brand-icons/microsoft-learn.png')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（3 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}caiyun.png`), 'caiyun.png').toBe(true)
    expect(existsSync(`${dir}iconfont.svg`), 'iconfont.svg').toBe(true)
    expect(existsSync(`${dir}microsoft-learn.png`), 'microsoft-learn.png').toBe(true)
  })

  it('PNG 原样钉死：彩云天气 190×190、Microsoft Learn 128×128、md5 一致', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const caiyun = readFileSync(`${dir}caiyun.png`)
    expect(statSync(`${dir}caiyun.png`).size).toBe(7165)
    expect(readPngDimensions(caiyun)).toEqual({ width: 190, height: 190 })
    expect(md5(caiyun)).toBe('1452fa082142f0db9dff9a9ad7ea27a9')
    const learn = readFileSync(`${dir}microsoft-learn.png`)
    expect(statSync(`${dir}microsoft-learn.png`).size).toBe(426)
    expect(readPngDimensions(learn)).toEqual({ width: 128, height: 128 })
    expect(md5(learn)).toBe('b61c4227f5dcd0ed5368ea1ab8a42ad6')
  })

  it('SVG 原样钉死：Iconfont 83×82、5,688 B、md5 一致', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}iconfont.svg`).size).toBe(5688)
    const svg = readFileSync(`${dir}iconfont.svg`, 'utf8')
    expect(svg.includes('<svg')).toBe(true)
    expect(svg.includes('width="83"')).toBe(true)
    expect(svg.includes('height="82"')).toBe(true)
    expect(md5(readFileSync(`${dir}iconfont.svg`))).toBe('dcc980d06bc7209d1c9ec24870620f0d')
  })

  it('事实钉死：三站均无底块', () => {
    expect(resolveLogoTile('https://www.caiyunapp.com/weather')).toBeNull()
    expect(resolveLogoTile('https://www.iconfont.cn')).toBeNull()
    expect(resolveLogoTile('https://learn.microsoft.com/zh-cn/')).toBeNull()
  })

  it('事实钉死：旧 iconfont WebP 值不再被引用', () => {
    expect(Object.values(LOCAL_LOGO_MAP).includes('/assets/images/logos/iconfont.webp')).toBe(false)
  })

  it('防回归：microsoft.com 裸域绝不解析到 microsoft-learn.png', () => {
    // 'microsoft.com' 键绝不进 map；将来若有人加裸域键，本断言先失败即为提醒。
    expect(resolveSiteIcon('https://www.microsoft.com', 'Microsoft')).not.toBe('/brand-icons/microsoft-learn.png')
    expect(resolveSiteIcon('https://learn.microsoft.com/zh-cn/', 'Microsoft Learn')).toBe('/brand-icons/microsoft-learn.png')
  })

  it('事实钉死：三键不串站（无同名站、无子域站）', () => {
    expect(resolveSiteIcon('https://caiyunapp.com/weather', '彩云天气')).toBe('/brand-icons/caiyun.png')
    expect(resolveSiteIcon('https://iconfont.cn', 'Iconfont')).toBe('/brand-icons/iconfont.svg')
    expect(resolveSiteIcon('https://learn.microsoft.com/zh-cn', 'Microsoft Learn')).toBe('/brand-icons/microsoft-learn.png')
  })
})
