import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 B 类第 1 批 b1b 回归（2026-11-17，进化轮）。
 *
 * 4 站：Cline、GitHub Copilot、Cursor、Tongyi Lingma。
 * 全部 4 站的 href 与标题均按 navigation.json（346 站）逐个核对，不可猜。
 *
 * 关键裁决 R2（基线 icon-b-baseline-2026-11-17.md §R2＋补充裁决）：
 * Cline 与 GitHub Copilot 同为 github.com，hostname map 无法区分；
 * 误加 'github.com' 键会波及 GitHub 主站、GitHub Trending、LangGraph、
 * Qwen 3、vLLM 共 7 站。仿 Adobe Firefly / Illustrator 先例（a1a/a2b），
 * 用 map 前标题规则（lowerTitle 含 'cline' / 'copilot'），放在
 * LOCAL_LOGO_MAP 精确查找之前。全库核对：标题含 'cline' 仅 Cline 一站、
 * 含 'copilot' 仅 GitHub Copilot 一站（navigation.json 与
 * navigation-default.json 均已核对）。本测试用“未波及”断言把 7 站中的
 * GitHub 主站、Trending、LangGraph、Qwen 3 钉死（vLLM 同理走组织头像分支，
 * 不在本批断言内，见基线 R2 波及面表）。
 *
 * 来源（全部 curl 重新验证，200 ＋ image MIME ＋ 魔数 ＋ 字节与研究笔记逐个相符，
 * 偏差 >0 即停；研究笔记：icon-b-github-sources-2026-11-17.md）：
 * - Cline：官网主题 favicon https://cline.bot/assets/branding/logos/cline-icon-dark.svg，
 *   SVG viewBox 0 0 112 112，1,171 B，md5 24eb83f18fff6917054e7468f539a38c。
 *   深色 #1C1C24 透明底，深色主题对比度弱属规范 §9 留待统一处理轮，不加白底。
 * - GitHub Copilot：产品页自身声明的 rel="icon"
 *   https://github.githubassets.com/favicons/favicon.svg，SVG viewBox 0 0 32 32，
 *   959 B，md5 6d802f68df0c09a4997cfd28eeafd9ff。
 *   注意：这是 GitHub 母品牌标（Octocat，#24292E 深色透明底），不是 Copilot
 *   专属标——Copilot 专属标无官方可下载来源，不得从第三方 logo 站取、不得重画。
 * - Cursor：站方 https://www.cursor.com/favicon.ico，ICO 31,226 B，
 *   md5 d74b0189413d9d91c590b2c203a39d80，含 16/32/48/256 四帧；
 *   取最大帧 256×256 缩到 128×128 PNG 落盘（8,914 B）。
 *   渲染仍走既有 isCursorSite 分支（title/url 判定，与 map 值无关），复审截图核对。
 * - Tongyi Lingma：站方 alicdn 图
 *   https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png，
 *   PNG 134×133 RGBA，11,836 B，md5 4c4bd978883f7849e0b9e30b994a684d；
 *   缩到 128×127 后 RGBA 为 16,146 B（超 ~15 KB 单站上限），按规范 §1.2
 *   转 256 色调色板 PNG 落盘（3,854 B，透明通道保留）。
 * 早期 curl -o 会话曾读到 Cursor 2,372 B / Lingma 2,037 B，该读数来自写盘被拦的
 * 故障会话，已废弃；本批以内存中两次复验一致的 31,226 B / 11,836 B 为准。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://github.com/cline/cline', title: 'Cline', expected: '/brand-icons/cline.svg' },
  { url: 'https://github.com/features/copilot', title: 'GitHub Copilot', expected: '/brand-icons/copilot.svg' },
  { url: 'https://cursor.com', title: 'Cursor', expected: '/brand-icons/cursor.png' },
  { url: 'https://lingma.aliyun.com', title: 'Tongyi Lingma', expected: '/brand-icons/lingma.png' },
]

const LOCAL_ASSETS = [
  'cline.svg',
  'copilot.svg',
  'cursor.png',
  'lingma.png',
]

describe('resolveSiteIcon（图标修复 B 类第 1 批 b1b）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('R2 未波及：github.com 主站 / Trending 不被标题规则截胡；LangGraph / Qwen 3 随 B2a 合入后走本地路径', () => {
    // map 里无 'github.com' 键（见下断言）；以下两站的返回值与改动前一致，
    // 证明 cline / copilot 标题规则没有误伤同 hostname 的其他站。
    expect(resolveSiteIcon('https://github.com', 'GitHub')).toBe('')
    expect(resolveSiteIcon('https://github.com/trending', 'GitHub Trending')).toBe('')
    // LangGraph / Qwen 3 的期望值随 B2a 合入后更新（B2a 标题规则，基线 R2
    // 补充裁决）：B1b 落盘时这两站仍走组织头像，B2 合入后改为本地路径。
    expect(resolveSiteIcon('https://github.com/langchain-ai/langgraph', 'LangGraph')).toBe(
      '/brand-icons/langgraph.svg'
    )
    expect(resolveSiteIcon('https://github.com/QwenLM/Qwen3', 'Qwen 3')).toBe(
      '/brand-icons/qwen3.png'
    )
  })

  it('R2 钉死：LOCAL_LOGO_MAP 无 github.com 键', () => {
    expect(LOCAL_LOGO_MAP['github.com']).toBeUndefined()
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：SVG 以 <svg> 开头、PNG 以魔数开头', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['cline.svg', 'copilot.svg']) {
      const svg = readFileSync(`${dir}${name}`, 'utf8')
      expect(svg.startsWith('<svg'), name).toBe(true)
    }
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of ['cursor.png', 'lingma.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
  })

  it('本地光栅资产尺寸钉死：Cursor 128x128、Lingma 128x127', () => {
    // Cursor：ICO 最大帧 256x256 缩到 128x128；Lingma：源 134x133 按
    // thumbnail 只缩小到 128x127（宽高比不变），再转 256 色调色板。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const cursor = readFileSync(`${dir}cursor.png`)
    expect(cursor.readUInt32BE(16), 'cursor.png width').toBe(128)
    expect(cursor.readUInt32BE(20), 'cursor.png height').toBe(128)
    const lingma = readFileSync(`${dir}lingma.png`)
    expect(lingma.readUInt32BE(16), 'lingma.png width').toBe(128)
    expect(lingma.readUInt32BE(20), 'lingma.png height').toBe(127)
  })

  it('Lingma 调色板落盘 ≤ ~15 KB 且保留透明', () => {
    // RGBA 直接落盘为 16,146 B，超单站上限；256 色调色板版为 3,854 B。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}lingma.png`)
    expect(buf.length).toBeLessThanOrEqual(15 * 1024)
    expect(buf[25], 'lingma.png color type 3 = palette').toBe(3)
  })

  it('事实钉死：Cline 深色标 / Copilot 为 GitHub 母品牌标（非专属标）', () => {
    // Cline：fill 仅 #1C1C24，深色透明底；深色主题对比度弱是规范 §9 已知局限，
    // 留待深色底块统一处理轮，不加白底、不改组件。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const cline = readFileSync(`${dir}cline.svg`, 'utf8')
    expect(cline.includes('viewBox="0 0 112 112"')).toBe(true)
    expect(cline.includes('#1C1C24')).toBe(true)
    // Copilot：落盘的是 GitHub 站方 Octocat 标（fill #24292E），不是 Copilot
    // 专属标；若将来 GitHub 发布官方 Copilot 专属资产，再替换，此处先钉死现状，
    // 免得有人误以为这是 Copilot 专属标。
    const copilot = readFileSync(`${dir}copilot.svg`, 'utf8')
    expect(copilot.includes('viewBox="0 0 32 32"')).toBe(true)
    expect(copilot.includes('#24292E')).toBe(true)
  })
})
