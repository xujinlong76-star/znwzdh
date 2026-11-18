import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标 B 类第 4 批之 B2b（2026-11-17）：vLLM、可灵AI、海螺视频、Runway。
 *
 * 背景：基线 icon-b-baseline-2026-11-17.md 逐站复现 resolveSiteIcon，
 * 本批 4 站此前均为远程热链——vLLM 走 GitHub 组织头像、可灵AI/海螺视频
 * 走 map 热链值、Runway 走标题规则 runwayml.com/icon.png（旧域名）。
 * 本批全部本地化：vLLM 按 R2 补充裁决走 map 前标题规则（仿 A2 复审
 * Illustrator 先例，紧接 illustrator 规则之后、map 精确查找之前）；
 * 其余 3 站为普通 map 条目（klingai.com / hailuoai.com 为替换旧键，
 * runway.com 为新建键）。navigation.json 未动。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落——只有跑起来才看得见。
 * 全部 4 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 * Runway 源 URL 含构建 hash 查询串（icon.35ps9bmugbe1e.png），已下载
 * 本地化钉死，不可热链；源 URL 不进代码。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://github.com/vllm-project/vllm', title: 'vLLM', expected: '/brand-icons/vllm.svg' },
  { url: 'https://www.klingai.com/app/', title: '可灵AI', expected: '/brand-icons/klingai.png' },
  { url: 'https://hailuoai.com', title: '海螺视频', expected: '/brand-icons/hailuoai.png' },
  { url: 'https://runway.com', title: 'Runway', expected: '/brand-icons/runway.png' },
]

// navigation.json 的 icon 字段原值（均为 …/favicon.ico 形式，
// 被 isRemoteRawFavicon 拦截，故 map/标题规则可达；三参数断言钉死此事实）。
const CUSTOM_ICON_CASES: Array<{ url: string; title: string; icon: string; expected: string }> = [
  { url: 'https://github.com/vllm-project/vllm', title: 'vLLM', icon: 'https://github.com/favicon.ico', expected: '/brand-icons/vllm.svg' },
  { url: 'https://www.klingai.com/app/', title: '可灵AI', icon: 'https://www.klingai.com/favicon.ico', expected: '/brand-icons/klingai.png' },
  { url: 'https://hailuoai.com', title: '海螺视频', icon: 'https://hailuoai.com/favicon.ico', expected: '/brand-icons/hailuoai.png' },
  { url: 'https://runway.com', title: 'Runway', icon: 'https://runway.com/favicon.ico', expected: '/brand-icons/runway.png' },
]

// 同为 github.com 的其余 6 站：vLLM 标题规则不得波及（R2 裁决的反向断言）。
// 期望值随先合入批次更新：Cline / GitHub Copilot 随 B1b 合入后为本地路径，
// LangGraph / Qwen 3 随 B2a 合入后为本地路径（B2 复审 §9 裁决）；
// GitHub / GitHub Trending 不受 vLLM 标题规则波及；C1 c1g2 新增 'github'
// 标题规则后，两站解析为本地 github.svg（先前为空串，见 U-149）。
const UNAFFECTED: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://github.com/cline/cline', title: 'Cline', expected: '/brand-icons/cline.svg' },
  { url: 'https://github.com/features/copilot', title: 'GitHub Copilot', expected: '/brand-icons/copilot.svg' },
  { url: 'https://github.com/langchain-ai/langgraph', title: 'LangGraph', expected: '/brand-icons/langgraph.svg' },
  { url: 'https://github.com/QwenLM/Qwen3', title: 'Qwen 3', expected: '/brand-icons/qwen3.png' },
  { url: 'https://github.com', title: 'GitHub', expected: '/brand-icons/github.svg' },
  { url: 'https://github.com/trending', title: 'GitHub Trending', expected: '/brand-icons/github.svg' },
]

const LOCAL_ASSETS = [
  'vllm.svg',
  'klingai.png',
  'hailuoai.png',
  'runway.png',
]

describe('resolveSiteIcon（图标 B 类第 4 批之 B2b）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it.each(CUSTOM_ICON_CASES)(' $title 传真实 customIcon 仍解析到 $expected', ({ url, title, icon, expected }) => {
    expect(resolveSiteIcon(url, title, icon)).toBe(expected)
  })

  it.each(UNAFFECTED)(' $title 不受 vLLM 标题规则波及', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
    expect(resolveSiteIcon(url, title)).not.toBe('/brand-icons/vllm.svg')
  })

  it('LOCAL_LOGO_MAP 中无 github.com 键', () => {
    // R2 裁决：误加 'github.com' 键会命中全库 7 站。结构断言防止后人误加。
    expect('github.com' in LOCAL_LOGO_MAP).toBe(false)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('本地资产魔数钉死：PNG 以魔数开头（vLLM 为 SVG，不进此循环）', () => {
    // vLLM 已改 SVG 载体（见 B2 复审 §5.3 裁决）：官网 SVG 双声明、透明底、
    // 规范 §1.1 SVG 优先；ICO 版（favicon.ico 10,077 B，md5 abfe8bae827ec3f359717c531a492778）
    // 为同一标的白底不透明载体，深色卡片上露白矩形，已裁决废弃，不作备用落盘；
    // SVG md5 两次独立探测一致，ICO md5 曾变过一次。
    // 其余 3 站落盘均为 PNG（klingai 为 ICO 取最大帧转 PNG；hailuoai 源
    // 扩展名 .ico 实为 PNG，按内容解码；runway 源为 PNG）。此断言把
    // “落盘的是真图片而非 HTML 壳页”钉死——runway.com/favicon.ico 与
    // apple-touch-icon.png 均返回 HTML（SPA 回退），不得用作源。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const name of LOCAL_ASSETS.filter((n) => n.endsWith('.png'))) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8).equals(pngMagic), name).toBe(true)
    }
    // vLLM 落盘为 SVG 原样：viewBox 0.0 0.0 96.0 96.0，3,502 B，
    // md5 6d4bd9d0274c274a95fd2a37575c2d8b（2026-11-17 重新 curl 复验一致）。
    const vllm = readFileSync(`${dir}vllm.svg`, 'utf8')
    expect(vllm.startsWith('<svg'), 'vllm.svg').toBe(true)
    expect(vllm, 'vllm.svg viewBox').toContain('viewBox="0.0 0.0 96.0 96.0"')
  })

  it('本地光栅资产尺寸钉死：runway 128x128、klingai/hailuoai 64x64 原样；vLLM 为 SVG viewBox 钉死', () => {
    // 统一规范 §1：源 ≥128 的缩到 128x128（runway 320→128）；
    // 源 <128 的原样保留、绝不放大（klingai/hailuoai 均为 64x64）。
    // vLLM 已改 SVG 载体：不走 PNG IHDR 断言，改断言 SVG viewBox
    // 0.0 0.0 96.0 96.0（替代原 128×128 IHDR 断言，B2 复审 §5.3）。
    // 事实钉死（规范 §9）：可灵AI 为黑色线稿透明底，深色主题对比度弱，按规范 §9 不打补丁，留待深色底块统一处理轮。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['runway.png']) {
      const buf = readFileSync(`${dir}${name}`)
      // PNG IHDR：宽（bytes 16-19）高（bytes 20-23），大端。
      expect(buf.readUInt32BE(16), `${name} width`).toBe(128)
      expect(buf.readUInt32BE(20), `${name} height`).toBe(128)
    }
    for (const name of ['klingai.png', 'hailuoai.png']) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.readUInt32BE(16), `${name} width`).toBe(64)
      expect(buf.readUInt32BE(20), `${name} height`).toBe(64)
    }
    const vllm = readFileSync(`${dir}vllm.svg`, 'utf8')
    expect(vllm, 'vllm.svg viewBox').toContain('viewBox="0.0 0.0 96.0 96.0"')
    // 单站光栅落盘 ≤ ~15 KB（本批最大 runway 5,377 B；vLLM SVG 3,502 B 同样计入）。
    for (const name of LOCAL_ASSETS) {
      expect(statSync(`${dir}${name}`).size, `${name} bytes`).toBeLessThanOrEqual(15 * 1024)
    }
  })
})
