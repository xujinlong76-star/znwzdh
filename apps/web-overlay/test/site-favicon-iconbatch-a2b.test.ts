import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 A 类第 2 批后半 a2b（2026-11-17，进化轮）。
 *
 * 占位审计 A 类 20 站中的 5 站：Adobe Color / Unsplash / Figma /
 * Adobe XD / Adobe Illustrator（审计文件 icon-placeholder-audit-2026-11-17.md
 * §A）。全部 5 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 *
 * 本批两处未合入即红的用例（不是测试写错，是总装前置条件未满足）：
 * 1. Adobe Color：候选源 upload.wikimedia.org 与 web.archive.org 在
 *    2026-11-17 16:2x–16:4x 多次重试均回 429，资产未落盘。用例与
 *    map 条目均已写好并注释了取数方法，取到字节验过后再取消注释——
 *    见轮次笔记 icon-a2b-2026-11-17.md §1。
 * 2. Adobe Illustrator：href 主机名 www.adobe.com 与 Adobe Firefly
 *    完全相同，hostname map 无法区分，且 map 已有 'adobe.com' 旧条目
 *    （指向不存在的 photoshop.webp）。用例断言的是总装必须在
 *    resolveSiteIcon 里、LOCAL_LOGO_MAP 精确查找之前加的标题规则
 *   （`lowerTitle.includes('illustrator')` → '/brand-icons/illustrator.svg'）；
 *    只合 map、不加标题规则，本用例必红。见 map-block-a2b.txt 末尾注释。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  // Adobe Color 用例已注释（总装按独立复审 A2 打回 1 执行）：资产未落盘、
  // map 条目未合入——候选源 2026-11-17 16:2x–16:4x 多次回 429 阻塞。
  // 待冷却后重取并验过字节后再取消注释合入（见文件头注释与轮次笔记 §1；
  // 复审裁决 (c) 修正：重试须钉死 Wayback 精确时间戳 20200320072615，
  // 2,436 B / digest XYDL4MM7XSEHNVUO2MJLVZUJA7EJP5KG，优先用候选 B）。
  // { url: 'https://color.adobe.com', title: 'Adobe Color', expected: '/brand-icons/adobe-color.png' },
  { url: 'https://unsplash.com', title: 'Unsplash', expected: '/brand-icons/unsplash.png' },
  { url: 'https://figma.com', title: 'Figma', expected: '/brand-icons/figma.svg' },
  { url: 'https://helpx.adobe.com/xd/desktop.html', title: 'Adobe XD', expected: '/brand-icons/adobe-xd.svg' },
  { url: 'https://www.adobe.com/products/illustrator.html', title: 'Adobe Illustrator', expected: '/brand-icons/illustrator.svg' },
]

// Adobe Color 资产未落盘（源站 429，见文件头注释），暂不列入；取到验过后补上。
const LOCAL_ASSETS = [
  'unsplash.png',
  'figma.svg',
  'adobe-xd.svg',
  'illustrator.svg',
]

describe('resolveSiteIcon（图标修复 A 类第 2 批后半 a2b）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：SVG 含 <svg> 根元素、PNG 以魔数开头', () => {
    // 2026-11-17：4 个文件均由 curl 重新验证后落盘（200 + image MIME +
    // 魔数 + 尺寸与轮次笔记逐个相符）。此断言把“落盘的是真图片而非
    // HTML 壳页/403 页”钉死——adobe.com 全站对 curl 回 403，拿错地址
    // 就会落盘 39xB 的 HTML；upload.wikimedia.org / web.archive.org
    // 在本轮多次回 429，Adobe Color 因此未落盘（见文件头注释）。
    // 注意：adobe-xd.svg 与 illustrator.svg 以 <?xml 声明开头（不是
    // 2a 的 Simple Icons 风格直接 <svg> 开头），故此处断言 includes
    // 而非 startsWith；figma.svg 是官网直链，直接以 <svg> 开头。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const figma = readFileSync(`${dir}figma.svg`, 'utf8')
    expect(figma.startsWith('<svg'), 'figma.svg').toBe(true)
    for (const name of ['adobe-xd.svg', 'illustrator.svg']) {
      const svg = readFileSync(`${dir}${name}`, 'utf8')
      expect(svg.includes('<svg'), name).toBe(true)
      expect(svg.includes('xmlns="http://www.w3.org/2000/svg"'), name).toBe(true)
    }
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const buf = readFileSync(`${dir}unsplash.png`)
    expect(buf.subarray(0, 8).equals(pngMagic), 'unsplash.png').toBe(true)
  })

  it('本地光栅资产尺寸钉死：Unsplash 128x128 PNG', () => {
    // 规范 §1：Unsplash 源为官网 apple-touch-icon 180x180 PNG（≥128），
    // Pillow LANCZOS 缩到 128x128 再落盘；SVG 三站（Figma / XD /
    // Illustrator）原样落盘，不钉像素尺寸。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}unsplash.png`)
    // PNG IHDR：宽（bytes 16-19）高（bytes 20-23），大端。
    expect(buf.readUInt32BE(16), 'unsplash.png width').toBe(128)
    expect(buf.readUInt32BE(20), 'unsplash.png height').toBe(128)
  })

  it('品牌色事实钉死：三站 SVG 含官网现用品牌色', () => {
    // Figma 五色（官网 favicon.svg 原样）：绿 #24CB71、橙 #FF7237、
    // 蓝 #00B6FF、红 #FF3737、紫 #874FFF。
    // Adobe XD（Adobe 2020 现行标，深紫底 #470137、品红字 #FF61F6）。
    // Illustrator（Adobe v30.0 现行标，深红棕底 #300、橙字 #ff9a00）。
    // 颜色与 Adobe 官网现行标识逐项核对过；若将来有人换成旧版/近似色，
    // 本断言即红。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const figma = readFileSync(`${dir}figma.svg`, 'utf8')
    for (const c of ['#24CB71', '#FF7237', '#00B6FF', '#FF3737', '#874FFF']) {
      expect(figma.includes(c), `figma.svg ${c}`).toBe(true)
    }
    const xd = readFileSync(`${dir}adobe-xd.svg`, 'utf8')
    expect(xd.includes('#470137'), 'adobe-xd.svg #470137').toBe(true)
    expect(xd.includes('#FF61F6'), 'adobe-xd.svg #FF61F6').toBe(true)
    const ai = readFileSync(`${dir}illustrator.svg`, 'utf8')
    expect(ai.includes('#300'), 'illustrator.svg #300').toBe(true)
    expect(ai.includes('#ff9a00'), 'illustrator.svg #ff9a00').toBe(true)
  })
})
