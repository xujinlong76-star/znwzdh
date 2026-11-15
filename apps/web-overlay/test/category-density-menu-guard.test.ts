// Step 2（Bundle 瘦身第二刀）：分类头密度下拉内容必须按需加载。
//
// 背景：category-in-situ-controls.tsx 每个分类头都渲染一份，下拉内容子树
// （宽度 4 预设、高度 4 预设、重置项、5 个密度项，约 7KB 代码）以前随父
// 组件静态进 `/` 初始 chunk；首屏只渲染触发按钮，菜单内容只在用户打开
// 时才需要。改法：内容抽到 category-density-menu-content.tsx，父组件
// 经 next/dynamic({ ssr: false }) + 受控 open 按需加载，hover/focus 预取。
//
// 锁死点：
//  - 父组件不得静态 import 菜单内容文件（只许 dynamic + import() 预取）。
//  - 父组件的 dropdown-menu import 只许留根与触发器（DropdownMenu /
//    DropdownMenuTrigger），内容件（Content/Item/Label/Separator）必须
//    随子组件走，否则拆了等于没拆。
//  - 菜单 open 必须受控（chunk 未就绪时点按先加载、就绪后自动开菜单），
//    触发按钮必须有 hover/focus 预取，否则触屏首次点按会“点了没反应”。
//  - 子组件纯展示：不得 import useHomeDIY / useModuleWindowSize /
//    useToast（状态写回与 toast 都在父组件的回调里），否则会把 hook
//    引用链带回异步 chunk。
//  - 触发按钮与尺寸/高亮态留在父组件（aria-label 与 useModuleWindowSize
//    调用不动），首屏渲染零变化。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('分类头密度下拉按需加载（Bundle 第二刀）', () => {
  it('父组件不静态引入菜单内容文件，只走 next/dynamic 与 import() 预取', () => {
    const controls = read('src/components/category-in-situ-controls.tsx')
    expect(controls).not.toMatch(
      /import(?!\s+type)\b[^'";]*from\s+['"]\.\/category-density-menu-content['"]/,
    )
    expect(controls).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\('\.\/category-density-menu-content'\)/,
    )
    expect(controls).toContain("void import('./category-density-menu-content')")
  })

  it('父组件的 dropdown-menu import 只留根与触发器，内容件随子组件走', () => {
    const controls = read('src/components/category-in-situ-controls.tsx')
    const m = controls.match(
      /import\s*\{([^}]*)\}\s*from\s*'@\/registry\/new-york\/ui\/dropdown-menu'/,
    )
    expect(m).not.toBeNull()
    const names = m![1]
    expect(names).toContain('DropdownMenu')
    expect(names).toContain('DropdownMenuTrigger')
    expect(names).not.toContain('DropdownMenuContent')
    expect(names).not.toContain('DropdownMenuItem')
    expect(names).not.toContain('DropdownMenuLabel')
    expect(names).not.toContain('DropdownMenuSeparator')
  })

  it('菜单 open 受控、chunk 未就绪时先加载后开，触发按钮有 hover/focus 预取', () => {
    const controls = read('src/components/category-in-situ-controls.tsx')
    expect(controls).toContain('open={densityMenuOpen}')
    expect(controls).toContain('onOpenChange={handleDensityMenuOpenChange}')
    expect(controls).toContain('onMouseEnter={prefetchDensityMenu}')
    expect(controls).toContain('onFocus={prefetchDensityMenu}')
    expect(controls).toContain('aria-busy={densityMenuLoading || undefined}')
    expect(controls).toContain('setDensityMenuOpen(true)')
  })

  it('子组件纯展示：不 import useHomeDIY / useModuleWindowSize / useToast', () => {
    const child = read('src/components/category-density-menu-content.tsx')
    // 注释里会提到这三个名字（写明“不 import”），断言前先去注释。
    const code = child.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    expect(code).not.toContain('useHomeDIY')
    expect(code).not.toContain('useModuleWindowSize')
    expect(code).not.toContain('useToast')
    expect(code).not.toMatch(/from\s+['"]@\/lib\/modular\/use-home-diy['"]/)
    expect(code).not.toMatch(/from\s+['"]@\/lib\/modular\/module-resize-store['"]/)
    expect(code).not.toMatch(/from\s+['"]@\/components\/ui\/use-toast['"]/)
    expect(child).toContain('export default function CategoryDensityMenuContent')
  })

  it('触发按钮与尺寸/高亮态留在父组件，首屏渲染不变', () => {
    const controls = read('src/components/category-in-situ-controls.tsx')
    expect(controls).toContain('aria-label="针对此类目调整窗口尺寸与卡片形态"')
    expect(controls).toContain('useModuleWindowSize(')
    expect(controls).toContain('currentDensity')
    expect(controls).toContain('h-11 w-11 rounded-full transition-colors')
  })
})
