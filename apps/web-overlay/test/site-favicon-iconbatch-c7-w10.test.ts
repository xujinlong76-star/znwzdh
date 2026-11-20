import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批补批（2026-11-20，W10 猫眼电影 1 站）：
 * 猫眼电影。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。本站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；customIcon 为远端 …/favicon.ico，
 * 被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-20 15:0x CST，curl，Chrome UA）：
 * - m 站 favicon 直链 200，image/x-icon，67,646 B，单帧 128×128 32 位
 *   DIB（ICO 魔数 00 00 01 00，BITMAPINFOHEADER 40 B、无压缩），
 *   转 RGBA PNG 原样落盘 maoyan.png（9,080 B，md5
 *   5789648065fa2e8d7f8a19892c1a03c8）。红圆底 #E5342A（实测主色
 *   RGB 229,52,42，6,314 px）+ 白猫脸 #F5F5F5（实测 RGB 245,245,245，
 *   3,217 px），四角透明，目视（64×64 像素采样图）确认：红圆底中央
 *   白猫脸正面像，双耳、红眼（白竖瞳）、红鼻红口、胡须俱全，与浏览器
 *   取材描述一致。
 * - www.maoyan.com/favicon.ico 本身打不开：curl -L 跟随 50 次重定向
 *   未收敛（退出 47），必须用 m 站地址（浏览器取材同结论：www 站
 *   favicon 重定向回 m 站，首页只跳一次到 https://m.maoyan.com/，
 *   无自循环、无验证墙）。
 * - 本站 icon 字段为 https://maoyan.com/favicon.ico（远端裸 favicon，
 *   被 guard 拦截），接线走 map，不动 navigation.json。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 全库 383 站核对：'maoyan.com' 键只命中 猫眼电影 一站（全库仅
 *   https://maoyan.com 一处 href 含 maoyan），无后缀串站、无子域站；
 *   'github.com' / 'adobe.com' 键未碰；navigation.json 不动；C7 其余
 *   站（其他 worker 分工）本文件不碰、不断言，免得合流时互相绊住。
 * - 尺寸钉死：maoyan.png 128×128 原样（ICO 唯一帧即 128px，不放大、
 *   不缩小）；9,080 B ≤ 15 KB。
 * - 红圆底为不透明实色圆盘 + 白猫脸，对比度在浅/深主题下均可辨识，
 *   按统一规范 §9 不做单站底块补丁、不配 LOGO_TILE_MAP，留待统一
 *   处理轮。
 * - C7 暂缓的“安全原因”经调查只是 W4 一份报告被安全系统移除，无
 *   任何一站涉及安全/侵权/版权/合规（见
 *   icon-c7-defer-reason-2026-11-20.md）；本次实施中未再出现安全
 *   系统移除提示。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://maoyan.com', title: '猫眼电影', customIcon: 'https://maoyan.com/favicon.ico', expected: '/brand-icons/maoyan.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'maoyan.png', width: 128, height: 128, bytes: 9080 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批补批 W10）', () => {
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

  it('尺寸与字节数钉死：PNG 1 站按表（原样，不放大）', () => {
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
