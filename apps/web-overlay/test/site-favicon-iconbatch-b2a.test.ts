import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 B 类 B2a 批（2026-11-17）。
 *
 * 4 站：Beatoven.ai、Sudowrite（R1 裁决：新建 map 键 + 同步清空 navigation.json
 * 的 icon 字段，否则 customIcon 优先于 map、新 map 条目永不可达）、LangGraph、
 * Qwen 3（R2 裁决：不建 hostname 键，走 map 前标题规则）。
 * 全部 href / title / customIcon 均按 navigation.json（HEAD 803efd91）逐字取用，不可猜。
 * 文件名说明：LangGraph 源为 SVG 故落盘 langgraph.svg（原任务单所写 langgraph.png
 * 与统一规范 §1.1“SVG 原样”冲突，以规范 + GitHub 系来源研究笔记为准）；
 * qwen.svg 已被通义千问占用，故 Qwen 3 落盘 qwen3.png。
 */

const BEATOVEN_HOTLINK =
  'https://cdn.prod.website-files.com/65d772a7cbf713010f7736f6/66634faf309426cbf03b120b_logo%20(1).png'
const SUDOWRITE_HOTLINK =
  'https://framerusercontent.com/images/5P8G75bSTVJjQUUwQiqbW3rrU74.png'

type Case = { url: string; title: string; customIcon?: string | null; expected: string }

const CASES: Case[] = [
  // R1 双断言 ①：清 icon 前——传真实热链 customIcon，期望返回该热链（复现截胡，
  // 证明测试能看见截胡；只断言②测不到截胡）。
  { url: 'https://www.beatoven.ai', title: 'Beatoven.ai', customIcon: BEATOVEN_HOTLINK, expected: BEATOVEN_HOTLINK },
  { url: 'https://www.sudowrite.com', title: 'Sudowrite', customIcon: SUDOWRITE_HOTLINK, expected: SUDOWRITE_HOTLINK },
  // R1 双断言 ②：清 icon 后——传 '' / undefined / null，期望返回本地路径。
  { url: 'https://www.beatoven.ai', title: 'Beatoven.ai', customIcon: '', expected: '/brand-icons/beatoven.png' },
  { url: 'https://www.beatoven.ai', title: 'Beatoven.ai', customIcon: undefined, expected: '/brand-icons/beatoven.png' },
  { url: 'https://www.beatoven.ai', title: 'Beatoven.ai', customIcon: null, expected: '/brand-icons/beatoven.png' },
  { url: 'https://www.sudowrite.com', title: 'Sudowrite', customIcon: '', expected: '/brand-icons/sudowrite.png' },
  { url: 'https://www.sudowrite.com', title: 'Sudowrite', customIcon: undefined, expected: '/brand-icons/sudowrite.png' },
  { url: 'https://www.sudowrite.com', title: 'Sudowrite', customIcon: null, expected: '/brand-icons/sudowrite.png' },
  // R2：LangGraph / Qwen 3 走 map 前标题规则。两参数版与三参数版（传 navigation.json
  // 的 favicon.ico customIcon，被 isRemoteRawFavicon 拦截）均断言本地路径。
  { url: 'https://github.com/langchain-ai/langgraph', title: 'LangGraph', expected: '/brand-icons/langgraph.svg' },
  { url: 'https://github.com/langchain-ai/langgraph', title: 'LangGraph', customIcon: 'https://github.com/favicon.ico', expected: '/brand-icons/langgraph.svg' },
  { url: 'https://github.com/QwenLM/Qwen3', title: 'Qwen 3', expected: '/brand-icons/qwen3.png' },
  { url: 'https://github.com/QwenLM/Qwen3', title: 'Qwen 3', customIcon: 'https://github.com/favicon.ico', expected: '/brand-icons/qwen3.png' },
  // R2 不受影响断言：GitHub 主站与 Trending 的标题不含 langgraph / qwen，
  // 改动前返回值为空串（Python 复现 resolveSiteIcon，HEAD 803efd91 实测），改动后仍为空串。
  { url: 'https://github.com', title: 'GitHub', customIcon: 'https://github.com/favicon.ico', expected: '' },
  { url: 'https://github.com/trending', title: 'GitHub Trending', customIcon: 'https://github.com/favicon.ico', expected: '' },
]

const LOCAL_ASSETS = ['beatoven.png', 'sudowrite.png', 'qwen3.png', 'langgraph.svg']

/** 读 PNG IHDR 大端宽高（统一规范 §7 尺寸钉死断言同款做法）。 */
function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 B 类 B2a）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：Beatoven 32×32、Sudowrite 64×64、Qwen 3 80×80 均为小源原样，LangGraph 472×100 宽版原样', () => {
    // 统一规范 §1.1：小于 128 的源尺寸原样保留、绝不放大；宽版 logo 原样、不裁、
    // 不压成方形。Beatoven 官网 favicon 即 32×32（apple-touch 256 版为同款不同像素，
    // 均值差 6.84，未采用）；Sudowrite 官网 favicon 即 64×64；Qwen 3 官网 favicon 即 80×80。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(pngSize(readFileSync(`${dir}beatoven.png`))).toEqual({ w: 32, h: 32 })
    expect(pngSize(readFileSync(`${dir}sudowrite.png`))).toEqual({ w: 64, h: 64 })
    expect(pngSize(readFileSync(`${dir}qwen3.png`))).toEqual({ w: 80, h: 80 })
    const svg = readFileSync(`${dir}langgraph.svg`, 'utf8')
    expect(svg.includes('viewBox="0 0 472 100"')).toBe(true)
    expect(svg.includes('width="472"')).toBe(true)
    expect(svg.includes('height="100"')).toBe(true)
  })

  it('LangGraph 事实钉死：浅色底版 wordmark，非方形标、非 LangChain 标', () => {
    // 仓库唯一 LangGraph 产品专属资产 logo-light.svg：左侧 100×100 深蓝圆角方块
    // 为图标主体 + 右侧 “LangGraph” 字标；裁左侧属于改画，故宽版原样落盘。
    // fills 为 #161F34 + #7FC8FF，无 white；文档站 favicon 与组织头像均为 LangChain
    // 母品牌标，不得作主用。深色主题下字标 #161F34 对比度弱是已知局限，见规范 §9。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}langgraph.svg`, 'utf8')
    expect(svg.includes('#161F34')).toBe(true)
    expect(svg.includes('#7FC8FF')).toBe(true)
    expect(svg.includes('LangGraph')).toBe(false) // 纯路径字标，无文本
  })

  it('Qwen 3 事实钉死：Qwen 通用品牌标，非 Qwen3 模型专属标', () => {
    // Qwen3 无模型专属标；主用 qwen.ai 首页声明的唯一 favicon（80×80 alicdn PNG，
    // 与 QwenLM 组织头像同款同色、互相印证）。qwen.svg 已被通义千问占用，不得复用。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}qwen3.png`)
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(LOCAL_LOGO_MAP['qianwen.aliyun.com']).toBe('/brand-icons/qwen.svg')
  })

  it('结构钉死：map 有 beatoven.ai / sudowrite.com 键、无 github.com 键、无 langgraph.png 值', () => {
    expect(LOCAL_LOGO_MAP['beatoven.ai']).toBe('/brand-icons/beatoven.png')
    expect(LOCAL_LOGO_MAP['sudowrite.com']).toBe('/brand-icons/sudowrite.png')
    expect('github.com' in LOCAL_LOGO_MAP).toBe(false)
    expect(Object.values(LOCAL_LOGO_MAP)).not.toContain('/brand-icons/langgraph.png')
  })
})
