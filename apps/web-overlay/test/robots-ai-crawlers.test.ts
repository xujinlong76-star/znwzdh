import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * robots.txt AI 爬虫分级守卫（2026-11-23 战略研究周一轮，方案 A）。
 *
 * 分级口径（W2 已核实，见 llms.txt 研究）：
 * - 搜索回答类（OAI-SearchBot / Claude-SearchBot / PerplexityBot）显式放行；
 * - 训练类（GPTBot / ClaudeBot / Google-Extended / CCBot / Bytespider）显式禁抓整站；
 * - 不用 `User-agent: *` 一刀切：`*` 组一旦 Disallow 全站会误伤无专属分组的 AI 爬虫。
 *
 * 本测试只读 robots.ts 源码字符串断言（与 seo-invariants.test.ts 同款范式），
 * 不调 siteOrigin()，不依赖环境变量。
 * seo-invariants 的既有断言（`*` 组含 /admin、/api/、/s/，且不含私密页 Disallow）
 * 由本文件之外的测试继续覆盖；这里只锁新增的两组分级。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const robots = overlayFile('src/app/robots.ts')

describe('robots.txt AI 爬虫分级', () => {
  it('搜索回答类爬虫显式放行，放行范围与 * 组一致（后台 / API / 短链仍禁抓）', () => {
    expect(robots).toMatch(
      /userAgent: \['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'\],\s*\n\s*allow: '\/',\s*\n\s*disallow: \['\/admin', '\/api\/', '\/s\/'\],/,
    )
  })

  it('训练类爬虫显式禁抓整站', () => {
    expect(robots).toMatch(
      /userAgent: \['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider'\],\s*\n\s*disallow: \['\/'\],/,
    )
  })

  it('* 组仍是放行整站（Allow /），不被改成一刀切禁抓', () => {
    expect(robots).toMatch(/userAgent: '\*',\s*\n\s*allow: '\/',\s*\n\s*disallow: \[/)
    expect(robots).not.toMatch(/userAgent: '\*',[\s\S]{0,300}?disallow: \['\/'\]/)
  })

  it('llms.txt 不进 Disallow（它是目录不是门禁）', () => {
    expect(robots).not.toMatch(/disallow:[^\]]*llms/)
  })
})
