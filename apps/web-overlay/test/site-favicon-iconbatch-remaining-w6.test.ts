import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 剩余图标补齐 W6 政务/考试组（2026-11-25）：
 * 国家公务员局 / 2027年国家公务员考试专题 / 中央机关公开遴选和公开选调专题。
 * 其余 3 站（中公教育、国家网信办举报中心、公安部）本批阻塞未入，
 * 本文件只钉死阻塞事实（不解析到本地图标），不建键、不落盘。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。三站的 href / 标题 / customIcon 均按当前 navigation.json
 * 逐个核对，不可猜；三站 icon 字段均为远端
 * http://www.scs.gov.cn/favicon.ico，被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-25 11:2x CST 复测，curl，Chrome UA，见 EVIDENCE-w6.md）：
 * - www.scs.gov.cn 首页（http://www.scs.gov.cn/gkIndex.html）、站根、
 *   /favicon.ico 均回机器人验证墙：HTTP 200 但体为 EO_Bot_Ssid 混淆 JS
 *   挑战页（985/987/988 B），不是图标；https 全站连接失败（仅 http 可达）。
 * - bm.scs.gov.cn / subb.scs.gov.cn 首页为 JS 跳转页（335/260 B），站根
 *   /favicon.ico 与 /apple-touch-icon.png 均 404。
 * - 真正的官方标志取自三站共用的 gkweb 平台静态 host dl.scs.gov.cn
 *   （无墙）：bm/subb 实页 gkhome.html / lxhome.html 均无 rel=icon 声明，
 *   页头 logo-box 的 background 即
 *   http://dl.scs.gov.cn/pp/gkweb/core/web/ui/images/common/logo.png
 *   （200、image/png、16,233 B、80×84 RGBA，md5
 *   bc05012735ab6609bdccd258de168d20）。像素实测：红底圆徽 #D020 系 +
 *   金色 #E0B040 星穗、国徽造型，四角透明，ASCII 渲染确认圆形徽章完整。
 *   三站同平台同标、同 favicon 源，故一标三键共用 scs.png。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 388 站核对：'scs.gov.cn' / 'bm.scs.gov.cn' / 'subb.scs.gov.cn'
 *   三键只命中此 3 站，无后缀串站、无子域站；'gov.cn' 裸域键绝不加
 *   （C12 裁决：后缀匹配会让全库 *.gov.cn 错指中国政府网国徽标）。
 * - 尺寸钉死：scs.png 80×84 原样（< 128，按规范 §1.1 原样不放大）。
 * - 16,233 B 略超 ~15 KB 参考线（超 873 B），按 C7 W3 dramabox.png
 *   （15,595 B）先例原样接线、字节数与 md5 测试钉死，不做有损重编码。
 * - 红底实色圆徽浅/深主题均可辨，按统一规范 §9 不做单站底块补丁、
 *   不配 LOGO_TILE_MAP（resolveLogoTile 为 null），留待统一处理轮。
 * - 阻塞事实钉死：中公教育（offcn.com 全路径 403 openresty WAF，
 *   含 www/m 站与全套浏览器头，裸域连接失败）、国家网信办举报中心
 *   （12377.cn 全路径 403 加速乐反爬挑战页，裸域连接失败）、公安部
 *   （mps.gov.cn 全路径 521 + Cloudflare __jsl_clearance 挑战脚本，
 *   裸域连接失败）——三站均不解析到本地图标，待浏览器实访，不拿第
 *   三方图标库顶替、不造假。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'http://www.scs.gov.cn/gkIndex.html', title: '国家公务员局', customIcon: 'http://www.scs.gov.cn/favicon.ico', expected: '/brand-icons/scs.png' },
  { url: 'http://bm.scs.gov.cn/kl2027', title: '2027年国家公务员考试专题', customIcon: 'http://www.scs.gov.cn/favicon.ico', expected: '/brand-icons/scs.png' },
  { url: 'http://subb.scs.gov.cn/lx2027', title: '中央机关公开遴选和公开选调专题', customIcon: 'http://www.scs.gov.cn/favicon.ico', expected: '/brand-icons/scs.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number; md5: string }> = [
  { name: 'scs.png', width: 80, height: 84, bytes: 16233, md5: 'bc05012735ab6609bdccd258de168d20' },
]

/** 阻塞站：navigation.json 的真实 href / 标题 / customIcon，不得解析到本地图标。 */
const BLOCKED_CASES: Array<{ url: string; title: string; customIcon?: string }> = [
  { url: 'https://www.offcn.com', title: '中公教育', customIcon: 'https://www.offcn.com/favicon.ico' },
  { url: 'https://www.12377.cn', title: '国家网信办举报中心', customIcon: 'https://12377.cn/favicon.ico' },
  { url: 'https://www.mps.gov.cn', title: '公安部', customIcon: 'https://www.mps.gov.cn/favicon.ico' },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（剩余图标补齐 W6 政务/考试组）', () => {
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

  it('尺寸、字节数与 md5 钉死：PNG 1 站按表（原样，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height, bytes, md5 } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width, height })
      expect(statSync(`${dir}${name}`).size, name).toBe(bytes)
      expect(createHash('md5').update(buf).digest('hex'), name).toBe(md5)
    }
  })

  it('超线说明：scs.png 16,233 B 略超 ~15 KB 参考线，按 C7 W3 dramabox 先例原样接线', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(statSync(`${dir}scs.png`).size).toBe(16233)
    expect(statSync(`${dir}scs.png`).size).toBeGreaterThan(15 * 1024)
  })

  it('事实钉死：三站均无深色底块（resolveLogoTile 为 null）', () => {
    expect(resolveLogoTile('http://www.scs.gov.cn/gkIndex.html')).toBeNull()
    expect(resolveLogoTile('http://bm.scs.gov.cn/kl2027')).toBeNull()
    expect(resolveLogoTile('http://subb.scs.gov.cn/lx2027')).toBeNull()
  })

  it('事实钉死：不串站——gov.cn 裸域键与阻塞站键均不存在，公安部/中国政府网不解析为 scs.png', () => {
    expect(LOCAL_LOGO_MAP['gov.cn']).toBeUndefined()
    expect(LOCAL_LOGO_MAP['offcn.com']).toBeUndefined()
    expect(LOCAL_LOGO_MAP['12377.cn']).toBeUndefined()
    expect(LOCAL_LOGO_MAP['mps.gov.cn']).toBeUndefined()
    expect(resolveSiteIcon('https://www.mps.gov.cn', '公安部', 'https://www.mps.gov.cn/favicon.ico')).not.toBe('/brand-icons/scs.png')
    expect(resolveSiteIcon('https://www.gov.cn/', '中国政府网', 'https://www.gov.cn/favicon.ico')).toBe('/brand-icons/gov.png')
  })

  it.each(BLOCKED_CASES)('阻塞事实钉死：$title 不解析到本地图标（待浏览器实访）', ({ url, title, customIcon }) => {
    expect(resolveSiteIcon(url, title, customIcon)).not.toMatch(/^\/brand-icons\//)
  })
})
