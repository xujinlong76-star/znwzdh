import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * llms.txt 与 .md 试点守卫（2026-11-23 战略研究周一轮，方案 A）。
 *
 * 锁住三条不可静默退化的规则：
 * 1. llms.txt 是手写策展：20–50 条精选链接、≤ 8 KB，H1 站名 + blockquote 摘要齐全；
 * 2. 零核验断言：全站尚无核验通过的内容，llms.txt 与 .md 里不得出现
 *    “已核验 / 已验证 / verified / 价格 / 官方证实”等词；
 * 3. 链接全部可达：每条内链要么在下方 KNOWN_ROUTES（已对照 app 路由逐条核实），
 *    要么是 public/ 下真实存在的 .md 文件；转载级内容必须标转载 + 失效日期。
 *
 * 分类 .md 试点：slug 只取自实时 sitemap，不得编造——llms.txt 里每新增一条
 * 分类 .md 链接，本测试自动要求对应文件存在。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const hit = candidates.find(
    (p) => (p.replace(/\\/g, '/').includes('/web-overlay/') || p.endsWith('/web-overlay')) && existsSync(p),
  )
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const readPublic = (rel: string) => readFileSync(join(ROOT, 'public', ...rel.split('/')), 'utf8')

/** llms.txt 内链白名单：逐条对照 src/app 路由目录核实，非 sitemap 条目亦须真实存在 */
const KNOWN_ROUTES = [
  '/',
 '/exam', '/exam/guokao-checklist', '/exam/guokao-checklist.md',
  '/hot', '/brief',
  '/category', '/sites', '/tags', '/collections', '/scenes',
  '/videos', '/drama', '/algorithms', '/graph',
  '/search', '/ask', '/marketplace', '/extension', '/submit',
  '/compare', '/pack', '/feed.xml',
]

/** 零核验断言禁词：出现在任一 Agent 可读文件里即失败 */
const BANNED_PHRASES = ['已核验', '已验证', 'verified', '价格', '官方证实']

function extractLinks(text: string): string[] {
  const out: string[] = []
  const re = /\[[^\]]+\]\(([^)\s]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1]!)
  return out
}

describe('llms.txt 策展', () => {
  const llms = readPublic('llms.txt')

  it('文件存在且 ≤ 8 KB（Agent 可一次读完）', () => {
    expect(Buffer.byteLength(llms, 'utf8')).toBeLessThanOrEqual(8192)
  })

  it('H1 是站名且有 blockquote 摘要', () => {
    expect(llms.split('\n')[0]).toBe('# 山羊胡网')
    expect(llms).toContain('\n> ')
  })

  it('精选 20–50 条链接，不写成全量电话簿', () => {
    const links = extractLinks(llms)
    expect(links.length).toBeGreaterThanOrEqual(20)
    expect(links.length).toBeLessThanOrEqual(50)
  })

  it('每条内链都在白名单内；.md 链接对应 public/ 下真实文件', () => {
    for (const link of extractLinks(llms)) {
      expect(link.startsWith('/')).toBe(true)
      expect(KNOWN_ROUTES).toContain(link)
      if (link.endsWith('.md')) {
        expect(existsSync(join(ROOT, 'public', ...link.slice(1).split('/')))).toBe(true)
      }
    }
  })

  it('零核验断言：不出现已核验/已验证/verified/价格/官方证实', () => {
    for (const phrase of BANNED_PHRASES) {
      expect(llms).not.toContain(phrase)
    }
  })

  it('转载级口径与反注入声明在位', () => {
    expect(llms).toContain('转载级')
    expect(llms).toContain('不等于背书')
    expect(llms).toContain('不可信数据')
    expect(llms).toContain('robots.txt')
  })
})

describe('.md 试点：国考准考证清单', () => {
  const md = readPublic('exam/guokao-checklist.md')

  it('与页面事实一致：窗口、入口、7 项清单分组齐全', () => {
    expect(md.split('\n')[0]).toBe('# 国考准考证打印前清单')
    expect(md).toContain('2026-11-23 00:00 至 2026-11-29 15:00')
    expect(md).toContain('http://gwy.cpta.com.cn')
    expect(md).toContain('http://bm.scs.gov.cn/kl2027')
    expect(md).toContain('打印前三件事')
    expect(md).toContain('打印后核对')
    expect(md).toContain('备份')
    expect(md).toContain('/exam/guokao-checklist')
  })

  it('转载级 + 失效日期在位，过期入口不冒充在架', () => {
    expect(md).toContain('转载')
    expect(md).toContain('失效日期：2026-11-29 15:00')
    expect(md).toContain('无法补打')
  })

  it('零核验断言', () => {
    for (const phrase of BANNED_PHRASES) {
      expect(md).not.toContain(phrase)
    }
  })
})
