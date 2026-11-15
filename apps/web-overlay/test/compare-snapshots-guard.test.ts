/**
 * 对照快照面板接线守卫测试（Batch 4 Phase 2 P2-3）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom——组件挂载测不了（见
 * compare-page-guard.test.ts 同款说明），接线与渲染纪律走源码守卫体例：
 *   - 对照页经 next/dynamic + { ssr: false } 懒加载快照面板，不进首屏 chunk；
 *   - 面板取数走快照三接口（保存 POST / 列表 GET / diff GET ?against=），
 *     保存只发 siteIds（格子由服务端现算冻结），无 PUT/PATCH/DELETE；
 *   - diff 视图只高亮变了的行，三种事实变化标签齐全，不标谁赢、不打分、
 *     不生成结论句。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 去掉块注释与行注释：守卫断言的是「代码真的用了」，不是「注释里提到了」 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const page = overlaySource('src/app/compare/page.tsx')
const panel = overlaySource('src/components/snapshot-panel.tsx')

describe('对照页接线：快照面板懒加载', () => {
  it('快照面板经 next/dynamic + { ssr: false } 懒加载（照抄 CompareView 范式）', () => {
    const code = stripComments(page)
    expect(code).toContain('next/dynamic')
    expect(code).toContain("import('@/components/snapshot-panel')")
    expect(code).toContain('ssr: false')
    expect(code).toContain('<SnapshotPanel siteIds={validated.siteIds} />')
  })

  it('快照面板只在校验通过时挂载，不合规不取数', () => {
    const code = stripComments(page)
    expect(code).toContain('<CompareView siteIds={validated.siteIds} />')
    expect(code).toContain('<SnapshotPanel siteIds={validated.siteIds} />')
  })
})

describe('快照面板取数：三接口 + 只发 siteIds', () => {
  it('保存走 POST /api/compare/snapshots，列表走 GET，diff 走 GET ?against=', () => {
    const code = stripComments(panel)
    expect(code).toContain("hubUrl('/api/compare/snapshots')")
    expect(code).toContain("method: 'POST'")
    expect(code).toContain('/diff?against=')
    expect(code).toContain('保存快照')
    expect(code).toContain('历史快照')
    expect(code).toContain('变化对比')
  })

  it('保存只发 siteIds：请求体里没有格子字段，调用方编不出假格子', () => {
    const code = stripComments(panel)
    expect(code).toContain('JSON.stringify({ siteIds })')
    expect(code).not.toContain('JSON.stringify({ siteIds, items')
  })

  it('没有任何改写快照的入口：无 PUT/PATCH/DELETE 调用', () => {
    const code = stripComments(panel)
    expect(code).not.toContain("method: 'PUT'")
    expect(code).not.toContain("method: 'PATCH'")
    expect(code).not.toContain("method: 'DELETE'")
  })

  it('401 报诚实错误，不渲染空列表', () => {
    const code = stripComments(panel)
    expect(code).toContain('401')
    expect(code).toContain('对照快照只对登录用户开放')
  })
})

describe('diff 视图纪律：只标事实变化', () => {
  it('三种事实变化标签齐全：值变了 / 新增了验证 / 从未验证变成已验证', () => {
    const code = stripComments(panel)
    expect(code).toContain("value_changed: '值变了'")
    expect(code).toContain("became_verified: '从未验证变成已验证'")
    expect(code).toContain("verification_added: '新增了验证'")
  })

  it('只高亮变了的行：复用对照表色板 border-primary/40 + bg-primary/5', () => {
    const code = stripComments(panel)
    expect(code).toContain('border-primary/40')
    expect(code).toContain('bg-primary/5')
  })

  it('无 winner、无打分、无结论句：diff 只陈述事实', () => {
    const code = stripComments(panel)
    expect(code).not.toMatch(/\bwinner\b/i)
    expect(code).not.toMatch(/\bscore\b/i)
    expect(code).not.toContain('结论')
    expect(code).not.toContain('推荐')
    expect(code).not.toContain('胜出')
  })

  it('两张都选好且不同才取 diff；相同快照不取', () => {
    const code = stripComments(panel)
    expect(code).toContain('baseId === againstId')
    expect(code).toContain('这两张快照逐格一致，没有变化。')
  })
})
