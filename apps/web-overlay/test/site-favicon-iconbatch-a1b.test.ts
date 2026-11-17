import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 A 类第 1 批后半 a1b（2026-11-17）。
 *
 * 本批 5 站中 4 站落地（Leonardo AI、Vercel、Cloudflare Pages、Cloudflare）；
 * OpenAI 未落地：openai.com 全站对 curl 返回 403 机器人验证页，官方源字节
 * 无法核实，按铁律不猜地址、不用第三方聚合站替代，留待有浏览器能力的 worker
 * 直访核实后再补（见轮次笔记 icon-a1b-2026-11-17.md §OpenAI）。
 *
 * 全部 4 站的 href 与标题均按 navigation.json 逐个核对，不可猜。
 * map 条目见工作tree 根目录 map-block-a1b.txt（本 worker 不直接改
 * site-favicon.tsx）；resolveSiteIcon 断言在总装并入片段后才通过，
 * 全量定向测试与 typecheck 由总装 worker 在合批后跑。
 *
 * 关键事实钉死：
 * - Cloudflare Pages 与 Cloudflare 共键：resolveSiteIcon 去 www. 后查 map，
 *   www.cloudflare.com 与 cloudflare.com 都落到键 'cloudflare.com'，
 *   两站只能共用一个 map 值。两站来源已各自独立 curl 验证，字节完全相同
 *   （源 md5 均为 f4d4f7e79fd34e08e729580664e75720），共用是核实后的结论。
 * - Vercel 是黑三角透明底标（ICO 最大帧 48x48 原样），深色模式对比度弱是
 *   已知局限（规范 §9：纯黑标不打补丁，留待深色底块统一处理轮）。
 * - Leonardo 是黑底白字头像标（512x512 灰度 PNG 缩到 128x128），自带黑底，
 *   双主题可用，无需处理。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://leonardo.ai', title: 'Leonardo AI', expected: '/brand-icons/leonardo.png' },
  { url: 'https://vercel.com', title: 'Vercel', expected: '/brand-icons/vercel.png' },
  { url: 'https://www.cloudflare.com/products/pages/', title: 'Cloudflare Pages', expected: '/brand-icons/cloudflare.png' },
  { url: 'https://cloudflare.com', title: 'Cloudflare', expected: '/brand-icons/cloudflare.png' },
]

const LOCAL_ASSETS = [
  'leonardo.png',
  'vercel.png',
  'cloudflare.png',
]

// PNG IHDR：字节 16-23 为大端宽高。
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 A 类第 1 批后半 a1b）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('落盘尺寸钉死：Leonardo 128x128、Vercel 48x48 原样、Cloudflare 99x96 原样', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const expected: Record<string, { width: number; height: number }> = {
      'leonardo.png': { width: 128, height: 128 },
      'vercel.png': { width: 48, height: 48 },
      'cloudflare.png': { width: 99, height: 96 },
    }
    for (const [name, size] of Object.entries(expected)) {
      const buf = readFileSync(`${dir}${name}`)
      expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      expect(pngSize(buf), name).toEqual(size)
    }
  })

  // cloudflare-pages.png 已按复审裁决（A1 R3）删除：与 cloudflare.png
  // 字节完全相同的重复文件，零 map 引用、零运行时用途，不留存备查。
})
