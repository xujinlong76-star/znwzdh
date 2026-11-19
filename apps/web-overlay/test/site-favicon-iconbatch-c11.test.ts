import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 11 批（2026-11-19）。
 *
 * 17/20 站：Mixkit / Storyblocks / iStock / Pinterest / Awwwards /
 * Mobbin / Iconify / Dafont / Lucide / Uiverse / Chakra UI / npmmirror /
 * Turbo / 中国天气网 / 生态环境部 / 全国排污许可证管理信息平台 /
 * AWS WAF。
 *
 * 3 站阻塞未入（本次不接线、不放占位图，见文件末事实钉死）：
 * Pexels / Pixabay（403 Cloudflare 机器人墙）、
 * SiteInspire（429 Vercel 检查点）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。17 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；17 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c11/EVIDENCE.md）：
 * - Mixkit：mixkit.co/favicon.ico，ICO 16×16 单帧，原样 16×16。
 * - Storyblocks：storyblocks.com/favicon.ico，ICO 32/16，取最大 32 原样。
 * - iStock：istockphoto.com/favicon-128x128.png（首页 HTML 声明），
 *   PNG 128×128 原样。
 * - Pinterest：s.pinimg.com/webapp/pinterest_favicon-70db4fa7.svg
 *   （首页 HTML 声明），SVG viewBox 500×500 原样；P 字 path 无 fill
 *   （默认黑色），深色主题可见性风险留待规范 §9 统一处理轮。
 * - Awwwards：assets.awwwards.com/assets/images/favicon.svg，SVG
 *   viewBox 24×24 原样，内含深色变白 media query。
 * - Mobbin：mobbin.com/mobbin-marketing-pages/images/favicon.svg，
 *   SVG 512×512 原样，内嵌 base64 PNG + 深色 invert filter。
 * - Iconify：iconify.design/favicon.svg（首页 HTML 声明），SVG 48×48 原样。
 * - Dafont：www.dafont.com/favicon.png（首页 HTML 声明），PNG 48×48 原样。
 * - Lucide：lucide.dev/favicon.ico，ICO 48/32/16，取最大 48 原样。
 * - Uiverse：uiverse.io/favicon.ico，ICO 48/32/16，取最大 48 原样。
 * - Chakra UI：chakra-ui.com/favicon.ico（首页 HTML 声明，带查询串），
 *   ICO 48/32/16，取最大 48 原样。
 * - npmmirror：npmmirror.com/favicon.ico，ICO 32×32 单帧，原样 32×32。
 *   注意：href 域名 registry.npmmirror.com 的 /favicon.ico 回 73 B JSON
 *   （egg 默认路径指针，非图标），已弃用；键仍按 href hostname 建。
 * - Turbo：turborepo.dev/favicon.ico（首页 HTML 声明，带查询串），
 *   内容实为 PNG 720×720，按内容解码后 LANCZOS 缩至 128×128。
 * - 中国天气网：weather.com.cn/m2/i/favicon.ico?v=3，内容实为 PNG
 *   32×32，按内容解码原样 32×32。
 * - 生态环境部：www.mee.gov.cn/favicon.ico，ICO 16×16 单帧，原样 16×16。
 * - 全国排污许可证管理信息平台：permit.mee.gov.cn/favicon.ico，
 *   ICO 48/32/16，取最大 48 原样；灰色齿轮标确为站方实测返回，
 *   待复审确认接受或阻塞。
 * - AWS WAF：站方 favicon 为通用 AWS 标（非 WAF 专属），按 Adobe Color
 *   判例未用；落盘为官方 AWS Architecture Icons 包内专属服务标
 *   Arch_AWS-WAF_64.svg 原样，来源类别待复审裁决（接受或改阻塞）。
 *
 * 事实钉死（只记、不加底块、不改组件）：
 * - mee.gov.cn 系两站各建完整 hostname 键（'mee.gov.cn' /
 *   'permit.mee.gov.cn'），精确查找先于后缀匹配，不串站。
 * - 'aws.amazon.com' 键安全：'amazon.com' 未进 map（C6 注释钉死，
 *   亚马逊走标题规则 '亚马逊'），后缀匹配无串站。
 * - 5 站为 16×16 / 32×32 原样小图（mixkit / mee 16×16；storyblocks /
 *   npmmirror / weather 32×32），按规范 §1.1 原样保留、绝不放大。
 * - Lucide / Uiverse / Chakra / Permit 四个 ICO 源字节同为 15,086 B：
 *   系未压缩 BMP 帧尺寸由帧维度决定，md5 各不相同、目视标志各不相同，
 *   非同一文件误用。
 * - 3 站阻塞站本次不接线：resolveSiteIcon 仍返回空串（字母徽标兜底），
 *   不得擅自处理、不得放占位图。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Mixkit / Storyblocks / iStock：map 域名键
  { url: 'https://mixkit.co', title: 'Mixkit', customIcon: 'https://mixkit.co/favicon.ico', expected: '/brand-icons/mixkit.png' },
  { url: 'https://storyblocks.com', title: 'Storyblocks', customIcon: 'https://storyblocks.com/favicon.ico', expected: '/brand-icons/storyblocks.png' },
  { url: 'https://www.istockphoto.com', title: 'iStock', customIcon: 'https://www.istockphoto.com/favicon.ico', expected: '/brand-icons/istockphoto.png' },
  // Pinterest / Awwwards / Mobbin / Iconify：SVG 原样，map 域名键
  { url: 'https://www.pinterest.com', title: 'Pinterest', customIcon: 'https://www.pinterest.com/favicon.ico', expected: '/brand-icons/pinterest.svg' },
  { url: 'https://www.awwwards.com', title: 'Awwwards', customIcon: 'https://www.awwwards.com/favicon.ico', expected: '/brand-icons/awwwards.svg' },
  { url: 'https://mobbin.com', title: 'Mobbin', customIcon: 'https://mobbin.com/favicon.ico', expected: '/brand-icons/mobbin.svg' },
  { url: 'https://iconify.design', title: 'Iconify', customIcon: 'https://iconify.design/favicon.ico', expected: '/brand-icons/iconify.svg' },
  // Dafont / Lucide / Uiverse / Chakra UI：map 域名键
  { url: 'https://www.dafont.com', title: 'Dafont', customIcon: 'https://www.dafont.com/favicon.ico', expected: '/brand-icons/dafont.png' },
  { url: 'https://lucide.dev', title: 'Lucide', customIcon: 'https://lucide.dev/favicon.ico', expected: '/brand-icons/lucide.png' },
  { url: 'https://uiverse.io', title: 'Uiverse', customIcon: 'https://uiverse.io/favicon.ico', expected: '/brand-icons/uiverse.png' },
  { url: 'https://chakra-ui.com', title: 'Chakra UI', customIcon: 'https://chakra-ui.com/favicon.ico', expected: '/brand-icons/chakra-ui.png' },
  // npmmirror / Turbo / 中国天气网：map 域名键（npmmirror 用完整子域键）
  { url: 'https://registry.npmmirror.com', title: 'npmmirror', customIcon: 'https://registry.npmmirror.com/favicon.ico', expected: '/brand-icons/npmmirror.png' },
  { url: 'https://turborepo.dev', title: 'Turbo', customIcon: 'https://turborepo.dev/favicon.ico', expected: '/brand-icons/turborepo.png' },
  { url: 'https://weather.com.cn', title: '中国天气网', customIcon: 'https://weather.com.cn/favicon.ico', expected: '/brand-icons/weather.png' },
  // 生态环境部 / 全国排污许可证管理信息平台：同域两站，各建完整 hostname 键
  { url: 'https://www.mee.gov.cn', title: '生态环境部', customIcon: 'https://www.mee.gov.cn/favicon.ico', expected: '/brand-icons/mee.png' },
  { url: 'https://permit.mee.gov.cn', title: '全国排污许可证管理信息平台', customIcon: 'https://permit.mee.gov.cn/favicon.ico', expected: '/brand-icons/permit-mee.png' },
  // AWS WAF：map 域名键（'amazon.com' 绝不进 map，见下方事实钉死）
  { url: 'https://aws.amazon.com/waf/', title: 'AWS WAF', customIcon: 'https://aws.amazon.com/favicon.ico', expected: '/brand-icons/aws-waf.svg' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // PNG：≥128 源缩到 128，<128 源原样不放大
  { name: 'mixkit.png', width: 16, height: 16 },
  { name: 'storyblocks.png', width: 32, height: 32 },
  { name: 'istockphoto.png', width: 128, height: 128 },
  { name: 'dafont.png', width: 48, height: 48 },
  { name: 'lucide.png', width: 48, height: 48 },
  { name: 'uiverse.png', width: 48, height: 48 },
  { name: 'chakra-ui.png', width: 48, height: 48 },
  { name: 'npmmirror.png', width: 32, height: 32 },
  { name: 'turborepo.png', width: 128, height: 128 },
  { name: 'weather.png', width: 32, height: 32 },
  { name: 'mee.png', width: 16, height: 16 },
  { name: 'permit-mee.png', width: 48, height: 48 },
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'pinterest.svg', width: 0, height: 0 },
  { name: 'awwwards.svg', width: 0, height: 0 },
  { name: 'mobbin.svg', width: 0, height: 0 },
  { name: 'iconify.svg', width: 0, height: 0 },
  { name: 'aws-waf.svg', width: 0, height: 0 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 11 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（17 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(17)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 12 站按表，SVG 5 站只验存在与文本', () => {
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

  it('事实钉死：mee.gov.cn 系两站各解析到各自文件，不串站', () => {
    expect('mee.gov.cn' in LOCAL_LOGO_MAP).toBe(true)
    expect('permit.mee.gov.cn' in LOCAL_LOGO_MAP).toBe(true)
    // 精确查找先于后缀匹配：permit.mee.gov.cn 命中自有键，不串到 mee.png
    expect(resolveSiteIcon('https://www.mee.gov.cn', '生态环境部', 'https://www.mee.gov.cn/favicon.ico')).toBe('/brand-icons/mee.png')
    expect(resolveSiteIcon('https://permit.mee.gov.cn', '全国排污许可证管理信息平台', 'https://permit.mee.gov.cn/favicon.ico')).toBe('/brand-icons/permit-mee.png')
    expect(resolveSiteIcon('https://www.mee.gov.cn', '生态环境部', 'https://www.mee.gov.cn/favicon.ico'))
      .not.toBe(resolveSiteIcon('https://permit.mee.gov.cn', '全国排污许可证管理信息平台', 'https://permit.mee.gov.cn/favicon.ico'))
  })

  it('事实钉死：AWS WAF 走 aws.amazon.com 键，亚马逊仍走标题规则，不串站', () => {
    expect('aws.amazon.com' in LOCAL_LOGO_MAP).toBe(true)
    expect('amazon.com' in LOCAL_LOGO_MAP).toBe(false)
    expect(resolveSiteIcon('https://aws.amazon.com/waf/', 'AWS WAF', 'https://aws.amazon.com/favicon.ico')).toBe('/brand-icons/aws-waf.svg')
    expect(resolveSiteIcon('https://www.amazon.com', '亚马逊', 'https://www.amazon.com/favicon.ico')).toBe('/brand-icons/amazon.png')
    // github.com / adobe.com 键绝不进 map（共享域名禁区，见 C1 / 计划 §6）
    expect('github.com' in LOCAL_LOGO_MAP).toBe(false)
    expect('adobe.com' in LOCAL_LOGO_MAP).toBe(false)
  })

  it('事实钉死：npmmirror 用完整子域键，裸域键绝不进 map', () => {
    expect('registry.npmmirror.com' in LOCAL_LOGO_MAP).toBe(true)
    expect('npmmirror.com' in LOCAL_LOGO_MAP).toBe(false)
    expect(resolveSiteIcon('https://registry.npmmirror.com', 'npmmirror', 'https://registry.npmmirror.com/favicon.ico')).toBe('/brand-icons/npmmirror.png')
  })

  it('事实钉死：SVG 5 站原样（viewBox / 结构钉死；栅格渲染复核留待复审）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const pinterest = readFileSync(`${dir}pinterest.svg`, 'utf8')
    expect(pinterest.includes('viewBox="0 0 500 500"')).toBe(true)
    // P 字 path 无 fill（默认黑色渲染），深色主题可见性风险留待规范 §9
    // 统一处理轮，本批不擅自改 fill、不加底块
    expect(pinterest.includes('fill=')).toBe(false)
    const awwwards = readFileSync(`${dir}awwwards.svg`, 'utf8')
    expect(awwwards.includes('viewBox="0 0 24 24"')).toBe(true)
    const mobbin = readFileSync(`${dir}mobbin.svg`, 'utf8')
    // 内嵌 base64 PNG + 深色 invert filter，按规范原样落盘，未拆解重编码
    expect(mobbin.includes('base64')).toBe(true)
    const iconify = readFileSync(`${dir}iconify.svg`, 'utf8')
    expect(iconify.includes('width="48"')).toBe(true)
    expect(iconify.includes('height="48"')).toBe(true)
    const awsWaf = readFileSync(`${dir}aws-waf.svg`, 'utf8')
    expect(awsWaf.includes('<title>Icon-Architecture/64/Arch_AWS-WAF_64</title>')).toBe(true)
    expect(awsWaf.includes('viewBox="0 0 80 80"')).toBe(true)
    // 本机无 rsvg/inkscape/chromium，未做栅格渲染复核；
    // 请复审在浏览器/浅深主题下渲染确认后再放行
  })

  it('事实钉死：AWS WAF 来源为官方图标包专属标（非站方通用 AWS 标），待复审裁决', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    // 落盘字节与设计证据一致（Arch_AWS-WAF_64.svg，3,719 B）
    expect(statSync(`${dir}aws-waf.svg`).size).toBe(3719)
    expect(resolveSiteIcon('https://aws.amazon.com/waf/', 'AWS WAF', 'https://aws.amazon.com/favicon.ico')).toBe('/brand-icons/aws-waf.svg')
    // 若复审不接受该来源，该站改为阻塞（通用 AWS 标方案需用户拍板）；
    // 本批按设计原样接线，不擅自换图
  })

  it('事实钉死：5 站原样小图（16/32px 合规，不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['mixkit.png', 'mee.png']) {
      const buf = readFileSync(`${dir}${name}`)
      // 按规范 §1.1 原样保留、绝不放大；卡片上显小是合规状态
      expect(readPngDimensions(buf), name).toEqual({ width: 16, height: 16 })
    }
    for (const name of ['storyblocks.png', 'npmmirror.png', 'weather.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(readPngDimensions(buf), name).toEqual({ width: 32, height: 32 })
    }
  })

  it('事实钉死：3 站阻塞站本次不接线，仍解析为空串（字母徽标兜底）', () => {
    // Pexels / Pixabay（403 Cloudflare 机器人墙）、SiteInspire（429 Vercel 检查点）
    expect(resolveSiteIcon('https://www.pexels.com', 'Pexels', 'https://www.pexels.com/favicon.ico')).toBe('')
    expect(resolveSiteIcon('https://pixabay.com', 'Pixabay', 'https://pixabay.com/favicon.ico')).toBe('')
    expect(resolveSiteIcon('https://www.siteinspire.com', 'SiteInspire', 'https://www.siteinspire.com/favicon.ico')).toBe('')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(existsSync(`${dir}pexels.png`)).toBe(false)
    expect(existsSync(`${dir}pexels.svg`)).toBe(false)
    expect(existsSync(`${dir}pixabay.png`)).toBe(false)
    expect(existsSync(`${dir}pixabay.svg`)).toBe(false)
    expect(existsSync(`${dir}siteinspire.png`)).toBe(false)
    expect(existsSync(`${dir}siteinspire.svg`)).toBe(false)
  })
})
