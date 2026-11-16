import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复第一批回归（2026-11-16，进化第 94 轮）。
 *
 * 背景：61 站品牌图标在用户侧显示为渐变字母（研究笔记
 * evolution-round-2026-11-16-2122-research.md §4）。第一批修高可见的
 * 12 站 + 2 个烂 map 条目（lumalabs.ai、zhiwen.xfyun.cn 的旧值均为 404）。
 *
 * 这个测试直接执行 resolveSiteIcon：map 键写错一个字符（多一个 www、
 * 少一个字母）都不会报错，只会静默回落渐变——只有跑起来才看得见。
 */

const CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://dify.ai', title: 'Dify', expected: '/brand-icons/dify.svg' },
  { url: 'https://ant.design', title: 'Ant Design', expected: '/brand-icons/antdesign.svg' },
  { url: 'https://kubernetes.io', title: 'Kubernetes', expected: '/brand-icons/kubernetes.svg' },
  { url: 'https://spring.io/projects/spring-boot', title: 'Spring Boot', expected: '/brand-icons/springboot.svg' },
  { url: 'https://www.notion.com', title: 'Notion', expected: 'https://www.notion.so/images/favicon.ico' },
  { url: 'https://www.radix-ui.com', title: 'Radix UI', expected: 'https://github.com/radix-ui.png?size=64' },
  { url: 'https://boardmix.cn/', title: 'Boardmix', expected: '/brand-icons/boardmix.jpg' },
  { url: 'https://docs.qq.com', title: '腾讯文档', expected: '/brand-icons/tencent-docs.jpg' },
  { url: 'https://www.kdocs.cn', title: '金山文档', expected: '/brand-icons/kdocs.jpg' },
  { url: 'https://sspai.com', title: '少数派', expected: 'https://sspai.com/apple-touch-icon.png' },
  { url: 'https://www.pinduoduo.com', title: '拼多多', expected: 'https://www.pinduoduo.com/favicon.png' },
  { url: 'https://hongguoduanju.com/', title: '红果短剧', expected: '/brand-icons/hongguo.jpg' },
  // 烂条目修复：旧值均为 404（curl 验证），新值逐个验证过 200 + image MIME。
  { url: 'https://lumalabs.ai/app', title: 'Luma AI', expected: 'https://luma.ai/favicon.ico' },
  { url: 'https://zhiwen.xfyun.cn', title: '讯飞智文', expected: 'https://zhiwen.xfyun.cn/favicon.png' },
]

const LOCAL_ASSETS = [
  'dify.svg',
  'antdesign.svg',
  'kubernetes.svg',
  'springboot.svg',
  'boardmix.jpg',
  'tencent-docs.jpg',
  'kdocs.jpg',
  'hongguo.jpg',
]

describe('resolveSiteIcon（图标修复第一批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('标题规则「智文」也不再指向 404 的 favicon.ico', () => {
    expect(resolveSiteIcon('https://example.com', '智文')).toBe('https://zhiwen.xfyun.cn/favicon.png')
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const name of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })
})
