import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批（2026-11-20，worker W9，七猫中文网 1 站）。
 *
 * 本站 CASE 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。本站导航条目根本无 icon 字段（全库唯一既无 icon 字段又无
 * 映射的站，见 icon-c-plan §C7 备注），故 customIcon 传 undefined。
 *
 * 来源（浏览器取材 + W9 独立复核，2026-11-20）：
 * - 首页 https://www.qimao.com 在浏览器里能正常打开（标题
 *   “七猫中文网-全本免费小说-免费小说排行榜”，榜单、分类导航均正常）；
 *   curl 零字节未复现：是反爬，不是死链。U-333 的“死链”判定应修正为
 *   不计死链（U-333 记录本身的修正由主聊雷达线处理，本测试只钉死
 *   “本站解析非空、非死链”的事实）。
 * - 站根 https://www.qimao.com/favicon.ico 实测只是 1×1 占位图，不可用。
 * - 真正的品牌标是站点头部 Logo：
 *   https://cdn-front.qimao.com/qimao/pc/img/header/logo.d026f02.png
 *   （node https 直取：200、image/png、4,072 B、PNG 魔数
 *   89504e470d0a1a0a、380×88，与浏览器取材描述逐项一致）。
 *
 * 设计（按品牌图标惯例取猫剪影主体做方标，文字不硬塞）：
 * - Logo 为 380×88 横版图文：左侧黄色圆角方块、内有一只黑色猫剪影
 *   （形似数字“7”，带猫耳、黄色眼睛和胡须），右侧黑色粗体文字
 *   “七猫中文网”。像素实测：品牌黄 #FCC800（252,200,0）bbox 恰为
 *   x0–87 y0–87，全部 3,926 个黄像素都在 x<88；文字黑像素自 x=105 起。
 * - 裁切 (0,0,88,88) 得黄底圆角方标：88×88、1,761 B，含黄像素 3,926、
 *   黑猫不透明像素 2,558、圆角透明像素 284，无文字。88 < 128 按规范
 *   §1.1 原样保留、绝不放大。黄底不透明、黑猫醒目，浅/深主题均可见，
 *   无需底块（resolveLogoTile 为 null），不做单站补丁。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - U-333 修正结论：七猫中文网不是死链——首页浏览器直读正常、
 *   Logo 直取 200；curl 空回复是本站反爬（站根 favicon 同样对
 *   程序化客户端空回复/畸形头），不得再计死链。本站现解析到本地
 *   图标 /brand-icons/qimao.png，不再走代理/字母徽标兜底。
 * - 'qimao.com' 键无后缀串站：navigation.json 全库 383 站核对，
 *   'qimao.com' 只出现 1 次（即本站），无子域站。
 * - navigation.json 不动：本站条目无 icon 字段，map 生效；
 *   'github.com' / 'adobe.com' 键未碰；U-22 5 站未碰。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // 七猫中文网无 icon 字段，customIcon 传 undefined 复现真实解析链
  { url: 'https://www.qimao.com', title: '七猫中文网', customIcon: undefined, expected: '/brand-icons/qimao.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：<128 源原样不放大；方标猫剪影裁切
  { name: 'qimao.png', width: 88, height: 88 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批 W9 七猫中文网）', () => {
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

  it('尺寸钉死：PNG 1 站按表（88×88 猫剪影方标原样，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      const dims = readPngDimensions(buf)
      expect(dims, name).toEqual({ width, height })
    }
  })

  it('光栅单站落盘 ≤ ~15KB（1,761 B，精确字节数钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
    expect(statSync(`${dir}qimao.png`).size).toBe(1761)
  })

  it('事实钉死：U-333 修正——本站不是死链，解析非空（无占位图）', () => {
    // 首页浏览器直读正常、Logo 直取 200；curl 空回复是反爬，不得再计死链。
    expect(resolveSiteIcon('https://www.qimao.com', '七猫中文网', undefined)).toBe('/brand-icons/qimao.png')
    expect(resolveSiteIcon('https://www.qimao.com', '七猫中文网', undefined)).not.toBe('')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}qimao.png`)).toBe(true)
  })

  it('事实钉死：qimao.com 键不串站（全库仅本站命中）', () => {
    expect(resolveSiteIcon('https://www.qimao.com', '七猫中文网', undefined)).toBe('/brand-icons/qimao.png')
    // 同批其他小说站各有自己的解析，绝不解析为 qimao.png
    expect(resolveSiteIcon('https://www.qidian.com', '起点中文网', 'https://www.qidian.com/favicon.ico')).not.toBe('/brand-icons/qimao.png')
    expect(resolveSiteIcon('https://www.zongheng.com', '纵横中文网', 'https://www.zongheng.com/favicon.ico')).not.toBe('/brand-icons/qimao.png')
    expect(resolveSiteIcon('https://www.jjwxc.net', '晋江文学城', 'https://www.jjwxc.net/favicon.ico')).not.toBe('/brand-icons/qimao.png')
  })
})
