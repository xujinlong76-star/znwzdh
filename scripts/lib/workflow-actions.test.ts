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
