/**
 * 工作台布局损坏时的「现场保留」回归（P2-7）。
 *
 * 修的是什么：`use-modular-layout` 在 localStorage 里 JSON 解析失败时只 `console.warn`
 * 后回退默认模板，而紧随其后的自动持久化副作用会把默认模板**写回同一个 key** ——
 * 用户被截断/污染的布局就此静默丢失，事后无现场可查（也谈不上恢复）。
 *
 * 这里覆盖两半：纯函数行为（备份 key 带时间戳、写盘失败不抛）与接线
 * （catch 分支必须备份、并抑制紧随其后的默认模板回写）。
 *
 * 断言刻意不依赖「把注释挖空」的扫描器：一旦扫描器被字符串/正则里的引号带偏，
 * 后面所有注释都会漏屏蔽（本项目真栽过）。这里只锁语义形态。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { backupCorruptPayload, corruptBackupKey } from '../src/lib/modular/workspace-storage'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')

describe('corruptBackupKey：时间戳把二次损坏分开', () => {
  it('同一 key 的不同时间点给出不同备份 key', () => {
    expect(corruptBackupKey('navhub_x', 1)).toBe('navhub_x.corrupt.1')
    expect(corruptBackupKey('navhub_x', 2)).not.toBe(corruptBackupKey('navhub_x', 1))
  })
})

describe('backupCorruptPayload：尽力而为，失败不得再打断初始化', () => {
  it('正常写入并返回备份 key', () => {
    const store = new Map<string, string>()
    const key = backupCorruptPayload('navhub_x', '{oops', 42, {
      setItem: (k, v) => void store.set(k, v),
    })
    expect(key).toBe('navhub_x.corrupt.42')
    expect(store.get('navhub_x.corrupt.42')).toBe('{oops')
  })

  it('setItem 抛错（隐私模式 / 配额耗尽）返回 null，不把异常再抛给初始化流程', () => {
    const key = backupCorruptPayload('k', 'raw', 1, {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(key).toBeNull()
  })
})

describe('接线：加载失败必须留证，且不得被默认模板回写抹掉', () => {
  const src = readFileSync(resolve(ROOT, 'src/lib/modular/use-modular-layout.ts'), 'utf8')

  it('catch 分支调用 backupCorruptPayload 备份原始字符串', () => {
    expect(src).toContain('backupCorruptPayload(STORAGE_KEY, raw')
  })

  it('置位 skipNextPersistRef，让持久化副作用跳过「默认模板回写」', () => {
    expect(src).toMatch(/skipNextPersistRef\.current\s*=\s*true/)
    // 持久化副作用里必须真的消费这个标记，否则置位等于没写
    expect(src).toMatch(/if \(skipNextPersistRef\.current\)\s*\{/)
  })
})
