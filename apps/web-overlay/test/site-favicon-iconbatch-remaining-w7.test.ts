import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 剩余图标补齐（2026-11-25，W7 学习成长组 6 站落地 + 1 站阻塞）。
 *
 * 本站 CASE 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。href / 标题 / customIcon 均按当前基分支的
 * navigation.json 逐个核对，不可猜（全库 388 站）：
 * - 廖雪峰教程 https://www.liaoxuefeng.com，customIcon https://liaoxuefeng.com/favicon.ico
 * - The Odin Project https://www.theodinproject.com，customIcon https://www.theodinproject.com/favicon.ico
 * - 网易云课堂 https://study.163.com，customIcon https://study.163.com/favicon.ico
 * - edX https://www.edx.org，customIcon https://www.edx.org/favicon.ico
 * - Internet Archive https://archive.org，customIcon https://archive.org/favicon.ico
 * - Open Library https://openlibrary.org，customIcon https://openlibrary.org/favicon.ico
 * 7 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（2026-11-25 11:18–11:21 CST，curl，Chrome UA）：
 * - 廖雪峰教程：站根 /favicon.ico 不存在（返回 35,474 B 首页 HTML 壳）；
 *   页眉 logo 即裸域 https://liaoxuefeng.com/static/logo.svg（200、
 *   image/svg+xml、3,963 B，md5 ea8a12b461ebae6d69c6641bfa35ae61；
 *   www 域取同路径会 302 跳回首页，必须用裸域）；SVG 文件头自注出自
 *   SVG Repo，但确为官网页眉在用的 logo 文件本身。深青 #334D5C 圆底 +
 *   橙帆 + 黄星帆船标；ImageMagick -background none 渲染 128×128 落盘
 *   liaoxuefeng.png（8,568 B，md5 955d0d94b9b511a0e6e2f94a539b9157，
 *   四角透明；首版误用白底渲染，已废弃重渲）。
 * - The Odin Project：首页声明 apple-touch-icon 180×180
 *   https://www.theodinproject.com/apple-touch-icon.png（200、image/png、
 *   11,333 B，md5 b3f8ddff210b08bdb2eaa88c18071ba4）；根 favicon.ico
 *   15,086 B、3 帧最大 48×48 未用。金棕 #E2B167 奥丁标、四角透明；
 *   LANCZOS 180→128 落盘 theodinproject.png（9,305 B，md5
 *   0b764bff8fb8beac7a98b1c3f13dd8d2）。
 * - 网易云课堂：站方 favicon 仅 16×16（1,150 B，红 #F8232B）不达标、
 *   绝不放大；官网首页唯一 logo 图为吉祥物
 *   https://s2.stu.126.net/res/images/common/logo/logo_mascot.png
 *   （200、image/png、204×137、7,009 B，md5
 *   b6e90fc0ed857b6f3210f16136a19bf3）；站点头衔“网易云课堂”为 HTML
 *   文字、无图片 logo。吉祥物全身等比缩至最长边 128 落盘 study-163.png
 *   （128×86、7,722 B，md5 e0dd4fb501129e08d22fc6a33ba3fe18，四角透明，
 *   不裁切——方形中心裁切会切掉下巴黑块，改取全身等比缩放）。
 * - edX：首页只声明 /favicon.ico（sizes=16x16），/apple-touch-icon.png
 *   404；favicon.ico（200、image/x-icon、26,283 B，md5
 *   936bf0a6f8450c13df9e7cfff5c5c7db）为 4 帧 ICO（16/32/48/256），
 *   最大帧 256×256 为 PNG 帧（6,544 B，md5
 *   fc2fb5efbe3f7745a02c0dbf38b0c94a），即官方 edX 标（白字 edX +
 *   深青 #02262B 平行四边形底，bbox y56–200）。LANCZOS 256→128 整幅
 *   落盘 edx.png（8,779 B，md5 a1cd8289db569e983ecfba8958ab2e20，
 *   四角透明）。
 * - Internet Archive：新版首页声明
 *   /offshoot_assets/apple-touch-icon.png（200、image/png、180×180、
 *   1,313 B，md5 43a6e2892f24dbaab688293b607d0fd1）与
 *   /offshoot_assets/favicon.ico（与根 /favicon.ico 同文件，md5
 *   55ffa49961256cb4512e5c77ff6a1fd3，3 帧最大 32×32 未用）。灰阶
 *   圆柱廊柱标（底 #222222 + 白柱，四角不透明深灰）；LANCZOS 180→128
 *   落盘 archive.png（灰阶 L、2,191 B，md5
 *   0df9f9d7028ba8c00f231ace05530437）。
 * - Open Library：首页声明 apple-touch-icon
 *   /static/images/openlibrary-128x128.png（前两次取回 nginx 500、
 *   第三次 200、image/png、128×128、3,405 B，md5
 *   bf25e3b64ae4af435fc1df672d92ba80）；米底 #E2DCC5 + 蓝 #518ABE
 *   书标，原样落盘 openlibrary.png（3,405 B，同 md5）。根 favicon.ico
 *   仅 16×16 未用；宽版 wordmark SVG（openlibrary-logo-tighter.svg，
 *   viewBox 55 15 1045.2 260）非方形标未用。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 6 键在全库 388 站 href 中各只命中 1 站，无后缀串站、无子域站；
 *   163.com 另有天音站 tianyin.163.com，不命中 'study.163.com' 键。
 * - Project Gutenberg 阻塞：全站 503 维护页（"Temporarily Down for
 *   Maintenance"），首页/裸域/favicon 三路三次复测（11:18、11:20、11:21）
 *   均为 503、913 B，本轮无官方图标可取，不造假、不接线，见 EVIDENCE-w7.md。
 * - 6 标浅/深主题均可辨（archive 深灰底 + 白柱；edx 白字 + 深青底；
 *   其余透明底彩色标），无底块（resolveLogoTile 为 null），不做单站补丁。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  { url: 'https://www.liaoxuefeng.com', title: '廖雪峰教程', customIcon: 'https://liaoxuefeng.com/favicon.ico', expected: '/brand-icons/liaoxuefeng.png' },
  { url: 'https://www.theodinproject.com', title: 'The Odin Project', customIcon: 'https://www.theodinproject.com/favicon.ico', expected: '/brand-icons/theodinproject.png' },
  { url: 'https://study.163.com', title: '网易云课堂', customIcon: 'https://study.163.com/favicon.ico', expected: '/brand-icons/study-163.png' },
  { url: 'https://www.edx.org', title: 'edX', customIcon: 'https://www.edx.org/favicon.ico', expected: '/brand-icons/edx.png' },
  { url: 'https://archive.org', title: 'Internet Archive', customIcon: 'https://archive.org/favicon.ico', expected: '/brand-icons/archive.png' },
  { url: 'https://openlibrary.org', title: 'Open Library', customIcon: 'https://openlibrary.org/favicon.ico', expected: '/brand-icons/openlibrary.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number; bytes: number }> = [
  { name: 'liaoxuefeng.png', width: 128, height: 128, bytes: 8568 },
  { name: 'theodinproject.png', width: 128, height: 128, bytes: 9305 },
  { name: 'study-163.png', width: 128, height: 86, bytes: 7722 },
  { name: 'edx.png', width: 128, height: 128, bytes: 8779 },
  { name: 'archive.png', width: 128, height: 128, bytes: 2191 },
  { name: 'openlibrary.png', width: 128, height: 128, bytes: 3405 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（剩余图标补齐 W7：学习成长组 6 站）', () => {
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

  it('尺寸与字节数钉死：PNG 尺寸与字节数与取材一致', () => {
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

  it('事实钉死：无 customIcon 时同样走 map，不回落远程 favicon', () => {
    expect(resolveSiteIcon('https://www.liaoxuefeng.com', '廖雪峰教程')).toBe('/brand-icons/liaoxuefeng.png')
    expect(resolveSiteIcon('https://www.theodinproject.com', 'The Odin Project')).toBe('/brand-icons/theodinproject.png')
    expect(resolveSiteIcon('https://study.163.com', '网易云课堂')).toBe('/brand-icons/study-163.png')
    expect(resolveSiteIcon('https://www.edx.org', 'edX')).toBe('/brand-icons/edx.png')
    expect(resolveSiteIcon('https://archive.org', 'Internet Archive')).toBe('/brand-icons/archive.png')
    expect(resolveSiteIcon('https://openlibrary.org', 'Open Library')).toBe('/brand-icons/openlibrary.png')
    // 裸域同样命中（去 www 后精确匹配）
    expect(resolveSiteIcon('https://liaoxuefeng.com', '廖雪峰教程', 'https://liaoxuefeng.com/favicon.ico')).toBe('/brand-icons/liaoxuefeng.png')
    expect(resolveSiteIcon('https://edx.org', 'edX', 'https://www.edx.org/favicon.ico')).toBe('/brand-icons/edx.png')
  })

  it('事实钉死：6 键不串站、无底块、Project Gutenberg 未接线', () => {
    // 天音站不命中 study.163.com 键（不同子域）；无其他 163.com 站可串。
    expect(resolveSiteIcon('https://tianyin.163.com', '网易天音', 'https://tianyin.163.com/favicon.ico')).not.toBe('/brand-icons/study-163.png')
    // 6 标浅/深均可见，不配底块
    for (const { url } of CASES) {
      expect(resolveLogoTile(url)).toBeNull()
    }
    // Gutenberg 阻塞未接线：无本地文件、无 map 命中（仍走字母兜底，不解析到本地图标）
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}gutenberg.png`), 'gutenberg.png').toBe(false)
    expect(resolveSiteIcon('https://www.gutenberg.org', 'Project Gutenberg', 'https://www.gutenberg.org/favicon.ico')).not.toContain('/brand-icons/gutenberg')
  })
})
