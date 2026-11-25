import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
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
 *    2026-11-25 更新：用户拍板改用 App Store 版图标（黑底圆角方块 +
 *    12 色三角楔形色轮），源为 App Store CDN 方形原图 1024×1024
 *    （…/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.jpeg/1024x1024bb.jpg，
 *    200、72,835 B），LANCZOS 缩至 128×128 落盘，本用例取消注释合入；
 *    旧 Wikimedia / Wayback 候选源作废，不再重试。证据见 EVIDENCE-adobe.md。
 * 2. Adobe Illustrator：href 主机名 www.adobe.com 与 Adobe Firefly
 *    完全相同，hostname map 无法区分，且 map 已有 'adobe.com' 旧条目
 *    （指向不存在的 photoshop.webp）。用例断言的是总装必须在
 *    resolveSiteIcon 里、LOCAL_LOGO_MAP 精确查找之前加的标题规则
 *   （`lowerTitle.includes('illustrator')` → '/brand-icons/illustrator.svg'）；
 *    只合 map、不加标题规则，本用例必红。见 map-block-a2b.txt 末尾注释。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  // Adobe Color 用例 2026-11-25 取消注释合入：App Store 源已取到验过
  // （1024×1024 方形原图，黑底 + 12 色三角楔形色轮，见文件头注释与
  // EVIDENCE-adobe.md），资产已落盘、map 条目已合入。
  { url: 'https://color.adobe.com', title: 'Adobe Color', expected: '/brand-icons/adobe-color.png' },
  { url: 'https://unsplash.com', title: 'Unsplash', expected: '/brand-icons/unsplash.png' },
  { url: 'https://figma.com', title: 'Figma', expected: '/brand-icons/figma.svg' },
  { url: 'https://helpx.adobe.com/xd/desktop.html', title: 'Adobe XD', expected: '/brand-icons/adobe-xd.svg' },
  { url: 'https://www.adobe.com/products/illustrator.html', title: 'Adobe Illustrator', expected: '/brand-icons/illustrator.svg' },
]

// Adobe Color 资产已落盘（App Store 源，见文件头注释），列入本批资产清单。
const LOCAL_ASSETS = [
  'adobe-color.png',
  'unsplash.png',
  'figma.svg',
  'adobe-xd.svg',
  'illustrator.svg',
]

function pngPixels(buf: Buffer): { width: number; height: number; rgba: Buffer } {
  // 最小 PNG 解码（与 site-favicon-iconbatch-mc-antd.test.ts 同款）：
  // 只支持 8-bit RGBA（Pillow 落盘即此格式），拼 IDAT → zlib 解压 →
  // 逐行反滤波，还原 RGBA 像素。
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + len
  }
  expect(bitDepth).toBe(8)
  expect(colorType).toBe(6)
  const raw = inflateSync(Buffer.concat(idat))
  const channels = 4
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * channels)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const row = raw.subarray(pos, pos + stride)
    pos += stride
    const prev = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride)
    const out = rgba.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = row[i]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      out[i] = v
    }
  }
  return { width, height, rgba }
}

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
    // 在本轮多次回 429，Adobe Color 当时因此未落盘（见文件头注释）。
    // 2026-11-25：Adobe Color 改用 App Store 源取到验过后落盘，
    // 第 5 个文件 adobe-color.png 同样钉死 PNG 魔数。
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
    for (const name of ['unsplash.png', 'adobe-color.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
  })

  it('本地光栅资产尺寸钉死：Unsplash / Adobe Color 均为 128x128 PNG', () => {
    // 规范 §1：Unsplash 源为官网 apple-touch-icon 180x180 PNG（≥128），
    // Pillow LANCZOS 缩到 128x128 再落盘；Adobe Color 源为 App Store
    // 方形原图 1024x1024 JPEG，Pillow LANCZOS 缩到 128x128 再落盘
    // （见 EVIDENCE-adobe.md）。SVG 三站（Figma / XD /
    // Illustrator）原样落盘，不钉像素尺寸。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['unsplash.png', 'adobe-color.png']) {
      const buf = readFileSync(`${dir}${name}`)
      // PNG IHDR：宽（bytes 16-19）高（bytes 20-23），大端。
      expect(buf.readUInt32BE(16), `${name} width`).toBe(128)
      expect(buf.readUInt32BE(20), `${name} height`).toBe(128)
    }
  })

  it('Adobe Color 色轮事实钉死：黑底 + 中心绿 + 12 楔形色块', () => {
    // 用户 2026-11-25 拍板：App Store 版——黑底圆角方块 + 12 色三角楔形
    // 色轮往中心收，不得用通用 Adobe 红 A 顶替。本断言钉死三点：
    // 四角近黑（实测 RGB 各通道 ≤24，和 ≤72，阈值 <120 留足余量）；
    // 中心绿主导（实测 (83,239,77)，G>150 且 G>R、G>B）；r=32 处 12 个
    // 30° 采样点分属 ≥8 个 15° 色相桶（1024 原图上 12 个采样点为 12 个
    // 互不相同的色相，见 EVIDENCE-adobe.md；128 缩后 LANCZOS 混色使
    // 相邻近似楔（82/87°、153/157°、234/238°、350/352°）并桶，故阈值
    // 取 8 而非 12——只为钉死“多色楔形轮”，防止回退到单色/平滑渐变标）。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const { width, height, rgba } = pngPixels(readFileSync(`${dir}adobe-color.png`))
    expect({ width, height }).toEqual({ width: 128, height: 128 })
    const px = (x: number, y: number): [number, number, number, number] => {
      const i = (y * width + x) * 4
      return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!]
    }
    for (const [x, y] of [[2, 2], [125, 2], [2, 125], [125, 125]] as const) {
      const [r, g, b, a] = px(x, y)
      expect(r + g + b, `corner (${x},${y})`).toBeLessThan(120)
      expect(a).toBe(255)
    }
    const [cr, cg, cb] = px(64, 64)
    expect(cg).toBeGreaterThan(150)
    expect(cg).toBeGreaterThan(cr)
    expect(cg).toBeGreaterThan(cb)
    const buckets = new Set<number>()
    for (let k = 0; k < 12; k++) {
      const angle = (k * 30 * Math.PI) / 180
      const x = Math.round(64 + 32 * Math.cos(angle))
      const y = Math.round(64 + 32 * Math.sin(angle))
      const [r, g, b] = px(x, y)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      let h = 0
      if (max !== min) {
        if (max === r) h = ((g - b) / (max - min)) % 6
        else if (max === g) h = (b - r) / (max - min) + 2
        else h = (r - g) / (max - min) + 4
        h = ((h * 60) % 360 + 360) % 360
      }
      buckets.add(Math.floor(h / 15))
    }
    expect(buckets.size).toBeGreaterThanOrEqual(8)
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
