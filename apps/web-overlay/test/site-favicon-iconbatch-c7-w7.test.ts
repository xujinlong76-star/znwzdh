import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批补批（2026-11-20，W7 影视评分组 2 站）：
 * IMDb / Letterboxd。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。2 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；2 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-20 15:0x CST，curl，Chrome UA）：
 * - IMDb：首页 202、0 B（疑似反爬挑战页）；favicon 直链 200，内容实为
 *   PNG 32×32（497 B，md5 a00f507810e886fe683c705a0582cdb2），黄底
 *   #F5C518 + 黑字 IMDb 标，目视确认原样落盘 imdb.png。
 * - Letterboxd：首页 403 Cloudflare 验证墙（Just a moment…，本次实测；
 *   调查报告 14:05–14:10 时为 000）；favicon 直链 200，3 帧 ICO
 *   （16/32/64，22,382 B），取最大 64×64 帧转 PNG 原样落盘
 *   letterboxd.png（2,101 B，md5 5d8c7b3af905a4b820b27c23fa30b57f），
 *   深 slate #445566 圆底 + 橙 #FF8000 / 绿 #00E054 / 蓝 #40BCF4 三色圆标，
 *   四角透明，目视确认。C8 可汗学院“首页被验证墙拦截、favicon 直链 200
 *   即落地”同类先例。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 383 站核对：'imdb.com' / 'letterboxd.com' 各只命中 1 站，
 *   无后缀串站、无子域站；'github.com' / 'adobe.com' 键未碰；
 *   navigation.json 不动；C7 其余站（其他 worker 分工）本文件不碰、
 *   不断言，免得合流时互相绊住。
 * - 尺寸钉死：imdb.png 32×32 原样（官网 favicon 即 32px，无更大官方方标，
 *   按规范 §1.1 原样保留、绝不放大）；letterboxd.png 64×64 原样（ICO
 *   最大帧，<128 不放大、不缩到 128）。
 * - 两标在浅/深主题下均可辨识（IMDb 不透明黄底方块；Letterboxd 深 slate
 *   底 + 亮色圆标），按统一规范 §9 不做单站底块补丁、不配
 *   LOGO_TILE_MAP，留待统一处理轮。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.imdb.com', title: 'IMDb', customIcon: 'https://www.imdb.com/favicon.ico', expected: '/brand-icons/imdb.png' },
  { url: 'https://letterboxd.com', title: 'Letterboxd', customIcon: 'https://letterboxd.com/favicon.ico', expected: '/brand-icons/letterboxd.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'imdb.png', width: 32, height: 32, bytes: 497 },
  { name: 'letterboxd.png', width: 64, height: 64, bytes: 2101 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批补批 W7）', () => {
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

  it('尺寸与字节数钉死：PNG 2 站按表（原样，不放大）', () => {
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
})
