/**
 * D1 更新链路判定纯函数守门。
 *
 * 判定语义（与 docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md · D1 对齐）：
 * - 未安装 → install；已安装且市场更高 → update；其余 → installed。
 * 更新执行通道 = 重装（服务端幂等增量，只增不删），因此这里只守「呈现哪种动作」。
 */
import { describe, expect, it } from 'vitest'
import { resolveInstallAction } from '../src/lib/plugins/install-state.ts'

describe('resolveInstallAction（安装 / 更新 / 已安装）', () => {
  it('未安装（空值）时报 install', () => {
    expect(resolveInstallAction(null, '1.0.0')).toBe('install')
    expect(resolveInstallAction(undefined, '1.0.0')).toBe('install')
    expect(resolveInstallAction('', '1.0.0')).toBe('install')
  })

  it('已安装且市场版本更高时报 update', () => {
    expect(resolveInstallAction('1.0.0', '1.1.0')).toBe('update')
    expect(resolveInstallAction('1.0.0', '2.0.0')).toBe('update')
    expect(resolveInstallAction('1.2.0', '1.10.0')).toBe('update')
    expect(resolveInstallAction('1.0', '1.0.1')).toBe('update')
  })

  it('版本相同或本地更新时报 installed', () => {
    expect(resolveInstallAction('1.0.0', '1.0.0')).toBe('installed')
    expect(resolveInstallAction('2.0.0', '1.0.0')).toBe('installed')
  })

  it('缺市场版本号时保守显示 installed（不误报更新）', () => {
    expect(resolveInstallAction('1.0.0', null)).toBe('installed')
    expect(resolveInstallAction('1.0.0', '')).toBe('installed')
  })
})
