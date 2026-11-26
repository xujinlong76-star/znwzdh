// Step 3a（Bundle 瘦身第三刀 a）：模块缩放手柄必须按需加载。
//
// 背景：module-resize-handles.tsx 约 20KB 代码，只在排版编辑态才渲染
// （非编辑态返回 null），以前却随 navigation-category-section /
// speed-dial-dock 静态进 `/` 初始 chunk，随 modular-item 进工作台异步
// chunk。改法：三处调用点改 next/dynamic({ ssr: false }) + 编辑态门
// （nav-cat-section 与 speed-dial-dock 用 isEditingLayout &&，
// modular-item 用 isEditing &&），首屏既不渲染也不拉 chunk。
//
// 锁死点：
//  - 三处文件不得静态 import 手柄（只许 dynamic + .then 取命名导出）。
//  - 三处渲染必须有编辑态门，否则 dynamic 仍会在挂载时拉 chunk。
//  - module-resize-store.ts 零改动：尺寸状态仍由父组件静态 import 使用
//    （nav-cat-section / speed-dial-dock / category-in-situ-controls
//    的 store import 必须在位）。
//  - U-438：home-hero-deck 已删除，本刀原「其静态 import 不动」的豁免随之失效。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const CALL_SITES = [
  {
    file: 'src/components/navigation-category-section.tsx',
    gate: 'isEditingLayout && (',
    importPath: '@/components/modular/module-resize-handles',
  },
  {
    file: 'src/components/speed-dial-dock.tsx',
    gate: 'isEditingLayout && (',
    importPath: '@/components/modular/module-resize-handles',
  },
  {
    file: 'src/components/modular/modular-item.tsx',
    gate: 'isEditing && (',
    importPath: './module-resize-handles',
  },
] as const

describe('模块缩放手柄按需加载（Bundle 第三刀 a）', () => {
  it.each(CALL_SITES)('$file 不静态引入手柄，只走 next/dynamic', ({ file, importPath }) => {
    const src = read(file)
    // 值 import 禁止；import type 本文件不存在，出现即错。
    const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(src).not.toMatch(
      new RegExp(`import(?!\\s+type)\\b[^'";]*from\\s+['"]${escaped}['"]`),
    )
    expect(src).toMatch(
      new RegExp(
        `dynamic\\(\\s*\\(\\)\\s*=>\\s*import\\('${escaped}'\\)\\.then\\(\\(m\\)\\s*=>\\s*m\\.ModuleResizeHandles\\)`,
      ),
    )
    expect(src).toContain('{ ssr: false, loading: () => null }')
  })

  it.each(CALL_SITES)('$file 渲染有编辑态门，首屏不拉 chunk', ({ file, gate }) => {
    const src = read(file)
    expect(src).toContain(gate)
    expect(src).toContain('<ModuleResizeHandles')
  })

  it('module-resize-store 仍静态 import，store 本身零改动', () => {
    const navCat = read('src/components/navigation-category-section.tsx')
    const dock = read('src/components/speed-dial-dock.tsx')
    const controls = read('src/components/category-in-situ-controls.tsx')
    for (const src of [navCat, dock, controls]) {
      expect(src).toContain("from '@/lib/modular/module-resize-store'")
    }
    expect(navCat).toContain('useModuleWindowSize(')
    expect(dock).toContain('useModuleWindowSize(')
  })
})
