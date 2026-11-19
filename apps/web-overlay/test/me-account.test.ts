import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeDiagnostics } from '../src/app/me/account/account-view'
import type { DiagnosticCheckItem } from '../src/lib/user-settings'

/**
 * 「账号与身份」页守卫（用户中心升级批次）。
 *
 * 资料编辑、云端自检与数据删除入口都必须还在；匿名态只给登录 CTA，
 * 不能渲染资料表单（否则等于宣称匿名用户也能改云端资料）。
 */

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement('a', { href: typeof href === 'string' ? href : '#', ...props }, children),
  }
})

afterAll(() => {
  vi.resetModules()
})
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('/me/account 账号页', () => {
  it('页面与客户端岛存在，并复用概览取数钩子', () => {
    expect(existsSync(join(ROOT, 'src/app/me/account/page.tsx'))).toBe(true)
    const view = read('src/app/me/account/account-view.tsx')
    expect(view).toContain('useMeOverview')
    expect(view).toContain('id="main-content"')
  })

  it('资料编辑走 PATCH /api/me/profile，自检走 /api/me/diagnostics', () => {
    const view = read('src/app/me/account/account-view.tsx')
    expect(view).toContain("'/api/me/profile'")
    expect(view).toContain("method: 'PATCH'")
    expect(view).toContain("'/api/me/diagnostics'")
    expect(view).toContain('runClientStorageDiagnostics')
    expect(view).toContain('aliases')
  })

  it('匿名态只给登录 CTA，不渲染资料表单', () => {
    const view = read('src/app/me/account/account-view.tsx')
    // T1 起匿名提示统一为 AnonymousHint 组件（标题默认值在组件里）
    const hint = read('src/components/user-center/anonymous-hint.tsx')
    expect(view).toMatch(/state === 'anonymous'/)
    expect(view).toContain('AnonymousHint')
    expect(view).toContain('callbackUrl="/me/account"')
    expect(hint).toContain('当前是匿名身份')
    expect(hint).toContain('登录 / 创建账号')
  })

  it('危险区指向数据与隐私页', () => {
    const view = read('src/app/me/account/account-view.tsx')
    expect(view).toContain('href="/me/data"')
  })
})

/**
 * U-261 自检 toast 不谎报：云端非 2xx 时旧代码静默跳过、仍报「健康自检通过」。
 *
 * 三档对应三种 fetch 场景（仓库 vitest 是 node 环境、无 jsdom，点不到
 * 「开始自检」按钮，故在可导出的纯结算函数上做行为断言，接线另由源码
 * 守卫钉死）：
 *   - 云端 500 + 本机全过 → 本机通过、云端未核验（不再谎报全过）；
 *   - 本机 failed（无论云端通不通）→ 仍有 N 项异常未修复；
 *   - 全 ok → 保留现有「健康自检通过：0 项异常」文案。
 */
describe('U-261 自检 toast 三档（summarizeDiagnostics）', () => {
  const ok = (id: string): DiagnosticCheckItem => ({ id, label: id, status: 'ok', detail: '' })
  const failed = (id: string): DiagnosticCheckItem => ({ id, label: id, status: 'failed', detail: '' })
  const cloudUnavailable: DiagnosticCheckItem = {
    id: 'cloud-unavailable',
    label: '云端数据引用核验',
    status: 'unknown',
    detail: '云端检查未完成（服务端返回非 2xx），本次只核验了本机部分。',
  }

  it('云端 500 + 本机全过：不谎报全过，报本机通过、云端未核验', () => {
    const out = summarizeDiagnostics([ok('local-1'), cloudUnavailable], 0, false)
    expect(out.title).toBe('本机自检通过，云端未核验')
    expect(out.description).toBe('云端检查未完成，本次只核验了本机部分。')
  })

  it('本机 failed（云端通）：报仍有 N 项异常未修复，description 指明细', () => {
    const out = summarizeDiagnostics([failed('local-1'), ok('local-2')], 0, true)
    expect(out.title).toBe('自检完成：仍有 1 项异常未修复')
    expect(out.description).toBe('详见下方检查明细')
  })

  it('云端 500 + 本机 failed：合成行不计入异常数，仍只报本机那 1 项', () => {
    const out = summarizeDiagnostics([failed('local-1'), cloudUnavailable], 0, false)
    expect(out.title).toBe('自检完成：仍有 1 项异常未修复')
    expect(out.description).toBe('详见下方检查明细')
  })

  it('有修复时标题追加已修复 M 项', () => {
    const repaired: DiagnosticCheckItem = { id: 'r', label: 'r', status: 'repaired', detail: '' }
    const out = summarizeDiagnostics([failed('local-1'), repaired], 2, true)
    expect(out.title).toBe('自检完成：仍有 1 项异常未修复，已修复 2 项')
  })

  it('本机 unknown（如快照探针未完成）也计入未修复', () => {
    const unknown: DiagnosticCheckItem = { id: 'local_snapshot', label: 'x', status: 'unknown', detail: '' }
    const out = summarizeDiagnostics([unknown], 0, true)
    expect(out.title).toBe('自检完成：仍有 1 项异常未修复')
  })

  it('全 ok：保留现有文案；有修复时保留已自动修复文案', () => {
    const out = summarizeDiagnostics([ok('local-1')], 0, true)
    expect(out.title).toBe('健康自检通过：0 项异常')
    expect(out.description).toBe('本机存储结构、偏好设置与云端数据引用均已核验一致。')
    const repaired = summarizeDiagnostics([ok('local-1')], 3, true)
    expect(repaired.title).toBe('自检完成：已自动修复 3 项异常')
  })
})

describe('U-261 云端非 2xx 接线守卫', () => {
  it('runDiagnostics 记 cloudOk，非 2xx 追加合成行并经三档结算 toast', () => {
    const view = read('src/app/me/account/account-view.tsx')
    expect(view).toContain('const cloudOk = res.ok')
    expect(view).toContain("id: 'cloud-unavailable'")
    expect(view).toContain("label: '云端数据引用核验'")
    expect(view).toContain("status: 'unknown'")
    expect(view).toContain('云端检查未完成（服务端返回非 2xx），本次只核验了本机部分。')
    expect(view).toContain('toast(summarizeDiagnostics(combined, totalRepaired, cloudOk))')
    // 旧谎报：无条件 toast 全过文案的调用点已不存在
    expect(view).not.toContain('toast({\n        title: totalRepaired')
  })
})
