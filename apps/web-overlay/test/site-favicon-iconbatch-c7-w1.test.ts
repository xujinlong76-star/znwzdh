import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 7 批（2026-11-20，W1 视频组 1）。
 *
 * 3/3 站：爱奇艺 / 腾讯视频 / 优酷。C7 其余 17 站由其他 worker 承接，
 * 本文件只覆盖 W1 的 3 站，不碰其他站。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。3 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；3 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源（2026-11-20 15:01 CST 实测，Chrome UA）：
 * - 爱奇艺：首页声明 //www.iqiyi.com/favicon.ico，200、32,038 B、
 *   image/x-icon；ICO 4 帧（16/32/48/64），最大 64×64 帧 PIL 转 RGBA
 *   PNG 原样落盘 iqiyi.png（7,036 B，绿底白字 iQIYI 爱奇艺标，目视确认）。
 * - 腾讯视频：首页声明 //v.qq.com/favicon.ico，200、4,286 B、
 *   image/x-icon；ICO 单帧 32×32 转 PNG 原样 tencent-video.png
 *   （915 B，蓝绿橙三色播放三角标，目视确认）。
 * - 优酷：首页无 icon 声明（全文 0 处 favicon），根 /favicon.ico 直链
 *   200、9,662 B、image/vnd.microsoft.icon；ICO 单帧 48×48 转 PNG
 *   原样 youku.png（1,904 B，蓝底 YOUKU 优酷标，目视确认）。
 *   首页无声明、favicon 直链可用即落地，仿 C8 学习强国先例。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 3 站均 <128 原样保留、绝不放大；均 ≤15 KB（字节数下方钉死）。
 * - 'v.qq.com' 用完整 hostname 建键（不建 'qq.com' 裸域键）：
 *   so.qq.com（元宝搜索 → yuanbao.png）、docs.qq.com（腾讯文档 →
 *   tencent-docs.jpg）、weixin.qq.com（微信 → weixin.png）各有精确键，
 *   下方守卫断言三站解析不受本批影响。
 * - 'iqiyi.com' / 'youku.com' 全库 383 站各只命中一站，无后缀串站。
 * - 优酷蓝底方块在浅/深主题下均显蓝底，不做单站补丁，留待统一处理轮。
 * - 实施中未出现“报告被安全系统移除”类提示（C7 暂缓原因调查报告
 *   §6 保留规则：若出现须原样保留触发提示与指示文本报回）。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.iqiyi.com', title: '爱奇艺', customIcon: 'https://www.iqiyi.com/favicon.ico', expected: '/brand-icons/iqiyi.png' },
  { url: 'https://v.qq.com', title: '腾讯视频', customIcon: 'https://v.qq.com/favicon.ico', expected: '/brand-icons/tencent-video.png' },
  { url: 'https://www.youku.com', title: '优酷', customIcon: 'https://www.youku.com/favicon.ico', expected: '/brand-icons/youku.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'iqiyi.png', width: 64, height: 64, bytes: 7036 },
  { name: 'tencent-video.png', width: 32, height: 32, bytes: 915 },
  { name: 'youku.png', width: 48, height: 48, bytes: 1904 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 7 批 W1）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（3 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(3)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸与字节数钉死：PNG 3 站按表（<128 原样，绝不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height, bytes } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width, height })
      expect(statSync(`${dir}${name}`).size, name).toBe(bytes)
    }
  })

  it('光栅单站落盘 ≤ ~15KB（3 站全部）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
    }
  })

  it('事实钉死：v.qq.com 键不串站（qq.com 系三站各有精确键）', () => {
    expect(resolveSiteIcon('https://so.qq.com', '元宝搜索', 'https://so.qq.com/favicon.ico')).toBe('/brand-icons/yuanbao.png')
    expect(resolveSiteIcon('https://docs.qq.com', '腾讯文档', 'https://docs.qq.com/favicon.ico')).toBe('/brand-icons/tencent-docs.jpg')
    expect(resolveSiteIcon('https://weixin.qq.com/', '微信', 'https://weixin.qq.com/favicon.ico')).toBe('/brand-icons/weixin.png')
    expect(resolveSiteIcon('https://v.qq.com', '腾讯视频', 'https://v.qq.com/favicon.ico')).toBe('/brand-icons/tencent-video.png')
  })
})
