import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * mock 卫生守卫（第六批 D2 深研的制度化收口）。
 *
 * 背景：vitest isolate:false 实测（2026-10-25，两轮全量）证明 vi.mock 的模块
 * 缓存与 process.env 改动会按 worker 持久（vitest#4894 类问题），失败组合随
 * worker 调度随机、无法收敛验证——isolate 因此维持关闭。但若未来要重启该
 * 优化（全量 457s→149s），前提是每个使用 vi.mock / 改写 process.env 的测试
 * 文件都自带清理。本守卫把这一前提钉死为现状基线：
 *   1. 使用 vi.mock( 的测试文件必须出现 vi.resetModules()（afterAll 清缓存）；
 *   2. 写 process.env.X = 的测试文件必须存在 afterAll 钩子（有清理挂载点），
 *      或显式标注 `// mock-hygiene: exempt` 豁免。
 * 特例豁免：包内 mock 自身模块（vi.mock 指向测试文件同目录的相对路径且文件
 * 内已有 afterEach 恢复）不强制——本守卫只对「跨包/跨模块」mock 提要求，
 * 通过排除以 './' 或 '../' 开头的相对目标近似判定。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')

const SCAN_DIRS = [
  'apps/web-overlay/test',
  'apps/api/test',
  'packages/ai/test',
  'packages/mcp/test',
  'packages/store/test',
  'packages/core/test',
].filter((d) => existsSync(resolve(ROOT, d)))

function testFiles(): string[] {
  const out: string[] = []
  for (const dir of SCAN_DIRS) {
    const abs = resolve(ROOT, dir)
    for (const f of readdirSync(abs)) {
      if (f.endsWith('.test.ts')) out.push(join(dir, f))
    }
  }
  return out
}

const GIT_OK = (() => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/**
 * 扫描集 = 磁盘上的测试文件 ∩ 已入库（git 跟踪）。
 *
 * 2026-10-31 实测：并行会话在途的 video-shrink-confirm.test.ts 尚未补
 * vi.resetModules()，全量守卫把它算进违规，连累一个只含种子数据的提交
 * 跑 259 个测试时被判红——而那个文件并不在提交里。CI 检出的就是 HEAD，
 * 未跟踪文件在 CI 里不存在；在途文件归 pre-commit 的 --changed 管。
 * 去掉 .git 的运行环境（导出快照/裁剪镜像）退回全量扫描，宁可严格。
 */
function trackedTestFiles(): string[] {
  const all = testFiles()
  if (!GIT_OK) return all
  const listed = execFileSync('git', ['ls-files', '--', ...SCAN_DIRS], { cwd: ROOT, encoding: 'utf8' })
  const tracked = new Set(
    listed.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\\/g, '/')),
  )
  return all.filter((rel) => tracked.has(rel.replace(/\\/g, '/')))
}

describe('测试文件 mock 卫生（isolate:false 重启前提）', () => {
  it('使用跨模块 vi.mock 的测试文件必须带 vi.resetModules() 清理', () => {
    const offenders: string[] = []
    for (const rel of trackedTestFiles()) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8')
      if (!src.includes('vi.mock(')) continue
      if (src.includes('mock-hygiene: exempt')) continue
      // 只约束跨模块 mock：目标以包名或 @scope 开头（相对路径 ./ ../ 的文件内
      // mock 通常配对 afterEach 恢复，不构成跨文件驻留）
      const crossModule = /vi\.mock\(\s*['"](@[^'"]+|[a-z@][^'".]*[a-z])['"]/.test(src)
      if (!crossModule) continue
      if (!src.includes('vi.resetModules()')) offenders.push(rel)
    }
    expect(offenders, '缺少 vi.resetModules() 卫生的文件').toEqual([])
  })

  it('写 process.env 的测试文件必须存在清理钩子（afterAll）或显式豁免', () => {
    const offenders: string[] = []
    for (const rel of trackedTestFiles()) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8')
      if (src.includes('mock-hygiene: exempt')) continue
      // 只看「赋值」不看读取：process.env.X = 且非 === 比较
      const writes = /process\.env\.[A-Z_]+\s*=(?!=)/.test(src)
      if (!writes) continue
      if (!/\bafterAll\b/.test(src)) offenders.push(rel)
    }
    expect(offenders, '改写 process.env 但没有 afterAll 清理钩子的文件').toEqual([])
  })

  it('扫描集覆盖了仓库的全部测试目录', () => {
    expect(SCAN_DIRS.length).toBeGreaterThanOrEqual(5)
    for (const d of SCAN_DIRS) {
      expect(existsSync(resolve(ROOT, d)), d).toBe(true)
    }
  })

  it('全量扫描只看已入库测试文件：在途未跟踪文件不参与判定', () => {
    if (!GIT_OK) return // 没有 .git 的环境退回全量扫描（宁可严格），此断言不适用
    const fixture = join('apps/web-overlay/test', `mock-hygiene-untracked-fixture-${process.pid}.test.ts`)
    // 夹具自带兜底，避免并行运行的镜像副本恰好扫到它的瞬间被误判成违规
    writeFileSync(
      resolve(ROOT, fixture),
      "import { afterAll } from 'vitest'\nvi.mock('mock-hygiene-fixture-pkg')\nvi.resetModules()\nvoid afterAll\n",
      'utf8',
    )
    try {
      expect(testFiles()).toContain(fixture) // 对照臂：磁盘扫描确实看得见它
      expect(trackedTestFiles()).not.toContain(fixture)
      const listed = execFileSync('git', ['ls-files', '--', ...SCAN_DIRS], { cwd: ROOT, encoding: 'utf8' })
      const tracked = new Set(
        listed.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/\\/g, '/')),
      )
      for (const rel of trackedTestFiles()) {
        expect(tracked.has(rel.replace(/\\/g, '/')), rel).toBe(true)
      }
    } finally {
      rmSync(resolve(ROOT, fixture), { force: true })
    }
  })
})
