import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 性能三项的源码级守卫（§16.1–§16.3）。
 *
 * 为什么用源码断言而不是行为测试：
 *   - `revalidate` / `dynamic` 是**模块级常量**，行为测试只能靠起 Next 才能观察；
 *   - 「索引是否懒构建」在 16 条数据上看不出差别，但结构一旦退回全量构建，
 *     200 条时才会暴露 —— 那时已经晚了；
 *   - 这三条都属于「改回去不会报错、只会悄悄变慢」的类型，正是守卫该守的东西。
 */

// 相对本文件定位，而不是 process.cwd()：vitest 的 cwd 是仓库根，
// 而源码在 apps/web/src（overlay 里是 apps/web-overlay/src）。
const SRC = join(import.meta.dirname, '..', 'src')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

/** 去掉块注释与行注释，避免「注释里提到旧写法」导致误判 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('/videos 走 ISR 而不是强制动态渲染', () => {
  const code = read('app/videos/page.tsx')

  it('导出 revalidate = 60（与数据缓存默认值对齐）', () => {
    expect(code).toMatch(/export\s+const\s+revalidate\s*=\s*60/)
  })

  it('不再使用 force-dynamic', () => {
    // force-dynamic 会把 getFileContent 的 Next Data Cache 整个废掉，
    // 每个请求都要打一次中枢，而读到的东西最多差 60 秒。
    expect(stripComments(code)).not.toMatch(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/)
  })

  it('getData 用 React cache() 合并同一请求内的多次调用', () => {
    expect(code).toMatch(/from\s+['"]react['"]/)
    expect(stripComments(code)).toMatch(/cache\(\s*async\s*\(/)
  })
})

describe('搜索倒排索引只在需要时构建', () => {
  const code = read('components/video-content.tsx')

  it('buildVideoSearchIndex 由 hasQuery 条件守卫', () => {
    expect(stripComments(code)).toMatch(/hasQuery\s*\?\s*buildVideoSearchIndex\(/)
  })

  it('依赖数组里用布尔 hasQuery，而不是每次按键都变的 searchQuery', () => {
    // 若依赖 searchQuery，用户每敲一个字符就会重建一次索引
    const memoBlock = code.match(/const searchIndex = useMemo\([\s\S]*?\)\s*\n/)
    expect(memoBlock, '找不到 searchIndex 的 useMemo 定义').toBeTruthy()
    expect(memoBlock![0]).toMatch(/\[\s*hasQuery\s*,\s*navigationData\s*\]/)
  })
})

/*
 * 关于「替换历史硬截断 100 条」（P2-30）：本文件**不**为它加守卫。
 * 该改动落在 `lib/video-harvester.ts`，而同一文件里并行会话正在做「替换历史外置到
 * 独立文件」（`appendReplacementHistory`）。两处改动叠在一个文件里，必须一起落地；
 * 若在此单独断言，会让提交后的 HEAD 因为「源码还没带上另一半」而变红 ——
 * 那种失败是噪音，不是回归。守卫随那一批一起补。
 */
