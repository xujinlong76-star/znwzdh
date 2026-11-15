// Bundle 瘦身续刀：CRDT 漫游同步引擎按需加载。
//
// 背景：小药丸整棵子树（pill 本体 + useCrdtRoaming hook +
// lib/crdt-sync + lib/crdt-presence，约 19.5KB 代码）只在挂载后经
// effect 启动同步引擎，却随 sidebar 静态进 `/` 初始 chunk。改法：
// sidebar 里 pill 改 next/dynamic({ ssr: false }) + 静态占位按钮
// （与 'syncing' 态像素一致），hook 初始态由 'synced' 改 'syncing'。
//
// 与 0622 方案书 §4.1 的差别：方案书只让引擎（sync + presence）走
// effect 内 await import、小药丸留静态——那样只能省 5.7–7.3KB
// （hook 经 pill 静态 import 仍在初始 chunk 里），盖不住 7KB 缺口；
// 本刀把整棵子树一次 dynamic，预期省 10.7–13.6KB。
//
// 锁死点：
//  - sidebar 不得静态 import 小药丸（只许 dynamic + .then 取命名导出）。
//  - sidebar 不得静态 import hook（引擎不得经侧边栏偷溜回初始 chunk）。
//  - dynamic 必须 ssr: false 且 loading 是占位按钮（首屏不拉 chunk）。
//  - 占位按钮须是 'syncing' 态外观（多端协同中… + 转圈），且不引新图标。
//  - hook 初始态必须是 'syncing'（挂载时尚未完成首次合流，'synced'
//    会短暂谎报已同步）；且不得再 import 未使用的 mergeOperationLogs。
//  - pill 仍是 hook 的唯一使用方（引擎仍在，只是隔在 dynamic 边界后）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const SIDEBAR = 'src/components/sidebar.tsx'
const PILL_PATH = '@/components/crdt/crdt-sync-status-pill'
const HOOK = 'src/hooks/use-crdt-roaming.ts'
const PILL = 'src/components/crdt/crdt-sync-status-pill.tsx'

describe('CRDT 同步小药丸按需加载（Bundle 瘦身续刀）', () => {
  it('sidebar 不静态引入小药丸，只走 next/dynamic', () => {
    const src = read(SIDEBAR)
    // 值 import 禁止；import type 本文件不存在，出现即错。
    expect(src).not.toMatch(
      new RegExp(`import(?!\\s+type)\\b[^'";]*from\\s+['"]${PILL_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
    )
    expect(src).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/crdt\/crdt-sync-status-pill'\)\.then\(\s*\(m\)\s*=>\s*m\.CrdtSyncStatusPill,?\s*\)/,
    )
    expect(src).toContain('{ ssr: false, loading: () => <CrdtSyncStatusPillPlaceholder /> }')
  })

  it('sidebar 不静态引入 CRDT hook，引擎不得偷溜回初始 chunk', () => {
    const src = read(SIDEBAR)
    expect(src).not.toContain("from '@/hooks/use-crdt-roaming'")
    expect(src).not.toContain("from '@/lib/crdt-sync'")
    expect(src).not.toContain("from '@/lib/crdt-presence'")
  })

  it('小药丸仍在 mod:crdt-pill 门内渲染，渲染点不动', () => {
    const src = read(SIDEBAR)
    expect(src).toContain("isModuleHidden('mod:crdt-pill')")
    expect(src).toContain('<CrdtSyncStatusPill />')
  })

  it('占位按钮与小药丸 syncing 态同外观，且不引新图标', () => {
    const src = read(SIDEBAR)
    expect(src).toContain('function CrdtSyncStatusPillPlaceholder()')
    expect(src).toContain('多端协同中…')
    expect(src).toContain('animate-spin')
    // 占位用纯 CSS 转圈：Loader2 只活在 admin 页与小药丸动态 chunk 里，
    // 侧边栏引它会给初始 chunk 添一个新图标模块。
    expect(src).not.toContain('Loader2')
  })

  it("hook 初始态是 'syncing'，挂载时不谎报已同步", () => {
    const src = read(HOOK)
    expect(src).toContain("useState<CrdtSyncStatus>('syncing')")
    expect(src).not.toContain("useState<CrdtSyncStatus>('synced')")
  })

  it('hook 不再 import 未使用的 mergeOperationLogs', () => {
    const src = read(HOOK)
    expect(src).not.toContain('mergeOperationLogs')
  })

  it('小药丸仍是 hook 的唯一使用方，引擎仍在 dynamic 边界后', () => {
    const pill = read(PILL)
    expect(pill).toContain("import { useCrdtRoaming } from '@/hooks/use-crdt-roaming'")
    expect(pill).toContain('useCrdtRoaming()')
    const hook = read(HOOK)
    expect(hook).toContain("from '@/lib/crdt-sync'")
    expect(hook).toContain("from '@/lib/crdt-presence'")
  })
})
