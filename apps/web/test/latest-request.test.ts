import { describe, expect, it } from 'vitest'
import { newRequestGate, settleLatest } from '../src/lib/latest-request'

/** 手动控制何时 resolve/reject，专门用来复现「先发后到」 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 对照用的「不过闸」实现：拿到什么就写什么（这就是要修掉的那个 bug） */
async function withoutGate<T>(task: () => Promise<T>): Promise<T> {
  return await task()
}

describe('闸门本身', () => {
  it('后来的号作废前面的号', () => {
    const gate = newRequestGate()
    const first = gate.begin()
    expect(gate.isCurrent(first)).toBe(true)
    const second = gate.begin()
    expect(gate.isCurrent(second)).toBe(true)
    expect(gate.isCurrent(first)).toBe(false)
  })

  it('invalidate 之后在途的都不算最新', () => {
    const gate = newRequestGate()
    const token = gate.begin()
    gate.invalidate()
    expect(gate.isCurrent(token)).toBe(false)
    // 作废后再发一次，新的那次才算数
    const next = gate.begin()
    expect(gate.isCurrent(next)).toBe(true)
  })

  it('没领过号的值不算最新（忘了 begin 不能被当成合法结果）', () => {
    const gate = newRequestGate()
    expect(gate.isCurrent(0)).toBe(false)
    expect(gate.isCurrent(Number.NaN)).toBe(false)
    expect(gate.isCurrent(-1)).toBe(false)
    expect(gate.isCurrent(1)).toBe(false)
  })

  it('两块闸门互不干扰', () => {
    const a = newRequestGate()
    const b = newRequestGate()
    const ta = a.begin()
    b.begin()
    expect(a.isCurrent(ta)).toBe(true)
    expect(b.isCurrent(ta)).toBe(false)
  })
})

describe('一次请求的结局判定', () => {
  it('成功且仍最新 → value', async () => {
    const gate = newRequestGate()
    const out = await settleLatest(gate, async () => ['a'])
    expect(out).toEqual({ status: 'value', value: ['a'] })
  })

  it('失败且仍最新 → error（失败必须能显示出来）', async () => {
    const gate = newRequestGate()
    const boom = new Error('中枢挂了')
    const out = await settleLatest(gate, async () => {
      throw boom
    })
    expect(out).toEqual({ status: 'error', error: boom })
  })

  it('被更新的请求顶掉 → stale（成功也不写）', async () => {
    const gate = newRequestGate()
    const slow = deferred<string[]>()
    const first = settleLatest(gate, () => slow.promise)
    void settleLatest(gate, async () => ['新'])
    slow.resolve(['旧'])
    expect(await first).toEqual({ status: 'stale' })
  })

  it('被顶掉的失败 → stale（过期的失败不能把新数据说成错误）', async () => {
    const gate = newRequestGate()
    const slow = deferred<string[]>()
    const first = settleLatest(gate, () => slow.promise)
    void settleLatest(gate, async () => ['新'])
    slow.reject(new Error('过期请求的失败'))
    expect(await first).toEqual({ status: 'stale' })
  })

  it('invalidate 之后回来的结果 → stale', async () => {
    const gate = newRequestGate()
    const slow = deferred<string[]>()
    const p = settleLatest(gate, () => slow.promise)
    gate.invalidate()
    slow.resolve(['不该被采用'])
    expect(await p).toEqual({ status: 'stale' })
  })
})

describe('真实场景复盘：连点两次，慢的先到还是后到都不能写错', () => {
  it('先发的慢请求后到：界面只认后发那次', async () => {
    const gate = newRequestGate()
    const slow = deferred<string[]>()
    const fast = deferred<string[]>()

    // 用户连点：第一次「领域」（慢），第二次「平台」（快）
    const first = settleLatest(gate, () => slow.promise)
    const second = settleLatest(gate, () => fast.promise)

    // 后发的先返回，先发的后返回
    fast.resolve(['平台标签'])
    slow.resolve(['领域标签'])

    const applied: string[] = []
    for (const out of await Promise.all([first, second])) {
      if (out.status === 'value') applied.push(...out.value)
    }

    expect(applied).toEqual(['平台标签'])
  })

  it('对照：不过闸就会把过期结果写进界面（这就是要修的那个 bug）', async () => {
    const slow = deferred<string[]>()
    const fast = deferred<string[]>()
    const applied: string[] = []
    // 关键：按「谁先到」写入，而不是按调用顺序（Promise.all 的数组顺序会骗人）
    const first = withoutGate(() => slow.promise).then((v) => applied.push(...v))
    const second = withoutGate(() => fast.promise).then((v) => applied.push(...v))

    fast.resolve(['平台标签'])
    slow.resolve(['领域标签'])
    await Promise.all([first, second])

    // 先发的那次后到，于是最后写进去的是过期的领域标签
    expect(applied).toEqual(['平台标签', '领域标签'])
  })
})
