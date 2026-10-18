/**
 * `withTimeout` 的回归：重点是「任务先完成时不留悬空定时器」。
 *
 * 旧写法 `Promise.race([task, new Promise((_, reject) => setTimeout(...))])`
 * 在任务成功时不会清掉那个 setTimeout —— 用假定时器可以把它**观测**出来
 * （`vi.getTimerCount()` 不为 0），这是纯行为断言，不依赖源码扫描。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from '../src/with-timeout.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  it('任务先完成：返回结果，且不留任何待触发定时器', async () => {
    vi.useFakeTimers()
    const out = await withTimeout(Promise.resolve('ok'), 30_000, '超时')
    expect(out).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('任务先失败：原样抛出任务自身的错误，同样清掉定时器', async () => {
    vi.useFakeTimers()
    await expect(withTimeout(Promise.reject(new Error('boom')), 30_000, '超时')).rejects.toThrow(
      'boom',
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('超时：抛出给定信息，并执行 onTimeout 清理回调', async () => {
    vi.useFakeTimers()
    let cleaned = 0
    const pending = withTimeout(
      new Promise<never>(() => {}),
      1000,
      'embedding 编码超时',
      () => {
        cleaned += 1
      },
    )
    const assertion = expect(pending).rejects.toThrow('embedding 编码超时')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(cleaned).toBe(1)
  })
})
