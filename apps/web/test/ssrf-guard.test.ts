import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { DEFAULT_GUARD, isBlockedIp, resolveAndCheck } from '../src/lib/ssrf-guard'

const OPTS = { ...DEFAULT_GUARD, timeoutMs: 20 }

describe('ssrf-guard DNS 边界', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it('DNS 查询超时按受保护处理，而不是无限挂起', async () => {
    lookupMock.mockReturnValue(new Promise(() => {}))
    await expect(resolveAndCheck(new URL('https://slow.example'), OPTS)).rejects.toThrow(/DNS 解析超时/)
  })

  it('任一解析结果落在受保护网段就拒绝', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    await expect(resolveAndCheck(new URL('https://mixed.example'), OPTS)).rejects.toThrow(/受保护地址/)
  })

  it('全部解析结果安全时放行', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(resolveAndCheck(new URL('https://public.example'), OPTS)).resolves.toBeUndefined()
  })

  it('阻断 100::/64 丢弃前缀', () => {
    expect(isBlockedIp('100::1')).toBe(true)
    expect(isBlockedIp('2606:4700::1111')).toBe(false)
  })
})

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});
