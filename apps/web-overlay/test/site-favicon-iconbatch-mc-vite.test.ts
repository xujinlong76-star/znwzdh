import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标换官方多色版：Vite（2026-11-17，用户 17:24 拍板 7 张换色之一）。
 *
 * 旧图问题（质量审计 §2-1）：本地 vite.svg 462 B 为 Simple Icons 单色版，
 * 填充旧品牌色 #646CFF；官网现用为多色渐变闪电。
 *
 * 来源（规范 §6 重新 curl 核实，2026-11-17）：
 *   https://vite.dev/logo-without-border.svg
 *   HTTP 200，image/svg+xml，11,429 B（与审计记录 11,429 B 偏差 0），
 *   md5 a5350a0806823a3a54749fab9352ec92，两次下载 md5 一致，
 *   vite.dev 首页声明同一 URL。落盘文件与源 cmp 一致。
 *
 * 颜色事实（实测为准，审计“黄→紫” shorthand 已纠正）：
 *   该文件无 <linearGradient> 元素、无黄色填充；渐变由模糊椭圆
 *   （feGaussianBlur 滤镜）叠加呈现：底色紫 #863BFF、深紫 #7E14FF、
 *   蓝 #47BFFF、浅紫 #EDE6FF。测试断言按实测颜色写，不虚构黄色。
 *
 * 站内事实：标题 Vite，href https://vite.dev，map 键 vite.dev 已存在
 * （site-favicon.tsx L188，值 '/brand-icons/vite.svg' 不变），本次只换
 * 文件内容，不改 map、不动 navigation.json。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://vite.dev', title: 'Vite', expected: '/brand-icons/vite.svg' },
]

const LOCAL_ASSETS = ['vite.svg']

// 官网源文件的钉死值（2026-11-17 两次 curl 一致）。
const EXPECTED_BYTES = 11429
const EXPECTED_MD5 = 'a5350a0806823a3a54749fab9352ec92'

describe('resolveSiteIcon（图标换官方多色版：Vite）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('SVG 原样钉死：与官网源 cmp 一致（字节数 + md5）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}vite.svg`)
    expect(buf.length).toBe(EXPECTED_BYTES)
    expect(createHash('md5').update(buf).digest('hex')).toBe(EXPECTED_MD5)
    const svg = buf.toString('utf8')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.includes('viewBox="0 0 48 46"')).toBe(true)
  })

  it('官方多色渐变断言：紫/蓝渐变闪电，旧单色 #646CFF 已清除', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const svg = readFileSync(`${dir}vite.svg`, 'utf8')
    // 渐变由模糊椭圆 + feGaussianBlur 滤镜叠加呈现（无 <linearGradient>）。
    expect(svg.includes('feGaussianBlur')).toBe(true)
    // 底色紫、深紫、蓝、浅紫四色俱全。
    expect(svg.includes('#863BFF')).toBe(true)
    expect(svg.includes('#7E14FF')).toBe(true)
    expect(svg.includes('#47BFFF')).toBe(true)
    expect(svg.includes('#EDE6FF')).toBe(true)
    // 旧 Simple Icons 单色版填充色不得残留。
    expect(svg.includes('#646CFF')).toBe(false)
  })
})
