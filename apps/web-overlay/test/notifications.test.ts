import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

function markReadHarness(response: Response) {
  const source = readFileSync(new URL('../src/app/me/notifications/page.tsx', import.meta.url), 'utf8')
  const callback = source.slice(source.indexOf('  const markRead = useCallback('), source.indexOf('  const markAll = useCallback('))
  const compiled = ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let items = [{ id: 'n1', readAt: null as number | null }]
  let unread = 1
  const toast = vi.fn()
  const fetcher = vi.fn(async () => response)
  const markRead = new Function('useCallback', 'fetch', 'setItems', 'setUnread', 'toast', compiled + '\nreturn markRead')(
    (fn: unknown) => fn,
    fetcher,
    (update: (prev: typeof items) => typeof items) => { items = update(items) },
    (update: (prev: number) => number) => { unread = update(unread) },
    toast,
  ) as (id: string) => Promise<void>
  return { markRead, fetcher, toast, snapshot: () => ({ items, unread }) }
}

describe('通知页实际 markRead 回调', () => {
  it.each([
    [503, { ok: false }],
    [401, { ok: false }],
    [200, { ok: true, marked: false }],
  ])('HTTP %s 未确认标读时保留未读并反馈失败', async (status, body) => {
    const page = markReadHarness(Response.json(body, { status }))
    await page.markRead('n1')
    expect(page.snapshot().unread).toBe(1)
    expect(page.snapshot().items[0].readAt).toBeNull()
    expect(page.toast).toHaveBeenCalled()
  })

  it('服务端确认标记后才落到本地并清零', async () => {
    const page = markReadHarness(Response.json({ ok: true, marked: true }))
    await page.markRead('n1')
    expect(page.snapshot().unread).toBe(0)
    expect(page.snapshot().items[0].readAt).toEqual(expect.any(Number))
    expect(page.toast).not.toHaveBeenCalled()
  })
})
