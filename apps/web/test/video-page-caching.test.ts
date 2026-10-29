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

describe('替换历史上限是可观测的，不是静默丢弃', () => {
  const code = read('lib/video-harvester.ts')

  it('不再有裸的 slice(0, 100)', () => {
    // 原来是一行 `[...new, ...old].slice(0, 100)`：第 101 条起静默消失，
    // 运营想回滚两周前的替换时才发现记录没了，日志里也没有任何痕迹。
    expect(stripComments(code)).not.toMatch(/slice\(0,\s*100\)/)
  })

  it('走 capReplacementHistory()，超限时留下告警', () => {
    expect(stripComments(code)).toContain('capReplacementHistory(')
    expect(stripComments(code)).toContain('REPLACEMENT_HISTORY_LIMIT')
    // 上限本身也要有出处，不能又变回魔法数字
    expect(stripComments(code)).toMatch(/const\s+REPLACEMENT_HISTORY_LIMIT\s*=\s*\d+/)
  })
})
