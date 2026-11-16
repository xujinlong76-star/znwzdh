import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复第二批 2a 回归（2026-11-17，进化轮）。
 *
 * 背景：第一批之后仍有 48 站显示渐变字母（研究笔记
 * icon-batch2-research-2026-11-17-0101.md §1）。2a 批修其中
 * 18 站 Simple Icons 品牌（本地 SVG 落盘，与第一批同款做法）。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 * 全部 18 站的 href 与标题均按 navigation.json（341 站）逐个核对，
 * 不可猜；文件名取 Simple Icons slug（通义千问的 slug 是 qwen）。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://rollupjs.org', title: 'Rollup', expected: '/brand-icons/rollupdotjs.svg' },
  { url: 'https://webpack.js.org', title: 'Webpack', expected: '/brand-icons/webpack.svg' },
  { url: 'https://esbuild.github.io', title: 'esbuild', expected: '/brand-icons/esbuild.svg' },
  { url: 'https://storybook.js.org', title: 'Storybook', expected: '/brand-icons/storybook.svg' },
  { url: 'https://min.io/', title: 'MinIO', expected: '/brand-icons/minio.svg' },
  { url: 'https://helm.sh/', title: 'Helm', expected: '/brand-icons/helm.svg' },
  { url: 'https://www.pulumi.com/', title: 'Pulumi', expected: '/brand-icons/pulumi.svg' },
  { url: 'https://dribbble.com', title: 'Dribbble', expected: '/brand-icons/dribbble.svg' },
  { url: 'https://www.behance.net', title: 'Behance', expected: '/brand-icons/behance.svg' },
  { url: 'https://logseq.com', title: 'Logseq', expected: '/brand-icons/logseq.svg' },
  { url: 'https://ollama.com', title: 'Ollama', expected: '/brand-icons/ollama.svg' },
  { url: 'https://shopee.com', title: 'Shopee虾皮', expected: '/brand-icons/shopee.svg' },
  { url: 'https://www.infoq.cn', title: 'InfoQ', expected: '/brand-icons/infoq.svg' },
  { url: 'https://qianwen.aliyun.com', title: '通义千问', expected: '/brand-icons/qwen.svg' },
  { url: 'https://mantine.dev', title: 'Mantine', expected: '/brand-icons/mantine.svg' },
  { url: 'https://sourcehut.org', title: 'SourceHut', expected: '/brand-icons/sourcehut.svg' },
  { url: 'https://www.coze.cn', title: 'Coze', expected: '/brand-icons/coze.svg' },
  { url: 'https://www.lintcode.com', title: 'LintCode', expected: '/brand-icons/lintcode.svg' },
]

const LOCAL_ASSETS = [
  'rollupdotjs.svg',
  'webpack.svg',
  'esbuild.svg',
  'storybook.svg',
  'minio.svg',
  'helm.svg',
  'pulumi.svg',
  'dribbble.svg',
  'behance.svg',
  'logseq.svg',
  'ollama.svg',
  'shopee.svg',
  'infoq.svg',
  'qwen.svg',
  'mantine.svg',
  'sourcehut.svg',
  'coze.svg',
  'lintcode.svg',
]

describe('resolveSiteIcon（图标修复第二批 2a）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('黑标事实钉死：Ollama / SourceHut 的 SVG 确为纯黑 fill', () => {
    // 2026-11-17：两站是 fill #000000 的透明底黑标；第一批处理 Notion /
    // Radix 的同款办法即不做特殊处理（caf73de0 diff 核实），深色模式下
    // 对比度弱是已知局限，留待深色底块统一处理轮。此断言把“黑标”钉死，
    // 免得将来有人误以为这两站已是彩色标而漏掉统一处理。
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of ['ollama.svg', 'sourcehut.svg']) {
      const svg = readFileSync(`${dir}${name}`, 'utf8')
      expect(svg.startsWith('<svg'), name).toBe(true)
      expect(svg.includes('#000000'), name).toBe(true)
    }
  })
})
