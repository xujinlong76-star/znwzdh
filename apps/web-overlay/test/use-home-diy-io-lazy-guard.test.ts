// Step 1（Bundle 瘦身第一刀）：use-home-diy.ts 必须按需加载 home-diy-io。
//
// 背景：home-diy-io（导入/导出/加密/云金库）+ vault + vault-copy 约 16–21KB，
// 首屏不渲染这些能力，静态 import 会把整块塞进 `/` 初始 chunk。
// 改法：hook 内 9 个函数改调用点 `await import()`，exportDIYConfig 是唯一由
// 同步改异步的；备份对话框是 hook 之外唯一的调用方（search-palette 只调
// stageImportForConfirm，本来就 await）。
//
// 锁死点：
//  - use-home-diy.ts 不得有 home-diy-io 的值 import（`import type` 是类型
//    擦除、零运行时成本，不受限；本文件目前连 import type 也没有）。
//  - 9 个回调必须全部走 loadHomeDiyIo（少一个就意味着有一个静态引用漏网）。
//  - 备份对话框两处 exportDIYConfig 调用必须 await，且 handleDownloadConfig
//    必须是 async（它是唯一同步处理函数）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('use-home-diy.ts 按需加载 home-diy-io（Bundle 第一刀）', () => {
  it('hook 不静态引入 home-diy-io（值 import），只动态 import', () => {
    const hook = read('src/lib/modular/use-home-diy.ts')
    expect(hook).not.toMatch(/import(?!\s+type)\b[^'";]*from\s+['"]\.\/home-diy-io['"]/)
    expect(hook).toContain("import('./home-diy-io')")
  })

  it('9 个 io 函数全部走 loadHomeDiyIo', () => {
    const hook = read('src/lib/modular/use-home-diy.ts')
    expect(hook.match(/await loadHomeDiyIo\(\)/g)?.length).toBe(9)
  })

  it('备份对话框两处 exportDIYConfig 调用都 await，且下载处理函数是 async', () => {
    const dialog = read('src/components/home-diy-backup-dialog.tsx')
    expect(dialog).toContain('exportDIYConfig: () => Promise<string>')
    expect(dialog.match(/await exportDIYConfig\(\)/g)?.length).toBe(2)
    expect(dialog).toContain('const handleDownloadConfig = async ()')
  })

  it('home-diy-io / diy-share-link / layout-sync / home-diy-storage 零改动', () => {
    // 本刀只改加载时序，不动这四块的逻辑；改动面由 git diff 复核，
    // 这里锁死「hook 不重新静态依赖它们」以外的部分：storage 仍是
    // 共享状态核心，share-link 与 layout-sync 仍被 storage 钉死。
    const hook = read('src/lib/modular/use-home-diy.ts')
    expect(hook).toContain("export * from './home-diy-storage'")
    expect(hook).toContain("from '@/lib/modular/layout-sync'")
  })
})
