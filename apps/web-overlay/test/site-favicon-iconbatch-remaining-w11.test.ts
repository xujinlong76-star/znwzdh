import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复剩余轮 W11（2026-11-25，学术 / 影视 / 其他组，6 站）。
 *
 * 落地 5 站：Scopus / 读秀 / Rotten Tomatoes / Metacritic / Windy；
 * 阻塞 1 站：伊对（见下方事实钉死，仍解析为空，无占位图）。
 * 本文件只覆盖 W11 的 6 站，不碰其他站。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。6 站的 href / 标题 / customIcon 均按当前基线的
 * navigation.json 逐个核对，不可猜。注意伊对在 navigation.json 里的
 * href 与 icon 均是 yidui.net（非 yidui.com），以下按 yidui.net 断言。
 *
 * 来源（2026-11-25 12:07–12:10 CST 实测，Chrome UA）：
 * - Scopus：站方 https://www.scopus.com/favicon.ico 为 SSO 循环
 *   （307 → id.elsevier.com，curl 50 次重定向未果；首页同样 302 进 SSO，
 *   C10 旧阻塞原因仍成立）；改用 Simple Icons 官方 Scopus 字标
 *   https://cdn.simpleicons.org/scopus（200、image/svg+xml、808 B，
 *   SHA-256 93e51dcc9ac94ba29df4b09338dc4958f75bb881ab27ef1b789e7e2292841447；
 *   橙色 #E9711C Scopus 字标，SVG 原样落盘 scopus.svg）。
 *   非 Elsevier 字母标，C10 禁令不适用。
 * - 读秀：站方 https://www.duxiu.com/favicon.ico 是微软 IE 蓝色“e”
 *   错标（16×16，1,150 B，目视确认为蓝 e + 金环，绝不能用）；登录页
 *   全站无任何 logo 图片资产（仅 gab.png 备案小图标；images/logo.png
 *   实为“图书馆联合参考咨询服务中心”拼图标志，与读秀无关，未用）。
 *   故按官网品牌重绘：登录页主品牌蓝 #2872E2（login.css 7 处）圆角
 *   方块 + 白色“读”字（Noto Sans CJK SC Bold，标题“读秀学术搜索”
 *   首字），128×128、四角透明，落盘 duxiu.png（3,693 B）。
 *   重绘依据与来源见 EVIDENCE-w11.md。
 * - Rotten Tomatoes：首页声明的 favicon.ico
 *   https://www.rottentomatoes.com/assets/pizza-pie/images/favicon.ico
 *   （200、3,310 B）内容实为 96×96 PNG（红番茄绿蒂标，四角透明，
 *   目视确认），按内容解码原样落盘 rottentomatoes.png（3,310 B）。
 *   未用 apple-touch-icon-180.jpg（JPEG 白底，非透明标）。
 * - Metacritic：首页声明的 https://www.metacritic.com/a/img/favicon.svg
 *   （200、1,381 B）原样落盘 metacritic.svg：深海军蓝圆 #001B36 +
 *   黄圈 #FC0 + 白色 M 字标（width/height 88，无 viewBox）。
 *   未用 favicon.ico（16/32 两帧 ICO）。
 * - Windy：站方 https://www.windy.com/img/favicon.png（200、3,629 B）
 *   原样落盘 windy.png：128×128 调色板 PNG，红圆底 + 白色风形 W 标，
 *   四角透明，目视确认。未用 favicon.ico（16/32 两帧 ICO）与
 *   logo-full.png（180×180 宽版字标，28px 卡片内不可读）。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 5 落地站均 ≤15 KB（字节数下方钉死）；SVG 站原样、PNG 站 <128 原样，
 *   绝不放大（读秀重绘 128×128 除外，见下方）。
 * - 伊对仍阻塞：https://www.yidui.net/favicon.ico 实测 403（C12 复试
 *   仍 403，本轮第三次确认）；https://www.yidui.com/favicon.ico 空回复
 *   （curl 52），且 navigation.json 用的是 yidui.net；无可用官方标，
 *   待浏览器实访，不造假。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.scopus.com', title: 'Scopus', customIcon: 'https://www.scopus.com/favicon.ico', expected: '/brand-icons/scopus.svg' },
  { url: 'https://www.duxiu.com', title: '读秀', customIcon: 'https://www.duxiu.com/favicon.ico', expected: '/brand-icons/duxiu.png' },
  { url: 'https://www.rottentomatoes.com', title: 'Rotten Tomatoes', customIcon: 'https://www.rottentomatoes.com/assets/pizza-pie/images/favicon.ico', expected: '/brand-icons/rottentomatoes.png' },
  { url: 'https://www.metacritic.com', title: 'Metacritic', customIcon: 'https://www.metacritic.com/favicon.ico', expected: '/brand-icons/metacritic.svg' },
  { url: 'https://www.windy.com', title: 'Windy', customIcon: 'https://www.windy.com/favicon.ico', expected: '/brand-icons/windy.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'scopus.svg', width: 24, height: 24, bytes: 808 },
  { name: 'duxiu.png', width: 128, height: 128, bytes: 3693 },
  { name: 'rottentomatoes.png', width: 96, height: 96, bytes: 3310 },
  { name: 'metacritic.svg', width: 88, height: 88, bytes: 1381 },
  { name: 'windy.png', width: 128, height: 128, bytes: 3629 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复剩余轮 W11）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(5)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸与字节数钉死：SVG 按 viewBox、PNG 按 IHDR（<128 原样，绝不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height, bytes } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      if (name.endsWith('.svg')) {
        const text = buf.toString('utf8')
        expect(text.includes('<svg'), name).toBe(true)
        // 尺寸声明两种写法都接受：viewBox（Scopus）或 width/height
        // 属性（Metacritic 无 viewBox）；两者都没有即失败。
        expect(
          text.includes(`viewBox="0 0 ${width} ${height}"`) ||
            text.includes(`width="${width}" height="${height}"`),
          name,
        ).toBe(true)
      } else {
        expect(readPngDimensions(buf), name).toEqual({ width, height })
      }
      expect(statSync(`${dir}${name}`).size, name).toBe(bytes)
    }
  })

  it('光栅单站落盘 ≤ ~15KB（SVG 文本除外）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      if (name.endsWith('.png')) {
        expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
      }
    }
  })

  it('事实钉死：伊对仍阻塞，未接线，仍解析为空（无占位图）', () => {
    // 伊对：https://www.yidui.net/favicon.ico 实测 403（C12 复试仍 403，
    // 本轮第三次确认）；yidui.com 空回复（curl 52）；navigation.json
    // 用 yidui.net。无可用官方标，待浏览器实访，不造假。
    expect(resolveSiteIcon('https://www.yidui.net', '伊对', 'https://www.yidui.net/favicon.ico')).toBe('')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['yidui.png', 'yidui.svg']) {
      expect(existsSync(`${dir}${name}`), name).toBe(false)
    }
  })
})
