/**
 * core 镜像同步器的单测。
 *
 * 为什么值得单测：这是「core ↔ 前端副本」唯一的自动闸门（见
 * docs/CODEBASE_OVERVIEW.md §3.2 记录的历史漂移）。它自己一旦变宽松
 * （横幅标记写错、CRLF 归一失效、把「缺失」判成「一致」），漂移就会静默进仓库，
 * 然后在构建期才炸。因此这里用内存 fs 桩把每条判定路径都钉住。
 */
import { describe, expect, it } from 'vitest'
import {
  PARITY_END,
  PARITY_START,
  buildBanner,
  checkMirrors,
  composeMirror,
  normalize,
  overlayPathOf,
  parseManifest,
  planSync,
  sourcePathOf,
  stripBanner,
  webPathOf,
} from './core-mirror.mjs'

const entries = [{ name: 'demo' }, { name: 'other' }]

/** 内存文件系统桩：路径 -> 内容 */
function memoryIo(files: Record<string, string>) {
  return {
    exists: (p: string) => Object.hasOwn(files, p),
    read: (p: string) => {
      if (!Object.hasOwn(files, p)) throw new Error(`read of missing file: ${p}`)
      return files[p]
    },
  }
}

describe('横幅与 parity 剥离', () => {
  it('剥掉横幅后应还原事实源正文', () => {
    const source = 'export const a = 1\n'
    const mirror = composeMirror(source, 'packages/core/src/demo.ts')
    expect(mirror.startsWith(PARITY_START)).toBe(true)
    expect(mirror).toContain(PARITY_END)
    expect(stripBanner(mirror)).toBe(source)
  })

  it('没有横幅的文件按原样返回（不误判为一致）', () => {
    const raw = 'export const a = 1\n'
    expect(stripBanner(raw)).toBe(raw)
  })

  it('横幅里必须写明事实源路径，方便人工顺藤摸瓜', () => {
    expect(buildBanner('packages/core/src/demo.ts')).toContain('packages/core/src/demo.ts')
  })

  it('CRLF 与 LF 不算漂移', () => {
    expect(normalize('a\r\nb\r\n')).toBe(normalize('a\nb\n'))
  })
})

describe('路径推导', () => {
  it('verbatim 条目按约定推导三处路径', () => {
    const e = { name: 'knowledge-graph' }
    expect(sourcePathOf(e)).toBe('packages/core/src/knowledge-graph.ts')
    expect(overlayPathOf(e)).toBe('apps/web-overlay/src/lib/knowledge-graph.ts')
    expect(webPathOf(e)).toBe('apps/web/src/lib/knowledge-graph.ts')
  })

  it('显式声明 source/target 时优先使用', () => {
    const e = { name: 'x', source: 'packages/core/src/a/b.ts', target: 'apps/web-overlay/src/lib/c.ts' }
    expect(sourcePathOf(e)).toBe('packages/core/src/a/b.ts')
    expect(webPathOf(e)).toBe('apps/web/src/lib/c.ts')
  })
})

describe('planSync 状态机', () => {
  const source = 'export const v = 1\n'

  it('两侧都与事实源一致时状态为 ok', () => {
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': composeMirror(source, 'packages/core/src/demo.ts'),
      'apps/web/src/lib/demo.ts': composeMirror(source, 'packages/core/src/demo.ts'),
    }
    const [plan] = planSync(entries.slice(0, 1), memoryIo(files))
    expect(plan.status).toBe('ok')
    expect(plan.reasons).toEqual([])
  })

  it('镜像缺横幅但内容与事实源相同，仍判一致（容忍无横幅的历史文件）', () => {
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': source,
      'apps/web/src/lib/demo.ts': source,
    }
    const [plan] = planSync(entries.slice(0, 1), memoryIo(files))
    expect(plan.status).toBe('ok')
  })

  it('镜像被手改后必须判为待同步并给出具体文件', () => {
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': 'export const v = 2 // 手改\n',
      'apps/web/src/lib/demo.ts': composeMirror(source, 'packages/core/src/demo.ts'),
    }
    const [plan] = planSync(entries.slice(0, 1), memoryIo(files))
    expect(plan.status).toBe('write')
    expect(plan.reasons.join(' ')).toContain('overlay 与事实源不一致')
    expect(plan.reasons.join(' ')).not.toContain('web 与事实源不一致')
  })

  it('镜像缺失必须报出来（不能静默当成 ok）', () => {
    const files = { 'packages/core/src/demo.ts': source }
    const [plan] = planSync(entries.slice(0, 1), memoryIo(files))
    expect(plan.reasons.join(' ')).toContain('overlay 缺失')
    expect(plan.reasons.join(' ')).toContain('web 缺失')
  })

  it('事实源不存在 → missing-source，不得写盘', () => {
    const [plan] = planSync([{ name: 'ghost' }], memoryIo({}))
    expect(plan.status).toBe('missing-source')
  })

  it('事实源为空 → empty-source', () => {
    const [plan] = planSync([{ name: 'blank' }], memoryIo({ 'packages/core/src/blank.ts': '  \n' }))
    expect(plan.status).toBe('empty-source')
  })
})

describe('checkMirrors', () => {
  it('全部一致时 ok=true 且无 failures', () => {
    const source = 'export const v = 1\n'
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': composeMirror(source, 'packages/core/src/demo.ts'),
      'apps/web/src/lib/demo.ts': composeMirror(source, 'packages/core/src/demo.ts'),
    }
    const res = checkMirrors([{ name: 'demo' }], memoryIo(files))
    expect(res.ok).toBe(true)
    expect(res.failures).toHaveLength(0)
  })

  it('任一漂移即 ok=false', () => {
    const source = 'export const v = 1\n'
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': '手改\n',
      'apps/web/src/lib/demo.ts': composeMirror(source, 'packages/core/src/demo.ts'),
    }
    const res = checkMirrors([{ name: 'demo' }], memoryIo(files))
    expect(res.ok).toBe(false)
    expect(res.failures).toHaveLength(1)
  })
})

describe('legs：只查已入库的那条腿', () => {
  const source = 'export const v = 1\n'
  const mirror = composeMirror(source, 'packages/core/src/demo.ts')

  it('legs=["overlay"] 时 apps/web 整棵树缺失也不算漂移', () => {
    // 提交里没有 apps/web/src（.gitignore:45），HEAD 口径必须看不见它，
    // 否则 13 条镜像会集体报「web 缺失」——闸门说谎。
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': mirror,
    }
    expect(checkMirrors([{ name: 'demo' }], memoryIo(files), { legs: ['overlay'] }).ok).toBe(true)
    expect(checkMirrors([{ name: 'demo' }], memoryIo(files)).ok).toBe(false)
  })

  it('legs=["overlay"] 只让 overlay 的漂移过关，web 的漂移不参与判定', () => {
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': mirror,
      'apps/web/src/lib/demo.ts': '手改\n',
    }
    expect(checkMirrors([{ name: 'demo' }], memoryIo(files), { legs: ['overlay'] }).ok).toBe(true)
    const bad = { ...files, 'apps/web-overlay/src/lib/demo.ts': '手改\n' }
    const res = checkMirrors([{ name: 'demo' }], memoryIo(bad), { legs: ['overlay'] })
    expect(res.failures[0].reasons).toEqual(['overlay 与事实源不一致：apps/web-overlay/src/lib/demo.ts'])
  })

  it('legs 反过来也能只查 web 那条（vendor 校验用得上）', () => {
    const files = {
      'packages/core/src/demo.ts': source,
      'apps/web-overlay/src/lib/demo.ts': '手改\n',
      'apps/web/src/lib/demo.ts': mirror,
    }
    expect(checkMirrors([{ name: 'demo' }], memoryIo(files), { legs: ['web'] }).ok).toBe(true)
  })

  it('事实源缺失与 legs 无关，永远算异常（没源头就没有「一致」可言）', () => {
    const files = { 'apps/web-overlay/src/lib/demo.ts': mirror }
    const res = checkMirrors([{ name: 'demo' }], memoryIo(files), { legs: ['overlay'] })
    expect(res.failures[0].status).toBe('missing-source')
  })
})

describe('清单解析', () => {
  it('按 verbatim / adapter / external 分组，缺省为空数组', () => {
    const m = parseManifest(JSON.stringify({ verbatim: [{ name: 'a' }] }))
    expect(m.verbatim).toHaveLength(1)
    expect(m.adapter).toEqual([])
    expect(m.external).toEqual([])
  })
})
