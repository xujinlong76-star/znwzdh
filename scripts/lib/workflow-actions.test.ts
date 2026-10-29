import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

describe('CI 供应链边界', () => {
  it('所有远程 action 固定到 40 位 commit SHA，不能用可变主标签', () => {
    const uses = [...workflow.matchAll(/^\s*-\s+uses:\s*(\S+)/gm)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const spec of uses) {
      if (spec.startsWith('./')) continue
      expect(spec, spec).toMatch(/^[^@]+@[0-9a-f]{40}$/)
    }
  })

  it('CI 只申请 contents: read 权限', () => {
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m)
  })
})

describe('CI 测试遥测接线（分片 + junit）', () => {
  // 工作区是 CRLF、git blob 是 LF：源码级断言先归一，否则同一条命令在一边匹配得到、
  // 在另一边静默匹配不到——那就是「钉子没钉」
  const wf = workflow.replace(/\r\n/g, '\n')
  const lineOf = (needle: string) => wf.split('\n').find((l) => l.includes(needle)) ?? ''

  it('分片与 junit 参数真的到得了 vitest / playwright：pnpm 后不能多写 `--`', () => {
    // pnpm 会把 `--` 原样透传给脚本；vitest / playwright 把其后的一切当文件过滤器。
    // 2026-10-28 run 40671824883 实测：三个「分片」各跑了全量 473 个文件，
    // junit 0 个产物——分片和遥测同时空转，上传步骤靠 warn 静默放行。
    const unit = lineOf('run: pnpm test ')
    expect(unit).toContain('pnpm test --shard=${{ matrix.shard }}/3')
    expect(unit).toContain('--outputFile.junit=junit-sqlite-${{ matrix.shard }}.xml')
    expect(unit, unit).not.toMatch(/pnpm test\s+--(\s|$)/)

    const e2e = lineOf('PLAYWRIGHT_JUNIT_OUTPUT_NAME=')
    expect(e2e).toContain('pnpm test:e2e --shard=${{ matrix.shard }}/2')
    expect(e2e, e2e).not.toMatch(/pnpm test:e2e\s+--(\s|$)/)
  })

  it('junit 缺失不能静默：两个 junit 上传都必须是 if-no-files-found: error', () => {
    for (const name of ['junit-sqlite-${{ matrix.shard }}', 'junit-e2e-${{ matrix.shard }}']) {
      const at = wf.indexOf(`name: ${name}`)
      expect(at, name).toBeGreaterThan(-1)
      const block = wf.slice(at, at + 220)
      expect(block, name).toContain('if-no-files-found: error')
    }
  })
})
