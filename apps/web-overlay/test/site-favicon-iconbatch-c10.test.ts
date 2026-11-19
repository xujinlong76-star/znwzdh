import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 10 批（2026-11-19）。
 *
 * 17/20 站：arXiv / Hugging Face Papers / 中国知网 / 万方数据 /
 * Web of Science / Semantic Scholar / IEEE Xplore / JSTOR /
 * 国家数字图书馆 / 36氪 / 虎嗅 / 爱范儿 / Canva / Creative Market /
 * Sketch / Penpot / Pixso。Scopus / 读秀 / Project Gutenberg
 * 阻塞未入（见事实钉死）。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。17 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；17 站 customIcon 均为远端
 * …/favicon.ico（含 NLC 的模板路径 …/img/favicon.ico 与 HF Papers
 * 错域的 paperswithcode.com/favicon.ico），均被 isRemoteRawFavicon
 * 拦截后回落 map / 标题规则。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c10/EVIDENCE.md）：
 * - arXiv：arxiv.org 首页声明的 apple-touch-icon 180×180 缩至 128。
 * - Hugging Face Papers：huggingface.co 官方 HF 标 SVG 原样
 *   （width 95 height 88，viewBox 缺省）；icon 字段的
 *   paperswithcode.com 是错域，未用。
 * - 中国知网：CNKI 官网 /index/ 页引用的 2024 版官方 logo SVG 原样
 *   （viewBox 0 0 2941.51×685.5，宽版不裁不压；白色反白版，白字/白标
 *   + 一颗橙点，见下方 CNKI 底块事实钉死）。
 * - 万方数据：首页声明的 favicon.ico 单帧 48×48 转 PNG 原样。
 * - Web of Science：首页声明的 /wos/static/favicon.png 448×499
 *   等比缩至 115×128。
 * - Semantic Scholar：首页声明的 favicon-128.png 128×128 原样
 *   （hash 路径仅下载本地化，不进代码）。
 * - IEEE Xplore：首页唯一声明的 favicon.ico 单帧 16×16 转 PNG 原样。
 * - JSTOR：官网根 favicon.ico 3 帧，取最大帧 48×48 转 PNG 原样
 *   （首页被 JS 挑战页挡住，favicon 直取成功）。
 * - 国家数字图书馆：首页声明的 favicon.ico 单帧 221×256（BMP 帧）
 *   等比缩至 110×128。
 * - 36氪：官网根 favicon.ico 实为 PNG 32×32（扩展名与内容不一致，
 *   按内容解码）原样；首页内嵌 base64 山峰图与品牌不符，未用。
 * - 虎嗅：首页声明的 apple-touch-icon 120×120 原样；
 *   favicon.ico 实为 100×100 PNG，未用。
 * - 爱范儿：首页声明的 favicon.ico 单帧 64×64 转 PNG 原样。
 * - Canva：首页声明的 favicon.ico 单帧 32×32 转 PNG 原样
 *   （首页本身 403 但 favicon 直取 200）。
 * - Creative Market：官网根 favicon.ico 单帧 48×48（PNG 帧）转 PNG 原样。
 * - Sketch：首页声明的 apple-touch-icon 180×180 缩至 128
 *   （初版超 ~15 KB，改 128 色自适应调色板重存，目视无损）。
 * - Penpot：官网根 favicon.ico 单帧 72×72 转 PNG 原样
 *   （favicon.svg 404 未用）。
 * - Pixso：Pixso 官网首页引用的 512 品牌标缩至 128
 *   （hash 路径仅下载本地化，不进代码；favicon.ico 仅 32×32 未用）。
 *
 * 事实钉死（只记、不加占位、不擅自换图）：
 * - 阻塞 3 站未接线：Scopus（SSO 循环，无官方标可取；Elsevier 字母标
 *   不是 Scopus，绝不用作替代）、读秀（站方 favicon.ico 是微软 IE
 *   蓝色“e”错标，绝不能用）、Project Gutenberg（站点维护中、全 503，
 *   待维护结束重试）。3 站仍解析为空（字母徽标兜底），无落盘文件。
 * - CNKI 白色反白宽版标：cnki.svg 须配 LOGO_TILE_MAP 'dark' 深色底块
 *   （Haiper 白字标同款机制），否则白字在浅色主题下不可见；
 *   底块色值为 LOGO_TILE_CLASSES.dark 的 bg-neutral-900（Tailwind
 *   neutral-900 #171717，代码内已有定值）；未挪用 SVG 内橙点 #f29600
 *   作底块色，未沿用统一规范 §3 旧版极客公园计划值 #101828
 *   （计划稿色值，落地代码未采用；极客公园落地为 'light' 块）。
 * - IEEE 仅 16×16：ieee.png 为 16×16 原样（原样接线，接受或另找更大
 *   官方标待裁决）；ieee.org 的 favicon / apple-touch-icon 均回空 202。
 * - CNKI 16×16 知字 favicon 备选未用，改用 2024 版 SVG 全标。
 * - 小尺寸原样站（源 <128 不放大）：48×48（万方 / JSTOR /
 *   Creative Market）、115×128（Web of Science）、16×16（IEEE）、
 *   110×128（国家数字图书馆）、32×32（36氪 / Canva）、120×120（虎嗅）、
 *   64×64（爱范儿）、72×72（Penpot）。
 * - 光栅单站落盘均 ≤ ~15 KB（最大 arxiv 8,264 B）；
 *   SVG 2 站原样落盘，不受光栅单站 ≤ ~15 KB 规则约束
 *   （cnki.svg 266,324 B 为宽版全标原样）。
 * - 全库 369 站核对：本批 16 个 map 键各只命中 1 站，无后缀串站；
 *   'hugging face papers' 标题子串全库仅命中 Hugging Face Papers 一站；
 *   Hugging Face 主站仍解析为 huggingface.png，不受标题规则影响。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // arXiv / Hugging Face Papers / 中国知网 / 万方数据 / Web of Science 的 customIcon 均含 favicon
  { url: 'https://arxiv.org', title: 'arXiv', customIcon: 'https://arxiv.org/favicon.ico', expected: '/brand-icons/arxiv.png' },
  { url: 'https://huggingface.co/papers/trending', title: 'Hugging Face Papers', customIcon: 'https://paperswithcode.com/favicon.ico', expected: '/brand-icons/huggingface-papers.svg' },
  { url: 'https://www.cnki.net', title: '中国知网', customIcon: 'https://www.cnki.net/favicon.ico', expected: '/brand-icons/cnki.svg' },
  { url: 'https://www.wanfangdata.com.cn', title: '万方数据', customIcon: 'https://www.wanfangdata.com.cn/favicon.ico', expected: '/brand-icons/wanfang.png' },
  { url: 'https://www.webofscience.com', title: 'Web of Science', customIcon: 'https://www.webofscience.com/favicon.ico', expected: '/brand-icons/webofscience.png' },
  // Semantic Scholar / IEEE Xplore / JSTOR / 国家数字图书馆 / 36氪 的 customIcon 均含 favicon
  { url: 'https://www.semanticscholar.org', title: 'Semantic Scholar', customIcon: 'https://www.semanticscholar.org/favicon.ico', expected: '/brand-icons/semanticscholar.png' },
  { url: 'https://ieeexplore.ieee.org/', title: 'IEEE Xplore', customIcon: 'https://ieeexplore.ieee.org/favicon.ico', expected: '/brand-icons/ieee.png' },
  { url: 'https://www.jstor.org', title: 'JSTOR', customIcon: 'https://www.jstor.org/favicon.ico', expected: '/brand-icons/jstor.png' },
  { url: 'https://www.nlc.cn', title: '国家数字图书馆', customIcon: 'https://www.nlc.cn/template_resource/20186/img/favicon.ico', expected: '/brand-icons/nlc.png' },
  { url: 'https://www.36kr.com', title: '36氪', customIcon: 'https://www.36kr.com/favicon.ico', expected: '/brand-icons/36kr.png' },
  // 虎嗅 / 爱范儿 / Canva / Creative Market / Sketch 的 customIcon 均含 favicon
  { url: 'https://www.huxiu.com', title: '虎嗅', customIcon: 'https://www.huxiu.com/favicon.ico', expected: '/brand-icons/huxiu.png' },
  { url: 'https://www.ifanr.com', title: '爱范儿', customIcon: 'https://www.ifanr.com/favicon.ico', expected: '/brand-icons/ifanr.png' },
  { url: 'https://www.canva.com', title: 'Canva', customIcon: 'https://www.canva.com/favicon.ico', expected: '/brand-icons/canva.png' },
  { url: 'https://creativemarket.com', title: 'Creative Market', customIcon: 'https://creativemarket.com/favicon.ico', expected: '/brand-icons/creativemarket.png' },
  { url: 'https://www.sketch.com', title: 'Sketch', customIcon: 'https://www.sketch.com/favicon.ico', expected: '/brand-icons/sketch.png' },
  // Penpot / Pixso 的 customIcon 均含 favicon
  { url: 'https://penpot.app', title: 'Penpot', customIcon: 'https://penpot.app/favicon.ico', expected: '/brand-icons/penpot.png' },
  { url: 'https://pixso.cn', title: 'Pixso', customIcon: 'https://pixso.cn/favicon.ico', expected: '/brand-icons/pixso.png' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'huggingface-papers.svg', width: 0, height: 0 },
  { name: 'cnki.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大；非方标等比缩略
  { name: 'arxiv.png', width: 128, height: 128 },
  { name: 'wanfang.png', width: 48, height: 48 },
  { name: 'webofscience.png', width: 115, height: 128 },
  { name: 'semanticscholar.png', width: 128, height: 128 },
  { name: 'ieee.png', width: 16, height: 16 },
  { name: 'jstor.png', width: 48, height: 48 },
  { name: 'nlc.png', width: 110, height: 128 },
  { name: '36kr.png', width: 32, height: 32 },
  { name: 'huxiu.png', width: 120, height: 120 },
  { name: 'ifanr.png', width: 64, height: 64 },
  { name: 'canva.png', width: 32, height: 32 },
  { name: 'creativemarket.png', width: 48, height: 48 },
  { name: 'sketch.png', width: 128, height: 128 },
  { name: 'penpot.png', width: 72, height: 72 },
  { name: 'pixso.png', width: 128, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 10 批）', () => {
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

  it('尺寸钉死：PNG 15 站按表，SVG 2 站只验存在与文本', () => {
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

  it('事实钉死：阻塞 3 站未接线，仍解析为空（无占位图）', () => {
    // Scopus：SSO 循环，无官方标可取；Elsevier 字母标不是 Scopus，绝不用作替代。
    expect(resolveSiteIcon('https://www.scopus.com', 'Scopus', 'https://www.scopus.com/favicon.ico')).toBe('')
    // 读秀：站方 favicon.ico 是微软 IE 蓝色“e”错标，绝不能用。
    expect(resolveSiteIcon('https://www.duxiu.com', '读秀', 'https://www.duxiu.com/favicon.ico')).toBe('')
    // Project Gutenberg：站点维护中、全 503，待维护结束重试。
    expect(resolveSiteIcon('https://www.gutenberg.org', 'Project Gutenberg', 'https://www.gutenberg.org/favicon.ico')).toBe('')
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['scopus.png', 'scopus.svg', 'duxiu.png', 'duxiu.svg', 'gutenberg.png', 'gutenberg.svg']) {
      expect(existsSync(`${dir}${name}`), name).toBe(false)
    }
  })

  it('事实钉死：CNKI 白色反白宽版标配 dark 深色底块（Haiper 同款机制）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}cnki.svg`, 'utf8')
    expect(svg.includes('viewBox="0 0 2941.51 685.5"')).toBe(true)
    // 宽版原样不裁；SVG 内唯一 hex 为橙点 #f29600（未挪用为底块色）
    expect(svg.includes('#f29600')).toBe(true)
    expect(statSync(`${dir}cnki.svg`).size).toBe(266324)
    // 深色底块：LOGO_TILE_CLASSES.dark = bg-neutral-900（Tailwind
    // neutral-900 #171717，代码内已有定值）；未用 #101828 计划稿色值
    expect(resolveLogoTile('https://www.cnki.net')).toBe('dark')
    expect(resolveSiteIcon('https://www.cnki.net', '中国知网', 'https://www.cnki.net/favicon.ico')).toBe('/brand-icons/cnki.svg')
  })

  it('事实钉死：ieee.png 为 16×16 原样（唯一官方 favicon，接受或另寻大标待裁决）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}ieee.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}ieee.png`).size).toBe(723)
    expect(resolveSiteIcon('https://ieeexplore.ieee.org/', 'IEEE Xplore', 'https://ieeexplore.ieee.org/favicon.ico')).toBe('/brand-icons/ieee.png')
  })

  it('事实钉死：Hugging Face Papers 标题规则不串站（主站仍解析为 huggingface.png）', () => {
    expect(resolveSiteIcon('https://huggingface.co', 'Hugging Face', 'https://huggingface.co/favicon.ico')).toBe('/brand-icons/huggingface.png')
    expect(resolveSiteIcon('https://huggingface.co/papers/trending', 'Hugging Face Papers', 'https://paperswithcode.com/favicon.ico')).toBe('/brand-icons/huggingface-papers.svg')
    // 标题规则只命中 Papers：'hugging face papers' 子串全库仅此一站
    expect(resolveLogoTile('https://huggingface.co/papers/trending')).toBeNull()
  })

  it('事实钉死：小尺寸原样站（源 <128 不放大）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}wanfang.png`))).toEqual({ width: 48, height: 48 })
    expect(readPngDimensions(readFileSync(`${dir}ieee.png`))).toEqual({ width: 16, height: 16 })
    expect(readPngDimensions(readFileSync(`${dir}jstor.png`))).toEqual({ width: 48, height: 48 })
    expect(readPngDimensions(readFileSync(`${dir}36kr.png`))).toEqual({ width: 32, height: 32 })
    expect(readPngDimensions(readFileSync(`${dir}huxiu.png`))).toEqual({ width: 120, height: 120 })
    expect(readPngDimensions(readFileSync(`${dir}ifanr.png`))).toEqual({ width: 64, height: 64 })
    expect(readPngDimensions(readFileSync(`${dir}canva.png`))).toEqual({ width: 32, height: 32 })
    expect(readPngDimensions(readFileSync(`${dir}penpot.png`))).toEqual({ width: 72, height: 72 })
  })

  it('事实钉死：SVG 2 站原样（cnki 宽版 viewBox / HF Papers 宽高钉死）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const cnki = readFileSync(`${dir}cnki.svg`, 'utf8')
    expect(cnki.includes('viewBox="0 0 2941.51 685.5"')).toBe(true)
    const papers = readFileSync(`${dir}huggingface-papers.svg`, 'utf8')
    expect(papers.includes('width="95"')).toBe(true)
    expect(papers.includes('height="88"')).toBe(true)
    expect(statSync(`${dir}huggingface-papers.svg`).size).toBe(4634)
  })
})
