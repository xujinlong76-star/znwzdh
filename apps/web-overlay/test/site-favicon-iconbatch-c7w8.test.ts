import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批 C7 补批（2026-11-20，W8 单站）。
 *
 * Coursera（学习成长/在线课程）：https://www.coursera.org。
 * C7 暂缓的“安全原因”经调查只是 W4 一份报告被安全系统移除，无任何
 * 一站涉及安全/侵权/版权/合规；Coursera 官网/favicon 实测可取
 * （调查报告 icon-c7-defer-reason-2026-11-20.md §5：首页与
 * favicon 均 200，favicon 15,406 B）。
 *
 * 本站 CASE 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜：href https://www.coursera.org，
 * title Coursera，customIcon https://coursera.org/favicon.ico（远端
 * …/favicon.ico，被 isRemoteRawFavicon 拦截后回落 map）。
 *
 * 来源要点（2026-11-20 15:0x CST，curl，Chrome UA）：
 * - 官网首页 https://www.coursera.org：200，796,039 B，text/html。
 * - 首页声明的官方标（CloudFront 直链）：
 *   favicon-v2-194x194.png（200，15,476 B，image/png，194×194 RGBA，
 *   md5 7169eafb412bf2df21fd61a482a2c136）、favicon-v2-96x96.png
 *   （200，4,047 B，96×96）、favicon-v2-32x32.png（200，1,102 B，
 *   32×32）、apple-touch-icon-v2-180x180.png（200，9,194 B，180×180）。
 *   四档像素实测为同一 artwork（主色均为 #0056D2，中心像素均为
 *   (0, 86, 210, 255)，四角均为透明），取最大档 194×194 为源。
 * - 根 /favicon.ico：200，15,406 B，image/x-icon，ICO 3 帧
 *   （48×48 / 32×32 / 16×16），最大帧仅 48×48，未用。
 * - 落盘 coursera.png：194×194 源经 Pillow LANCZOS 只缩小至
 *   128×128（9,529 B，md5 b9d61d64a26ef62fc8ee3de05d8a8ccf，
 *   RGBA，四角透明，中心像素 (0, 86, 210, 255)）；≥128 缩至 128
 *   是 C12 Imperva / Coolify 的既有做法，<128 原样不放大。
 * - 品牌色 #0056D2（Coursera 蓝）+ 白字镂空，四角透明；蓝色在浅/深
 *   两主题下均可见，无底块（resolveLogoTile 为 null），不做单站补丁，
 *   留待统一处理轮（按规范 §9）。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 'coursera.org' 键只命中 Coursera 一站：全库 navigation.json 中
 *   'coursera.org' 仅出现 2 行（本站 href 与 icon 字段各 1 行），
 *   无子域站、无同名站，无后缀串站。
 * - 未用根 ICO：最大帧 48×48 小于首页声明的 194×194 PNG，不放大、
 *   不混用；ICO 文件未落盘。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Coursera 的 customIcon 为远端 https://coursera.org/favicon.ico，被拦截后回落 map
  { url: 'https://www.coursera.org', title: 'Coursera', customIcon: 'https://coursera.org/favicon.ico', expected: '/brand-icons/coursera.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128
  { name: 'coursera.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批 C7 补批 W8：Coursera）', () => {
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

  it('尺寸钉死：PNG 128×128，字节数 9,529 B', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width, height })
      expect(statSync(`${dir}${name}`).size, name).toBe(9529)
    }
  })

  it('光栅单站落盘 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：无 customIcon 时同样走 map，不回落远程 favicon', () => {
    expect(resolveSiteIcon('https://www.coursera.org', 'Coursera')).toBe('/brand-icons/coursera.png')
    // 裸域同样命中（去 www 后精确匹配）
    expect(resolveSiteIcon('https://coursera.org', 'Coursera', 'https://coursera.org/favicon.ico')).toBe('/brand-icons/coursera.png')
  })

  it('事实钉死：coursera.org 键不串站、无底块、ICO 未落盘', () => {
    // 全库仅 Coursera 一站命中本键；无子域站可串。
    expect(resolveSiteIcon('https://www.coursera.org', 'Coursera', 'https://coursera.org/favicon.ico')).toBe('/brand-icons/coursera.png')
    // 品牌蓝 #0056D2 浅/深均可见，不配底块
    expect(resolveLogoTile('https://www.coursera.org')).toBeNull()
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}coursera.ico`), 'coursera.ico').toBe(false)
  })
})
