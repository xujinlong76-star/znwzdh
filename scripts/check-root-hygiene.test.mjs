import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { classifyRootEntry, collectRootEntries, rootEntries } from './check-root-hygiene.mjs'

const roots = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true })
})

describe('root hygiene', () => {
  it('includes untracked root entries while collapsing directories', () => {
    const entries = collectRootEntries(
      'package.json\0apps\0apps/web/package.json\0',
      '.probe-home.png\0scripts\0scripts/perf/probe.mjs\0',
    )
    assert.deepEqual(entries, ['.probe-home.png', 'apps', 'package.json', 'scripts'])
  })

  it('rejects dot-prefixed probes and screenshots', () => {
    assert.equal(classifyRootEntry('.probe-home.png').forbidden, true)
    assert.equal(classifyRootEntry('.probe-accept.mjs').forbidden, true)
  })

  it('allows permanent probes below the root', () => {
    assert.equal(classifyRootEntry('scripts').forbidden, false)
    assert.equal(classifyRootEntry('permanent-probe.mjs').forbidden, false)
  })

  it('只扫描未跟踪且未被 gitignore 忽略的根目录条目', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'navhub-root-hygiene-'))
    roots.push(cwd)
    execFileSync('git', ['init', '--quiet'], { cwd })
    writeFileSync(join(cwd, '.gitignore'), '.probe-ignored.png\n')
    writeFileSync(join(cwd, '.probe-visible.png'), 'visible')
    writeFileSync(join(cwd, 'package.json'), '{}\n')
    execFileSync('git', ['add', 'package.json'], { cwd })

    const entries = rootEntries(cwd)
    assert.ok(entries.includes('.probe-visible.png'))
    assert.ok(entries.includes('package.json'))
    assert.ok(!entries.includes('.probe-ignored.png'))
  })
})
