import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 A 类第 1 批前半 a1a（2026-11-17）。
 *
 * 5 站均为审计文件确认的占位站（icon-placeholder-audit-2026-11-17.md §A）：
 * map 旧值指向 /assets/images/logos/*，该目录仓库中不存在，运行时 404 →
 * 渐变字母徽标。本批把 5 站换成真实品牌图标本地落盘。
 *
 * 全部 5 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 * 来源核实、源字节/尺寸、落盘尺寸与 md5 见轮次笔记
 * ~/workspace/goals/efficiency-goal-2/hidden_files/icon-a1a-2026-11-17.md。
 *
 * 注意：本测试调用 resolveSiteIcon(url, title)（不传自定义 icon），只钉死
 * map/title 规则的解析结果。ChatGPT / Claude 在 navigation.json 里的自定义
 * icon 是本地路径（/assets/images/logos/*.webp），运行时 resolveSiteIcon
 * 会优先原样返回——总装必须同步清掉这两站的 navigation.json icon 字段，
 * 否则 map 换了也到不了运行时（见轮次笔记 §4 与 map-block-a1a.txt）。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://chatgpt.com', title: 'ChatGPT', expected: '/brand-icons/chatgpt.svg' },
  { url: 'https://claude.ai', title: 'Claude', expected: '/brand-icons/claude.svg' },
  { url: 'https://gemini.google.com', title: 'Gemini', expected: '/brand-icons/gemini.svg' },
  { url: 'https://openai.com/dall-e-3', title: 'DALL-E 3', expected: '/brand-icons/openai.png' },
  // 复审 A1 R6：OpenAI 主站与 DALL-E 3 共用 openai.com 键与 openai.png，
  // 补一条主站断言防回归（复审裁决 (c)：status.openai.com 官方 ICO
  // 最大帧转码，GitHub 组织头像交叉验证为同一 knot 标）。
  { url: 'https://openai.com/', title: 'OpenAI', expected: '/brand-icons/openai.png' },
  { url: 'https://www.adobe.com/products/firefly.html', title: 'Adobe Firefly', expected: '/brand-icons/firefly.png' },
]

const LOCAL_ASSETS = [
  'chatgpt.svg',
  'claude.svg',
  'gemini.svg',
  'openai.png',
  'firefly.png',
]

function readPngSize(name: string): { width: number; height: number } {
  const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
  const buf = readFileSync(`${dir}${name}`)
  // PNG IHDR：8 字节签名后 4 字节长度 + 4 字节 'IHDR'，随后大端宽高各 4 字节。
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 A 类第 1 批前半 a1a）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('光栅落盘尺寸钉死：Firefly / OpenAI 均为 128×128 PNG', () => {
    // Firefly 源 192×192、OpenAI ICO 最大帧 256×256，按规范 §1 缩到 128×128。
    for (const name of ['firefly.png', 'openai.png']) {
      const { width, height } = readPngSize(name)
      expect(width, name).toBe(128)
      expect(height, name).toBe(128)
    }
  })

  it('SVG 事实钉死：三站 SVG 原样落盘且为当前品牌标', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    // ChatGPT：官网 favicon.svg，180 viewBox，黑结标；W7 已删 @media
    // (prefers-color-scheme: dark) 翻转（93a8d1eed），固定为黑色静态版，
    // 深色模式不再自动切白字。file 会报 HTML 是因文件首行为
    // 官方注释（<!-- https://github.com/openai/openai/... -->），内容确为 SVG。
    const chatgpt = readFileSync(`${dir}chatgpt.svg`, 'utf8')
    expect(chatgpt.includes('<svg'), 'chatgpt.svg').toBe(true)
    // W7 已删 @media 翻转（93a8d1eed）：此处原断言 toBe(true) 在 HEAD 已过期，
    // 随本批一并修正为不存在
    expect(chatgpt.includes('prefers-color-scheme'), 'chatgpt.svg').toBe(false)
    // Claude：官网 favicon.svg，248 viewBox，珊瑚色 #D97757 星标。
    const claude = readFileSync(`${dir}claude.svg`, 'utf8')
    expect(claude.includes('<svg'), 'claude.svg').toBe(true)
    expect(claude.includes('#D97757'), 'claude.svg').toBe(true)
    // Gemini：gstatic aurora SVG（192 viewBox），内嵌 JPEG 渐变经 clipPath 裁成
    // 四角星标；512 PNG 是满幅渐变底纹、不是图标本体，故不用 PNG。
    const gemini = readFileSync(`${dir}gemini.svg`, 'utf8')
    expect(gemini.includes('<svg'), 'gemini.svg').toBe(true)
    expect(gemini.includes('clipPath'), 'gemini.svg').toBe(true)
  })

  it('DALL-E 3 事实钉死：与 OpenAI 主站共用 OpenAI knot 标', () => {
    // openai.com 站内无独立 DALL-E favicon，DALL-E 3 页与 OpenAI 主站共用
    // OpenAI knot。map 键 openai.com 只应有一条、指向 openai.png；
    // A1b 批（OpenAI 站）复用同一文件，不得另存一份。
    expect(
      CASES.find((c) => c.title === 'DALL-E 3')!.expected,
      'dalle3-via-openai.com',
    ).toBe('/brand-icons/openai.png')
  })
})
