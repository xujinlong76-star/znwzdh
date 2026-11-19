import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 4 批（2026-11-19）。
 *
 * 20 站：Gitee 码云 / GitHub Trending / GitLab / GitCode / Codeup /
 * Bitbucket / 掘金 / CSDN / 力扣 LeetCode / 牛客网 / 洛谷 / Codeforces /
 * AtCoder / LeetCode 国际版 / MDN Web Docs / Java 官方文档 / W3C 标准 /
 * ISO/IEC 标准 / roadmap.sh / Shadcn/UI。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。20 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；20 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map / 标题规则。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c4/EVIDENCE.md）：
 * - Gitee 码云：favicon.ico 最大帧 64×64 转 PNG 原样不放大。
 * - GitHub Trending：github.githubassets.com/favicons/favicon.svg 原样；
 *   与既有 github.svg 逐字节相同（同为 GitHub 官方标），单独落盘未复用。
 * - GitLab：gitlab.com 站方 192/32px 路径均 403，改用同品牌官方域
 *   about.gitlab.com 的 favicon.ico，最大帧 48×48 转 PNG 原样。
 * - GitCode：站方 logo-favicon.png 96×96 原样逐字节。
 * - Codeup：站方 .ico 32×32 单帧转 PNG 原样。
 * - Bitbucket：favicon.ico 最大帧 64×64 转 PNG 原样。
 * - 掘金：apple-touch-icon.png 180×180 缩至 128。
 * - CSDN：favicon32.ico 32×32 单帧转 PNG 原样。
 * - 力扣 LeetCode：favicon.ico 最大帧 48×48 转 PNG 原样。
 * - 牛客网：站方 web www-favicon.ico 32×32 单帧转 PNG 原样。
 * - 洛谷：fecdn.luogu.com.cn/favicon.ico 32×32 单帧转 PNG 原样。
 * - Codeforces：favicon.ico 仅 16px 单帧未采用，改用站方 32×32 PNG 原样。
 * - AtCoder：favicon.png 280×280 缩至 128；黑白单色图按规范先例转灰度
 *   +Alpha 重编码压至 13,345 B（≤ ~15 KB），视觉无差。
 * - LeetCode 国际版：favicon.ico 最大帧 48×48 转 PNG 原样；与力扣同源
 *   字节（同一枚官方标），分别落盘、文件名不同、互不覆盖。
 * - MDN Web Docs：developer.mozilla.org/favicon.svg 原样
 *   （viewBox 0 0 56 56，内含 <title>MDN Logo</title>）。
 * - Java 官方文档：docs.oracle.com 站方 favicon.ico 120×120 单帧转 PNG
 *   原样不放大；该标为红色 Oracle 椭圆 O，不是 Java 咖啡杯，见事实钉死。
 * - W3C 标准：官网品牌页 2025 新版透明 logo SVG 原样
 *   （viewBox 0 0 360 360，fill #005a9c）；站方 32px favicon 仅作备选。
 * - ISO/IEC 标准：ISO 官方 CDN isologo SVG 原样（viewBox 0 0 283.46×260.79，
 *   <title>isologo</title>）；白字透明底，见事实钉死。
 * - roadmap.sh：apple-touch-icon.png 180×180 缩至 128。
 * - Shadcn/UI：apple-touch-icon.png 180×180 缩至 128。
 *
 * 事实钉死（只记、不加底块、不改组件）：
 * - github-trending.svg 与既有 github.svg 逐字节相同（md5 均为
 *   6d802f68df0c09a4997cfd28eeafd9ff），这是 GitHub 官方 favicon 本身；
 *   Trending 须走 'trending' 标题规则（排在 'github' 规则之前），
 *   'github.com' 键绝不加。
 * - java-docs.png 为 120×120 原样（源 <128 不放大）；站方标是 Oracle O，
 *   不是 Java 咖啡杯——按“官网在用图标”原样接线，未擅自换标，只记录。
 * - iso.svg 为白字透明底（fill 仅 #fff、无底色），浅色主题下不可见；
 *   红色底块须用 ISO 品牌红，但 iso.org 站点头色未能核实具体色值
 *   （www.iso.org curl 空回复、官方品牌页无 hex；候选 #D22630 经查是
 *   Saudi Aramco 的 SA Red、与 ISO 无关），故本次不加底块分支、不猜 hex，
 *   记为未决点：resolveLogoTile('https://www.iso.org/standards.html')
 *   必须返回 null（未进 LOGO_TILE_MAP）。
 * - leetcode-cn.png 与 leetcode.png 同源字节、均为 48×48，但文件名不同、
 *   各自解析到各自路径，互不覆盖。
 * - 小尺寸原样站（源 <128 不放大）：32×32（Codeup / CSDN / 牛客 / 洛谷 /
 *   Codeforces）、48×48（GitLab / 力扣 / LeetCode 国际版）、64×64
 *   （Gitee / Bitbucket）、96×96（GitCode）、120×120（Java 文档）。
 * - w3c.svg 42,416 B 为 SVG 文本，不受光栅单站 ≤ ~15 KB 规则约束
 *   （该规则只管光栅；SVG 原样落盘）。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Gitee 码云 / GitHub Trending / GitLab / GitCode / Codeup 的 customIcon 均含 favicon
  { url: 'https://gitee.com', title: 'Gitee 码云', customIcon: 'https://gitee.com/favicon.ico', expected: '/brand-icons/gitee.png' },
  { url: 'https://github.com/trending', title: 'GitHub Trending', customIcon: 'https://github.com/favicon.ico', expected: '/brand-icons/github-trending.svg' },
  { url: 'https://gitlab.com', title: 'GitLab', customIcon: 'https://gitlab.com/favicon.ico', expected: '/brand-icons/gitlab.png' },
  { url: 'https://gitcode.com', title: 'GitCode', customIcon: 'https://gitcode.com/favicon.ico', expected: '/brand-icons/gitcode.png' },
  { url: 'https://codeup.aliyun.com', title: 'Codeup', customIcon: 'https://codeup.aliyun.com/favicon.ico', expected: '/brand-icons/codeup.png' },
  // Bitbucket / 掘金 / CSDN / 力扣 LeetCode / 牛客网 的 customIcon 均含 favicon
  { url: 'https://bitbucket.org', title: 'Bitbucket', customIcon: 'https://bitbucket.org/favicon.ico', expected: '/brand-icons/bitbucket.png' },
  { url: 'https://juejin.cn', title: '掘金', customIcon: 'https://juejin.cn/favicon.ico', expected: '/brand-icons/juejin.png' },
  { url: 'https://www.csdn.net', title: 'CSDN', customIcon: 'https://www.csdn.net/favicon.ico', expected: '/brand-icons/csdn.png' },
  { url: 'https://leetcode.cn', title: '力扣 LeetCode', customIcon: 'https://leetcode.cn/favicon.ico', expected: '/brand-icons/leetcode-cn.png' },
  { url: 'https://www.nowcoder.com', title: '牛客网', customIcon: 'https://www.nowcoder.com/favicon.ico', expected: '/brand-icons/nowcoder.png' },
  // 洛谷 / Codeforces / AtCoder / LeetCode 国际版 / MDN Web Docs 的 customIcon 均含 favicon
  { url: 'https://www.luogu.com.cn', title: '洛谷', customIcon: 'https://www.luogu.com.cn/favicon.ico', expected: '/brand-icons/luogu.png' },
  { url: 'https://codeforces.com', title: 'Codeforces', customIcon: 'https://codeforces.com/favicon.ico', expected: '/brand-icons/codeforces.png' },
  { url: 'https://atcoder.jp', title: 'AtCoder', customIcon: 'https://atcoder.jp/favicon.ico', expected: '/brand-icons/atcoder.png' },
  { url: 'https://leetcode.com', title: 'LeetCode国际版', customIcon: 'https://leetcode.com/favicon.ico', expected: '/brand-icons/leetcode.png' },
  { url: 'https://developer.mozilla.org', title: 'MDN Web Docs', customIcon: 'https://developer.mozilla.org/favicon.ico', expected: '/brand-icons/mdn.svg' },
  // Java 官方文档 / W3C 标准 / ISO/IEC 标准 / roadmap.sh / Shadcn/UI 的 customIcon 均含 favicon
  { url: 'https://docs.oracle.com/en/java/javase/', title: 'Java 官方文档', customIcon: 'https://docs.oracle.com/favicon.ico', expected: '/brand-icons/java-docs.png' },
  { url: 'https://www.w3.org/standards/', title: 'W3C 标准', customIcon: 'https://www.w3.org/favicon.ico', expected: '/brand-icons/w3c.svg' },
  { url: 'https://www.iso.org/standards.html', title: 'ISO/IEC 标准', customIcon: 'https://www.iso.org/favicon.ico', expected: '/brand-icons/iso.svg' },
  { url: 'https://roadmap.sh', title: 'roadmap.sh', customIcon: 'https://roadmap.sh/favicon.ico', expected: '/brand-icons/roadmap.png' },
  { url: 'https://ui.shadcn.com', title: 'Shadcn/UI', customIcon: 'https://ui.shadcn.com/favicon.ico', expected: '/brand-icons/shadcn.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'github-trending.svg', width: 0, height: 0 },
  { name: 'mdn.svg', width: 0, height: 0 },
  { name: 'w3c.svg', width: 0, height: 0 },
  { name: 'iso.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'gitee.png', width: 64, height: 64 },
  { name: 'gitlab.png', width: 48, height: 48 },
  { name: 'gitcode.png', width: 96, height: 96 },
  { name: 'codeup.png', width: 32, height: 32 },
  { name: 'bitbucket.png', width: 64, height: 64 },
  { name: 'juejin.png', width: 128, height: 128 },
  { name: 'csdn.png', width: 32, height: 32 },
  { name: 'leetcode-cn.png', width: 48, height: 48 },
  { name: 'nowcoder.png', width: 32, height: 32 },
  { name: 'luogu.png', width: 32, height: 32 },
  { name: 'codeforces.png', width: 32, height: 32 },
  { name: 'atcoder.png', width: 128, height: 128 },
  { name: 'leetcode.png', width: 48, height: 48 },
  { name: 'java-docs.png', width: 120, height: 120 },
  { name: 'roadmap.png', width: 128, height: 128 },
  { name: 'shadcn.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 4 批）', () => {
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

  it('尺寸钉死：PNG 16 站按表，SVG 4 站只验存在与文本', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      if (name.endsWith('.png')) {
        const dims = readPngDimensions(buf)
        expect(dims, name).toEqual({ width, height })
      } else {
        expect(buf.toString('utf8').includes('<svg'), name).toBe(true)
      }
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

  it('事实钉死：github-trending.svg 与既有 github.svg 逐字节相同', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const trending = readFileSync(`${dir}github-trending.svg`)
    const github = readFileSync(`${dir}github.svg`)
    expect(trending.equals(github)).toBe(true)
    // 'trending' 规则排在 'github' 规则之前：Trending 解析到自家文件，
    // GitHub 主站仍解析到 github.svg，GitHub Copilot 仍由上方 copilot 规则命中
    expect(resolveSiteIcon('https://github.com/trending', 'GitHub Trending', 'https://github.com/favicon.ico')).toBe('/brand-icons/github-trending.svg')
    expect(resolveSiteIcon('https://github.com', 'GitHub', 'https://github.com/favicon.ico')).toBe('/brand-icons/github.svg')
    expect(resolveSiteIcon('https://github.com/features/copilot', 'GitHub Copilot', 'https://github.com/favicon.ico')).toBe('/brand-icons/copilot.svg')
  })

  it('事实钉死：java-docs.png 为 120×120 原样（Oracle O 标，非 Java 咖啡杯）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}java-docs.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 120, height: 120 })
    // 'docs.oracle.com' 用完整子域建键，不建 'oracle.com' 裸域键
    expect(resolveSiteIcon('https://docs.oracle.com/en/java/javase/', 'Java 官方文档', 'https://docs.oracle.com/favicon.ico')).toBe('/brand-icons/java-docs.png')
  })

  it('事实钉死：iso.svg 为白字透明底、未进 LOGO_TILE_MAP（红底块为未决点）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const text = readFileSync(`${dir}iso.svg`, 'utf8')
    expect(text.includes('<svg')).toBe(true)
    expect(text.includes('<title>isologo</title>')).toBe(true)
    expect(text.toLowerCase().includes('#fff')).toBe(true)
    // ISO 品牌红未核实到具体色值（见文件头注释），本次不加底块分支、不猜 hex
    expect(resolveLogoTile('https://www.iso.org/standards.html')).toBeNull()
  })

  it('事实钉死：力扣与 LeetCode 国际版同源字节、各自解析、互不覆盖', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const cn = readFileSync(`${dir}leetcode-cn.png`)
    const intl = readFileSync(`${dir}leetcode.png`)
    expect(cn.equals(intl)).toBe(true)
    expect(readPngDimensions(cn)).toEqual({ width: 48, height: 48 })
    expect(resolveSiteIcon('https://leetcode.cn', '力扣 LeetCode', 'https://leetcode.cn/favicon.ico')).toBe('/brand-icons/leetcode-cn.png')
    expect(resolveSiteIcon('https://leetcode.com', 'LeetCode国际版', 'https://leetcode.com/favicon.ico')).toBe('/brand-icons/leetcode.png')
  })

  it('事实钉死：mdn.svg 为 MDN 官方 SVG、w3c.svg 为 2025 新版 logo', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const mdn = readFileSync(`${dir}mdn.svg`, 'utf8')
    expect(mdn.includes('<title>MDN Logo</title>')).toBe(true)
    expect(mdn.includes('viewBox="0 0 56 56"')).toBe(true)
    const w3c = readFileSync(`${dir}w3c.svg`, 'utf8')
    expect(w3c.includes('viewBox="0 0 360 360"')).toBe(true)
    expect(w3c.toLowerCase().includes('#005a9c')).toBe(true)
  })

  it('事实钉死：atcoder.png 为 128×128 灰度重编码且 ≤ ~15KB', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}atcoder.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 128, height: 128 })
    expect(statSync(`${dir}atcoder.png`).size).toBeLessThanOrEqual(15 * 1024)
    // IHDR：色彩类型在 offset 25；0 = 灰度、4 = 灰度+Alpha（按设计证据重编码）
    expect([0, 4]).toContain(buf[25])
  })
})
