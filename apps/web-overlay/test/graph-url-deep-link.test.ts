/**
 * U-381：/graph 节点选择与平替雷达中心不进 URL。
 *
 * 复现（纯 main be8fb8c5）：ecosystem-graph.tsx 里 selectedNode / radarCenter
 * 仍是纯 useState；useSearchParams 只读 category；全文件无 `?site=` / `?center=`
 * 读写。刷新/分享即丢选中与雷达中心。
 *
 * 体例：vitest 无 jsdom，沿用 history-visits-tab.test.ts 的源码文本断言。
 * 读 overlay 源码（经 pnpm mirror:web 同步到 apps/web/test 后生效）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveGraphUrlRestore } from '../src/lib/graph-url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const GRAPH = overlaySource('src/components/ecosystem-graph.tsx')

describe('U-381：节点选择进 URL（?site=）', () => {
  it('读参：从 searchParams 读 site', () => {
    expect(GRAPH).toContain("searchParams.get('site')")
  })

  it('写参：选中节点时 router.replace 写回 site', () => {
    expect(GRAPH).toContain('router.replace')
    // 写参处必须出现 site 键；category 读参已存在，不算。
    expect(GRAPH).toContain("params.set('site', next.site)")
  })

  it('恢复：挂载后按 site 参数恢复选中（不在当前节点集里则不强行选中）', () => {
    // 恢复决策是纯函数（lib/graph-url.ts）：组件调它，逻辑本身由下面的
    // 行为测试覆盖，不只钉源码文本。
    expect(GRAPH).toContain('resolveGraphUrlRestore(')
    expect(GRAPH).toContain("const siteParam = searchParams.get('site')")
  })
})

describe('U-381：平替雷达中心进 URL（?center=）', () => {
  it('读参：从 searchParams 读 center', () => {
    expect(GRAPH).toContain("const centerParam = searchParams.get('center')")
  })

  it('写参：进入雷达时 router.replace 写回 center；退出雷达时清掉 center', () => {
    expect(GRAPH).toContain("params.set('center', next.center)")
    expect(GRAPH).toContain("params.delete('center')")
  })

  it('恢复：中心站不在抽样内时雷达仍能单开（ego 子图走全站母体，不走抽样）', () => {
    // egoSubgraph 以 allSites 为母体：恢复时只要站仍在全站里就进雷达，
    // 不要求它在当前 24 站抽样内。
    expect(GRAPH).toContain('egoSubgraph(allSites')
  })

  it('回落：center 指向已下线站点时退回默认视图，不卡死在雷达', () => {
    // 下线判定在纯函数里（lib/graph-url.ts）：按 centerParam 查全站母体，
    // 查不到且 live 已就绪即 delisted；组件按 delisted 清 radarCenter。
    expect(GRAPH).toContain('resolveGraphUrlRestore(')
    expect(GRAPH).toContain('restore.delistedCenter')
    expect(GRAPH).toMatch(/setRadarCenter\(null\)/)
  })
})

describe('U-381：不破坏既有 category 深链', () => {
  it('category 读参与焦点恢复仍在', () => {
    expect(GRAPH).toContain("searchParams.get('category')")
    expect(GRAPH).toContain('resolveGraphCategory(categoryParam')
  })
})

describe('U-381：恢复决策（纯函数行为，真实跑通）', () => {
  const allSites = [
    { id: 'cursor', title: 'Cursor' },
    { id: 'figma', title: 'Figma' },
    { id: 'notion', title: 'Notion' },
  ]
  const nodes = [
    { id: 'db_cursor', title: 'Cursor' },
    { id: 'db_figma', title: 'Figma' },
  ]
  const base = { allSites, nodes, liveReady: true, siteParam: null, centerParam: null }

  it('center 在全站里、但不在当前抽样内 → 仍进雷达（单开，不要求在抽样内）', () => {
    const r = resolveGraphUrlRestore({ ...base, centerParam: 'notion' })
    expect(r.centerSite?.id).toBe('notion')
    expect(r.delistedCenter).toBe(false)
  })

  it('center 在抽样内 → 同样进雷达', () => {
    const r = resolveGraphUrlRestore({ ...base, centerParam: 'cursor' })
    expect(r.centerSite?.id).toBe('cursor')
    expect(r.delistedCenter).toBe(false)
  })

  it('center 已下线（live 就绪且全站无此 id）→ delisted，组件退回默认视图', () => {
    const r = resolveGraphUrlRestore({ ...base, centerParam: 'gone-site' })
    expect(r.centerSite).toBeNull()
    expect(r.delistedCenter).toBe(true)
  })

  it('center 查不到、但 live 未就绪（示例态）→ 不判定下线、不进雷达', () => {
    const r = resolveGraphUrlRestore({ ...base, centerParam: 'gone-site', liveReady: false, allSites: [] })
    expect(r.centerSite).toBeNull()
    expect(r.delistedCenter).toBe(false)
  })

  it('site 在当前节点集里 → 选中该节点', () => {
    const r = resolveGraphUrlRestore({ ...base, siteParam: 'db_figma' })
    expect(r.selectedNode?.id).toBe('db_figma')
  })

  it('site 不在当前节点集里 → 不强行选中（null），留在默认视图', () => {
    const r = resolveGraphUrlRestore({ ...base, siteParam: 'db_notion' })
    expect(r.selectedNode).toBeNull()
  })

  it('center 优先于 site：两者同时给时只恢复 center', () => {
    const r = resolveGraphUrlRestore({ ...base, centerParam: 'notion', siteParam: 'db_figma' })
    expect(r.centerSite?.id).toBe('notion')
    expect(r.selectedNode).toBeNull()
  })

  it('无参数 → 全部 undefined，不恢复', () => {
    const r = resolveGraphUrlRestore(base)
    expect(r.centerSite).toBeUndefined()
    expect(r.delistedCenter).toBe(false)
    expect(r.selectedNode).toBeUndefined()
  })
})
