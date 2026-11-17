import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标多色版换色 — Dify（2026-11-17，用户 17:24 拍板 7 张换色之一）。
 *
 * 旧图问题（质量审计 §2-5）：本地 dify.svg 658 B 为 Simple Icons 单色版，
 * 全蓝（fill #0033FF）；官网现用站标为黑 D + 蓝 ify，本批换官方多色版。
 *
 * 来源（规范 §6 重新 curl 复验，2026-11-17）：
 *   https://dify.ai/assets/dify-logo.svg
 *   HTTP 200，image/svg+xml，1,195 B，md5 1f4af464e494c29ebf033e7d3bda57ed，
 *   与审计记录 1,195 B 分毫不差；dify.ai 首页仍声明同一 URL。
 *   宽版字标 225×100，按规范 §1.1 原样落盘、不裁不压；map 值不变。
 *
 * 品牌色（以落盘文件实测为准，不沿用审计简写）：
 *   D 与 y 为 #010916（近黑），i（含圆点）与 f 为 #0033FF（蓝），
 *   即文件内 fill #010916 ×2、#0033FF ×2。审计“黑 D + 蓝 ify”为简写，
 *   y 实为近黑，测试按文件实际色值断言。
 *
 * favicon 备查（不落盘）：官网 https://dify.ai/favicon.svg 亦为 HTTP 200、
 * image/svg+xml、685 B（与审计记录一致），存 /tmp/dify-favicon.svg 备查。
 * 审计称其在本机 cairosvg 下仅渲染出 "if"（疑似渲染器 clip-path 问题，
 * 未采信为证据）；本 worktree 无 cairosvg/rsvg-convert，未能复现渲染，
 * 无真实浏览器复核前绝不以 favicon.svg 替代站标。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://dify.ai', title: 'Dify', expected: '/brand-icons/dify.svg' },
]

const LOCAL_ASSETS = ['dify.svg']

describe('resolveSiteIcon（图标多色版换色 — Dify）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('SVG 原样钉死：与官网 dify-logo.svg 源字节一致（md5 + 字节数）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}dify.svg`)
    expect(buf.length).toBe(1195)
    expect(createHash('md5').update(buf).digest('hex')).toBe(
      '1f4af464e494c29ebf033e7d3bda57ed',
    )
    expect(buf.toString('utf8').startsWith('<svg')).toBe(true)
  })

  it('宽版尺寸钉死：225×100（viewBox 0 0 225 100），不裁不压', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}dify.svg`, 'utf8')
    expect(svg).toContain('viewBox="0 0 225 100"')
    expect(svg).toContain('width="225"')
    expect(svg).toContain('height="100"')
  })

  it('品牌色钉死：近黑 #010916（D、y）+ 蓝 #0033FF（i、f）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}dify.svg`, 'utf8')
    // D 与 y 近黑、i 与 f 蓝：文件中各出现 2 次，单色全蓝旧版无 #010916。
    expect(svg.match(/#010916/g)?.length).toBe(2)
    expect(svg.match(/#0033FF/g)?.length).toBe(2)
    expect(svg.includes('fill="#0033FF"')).toBe(true)
  })
})
