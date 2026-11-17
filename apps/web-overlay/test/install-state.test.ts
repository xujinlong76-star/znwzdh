/**
 * D1 更新链路判定纯函数守门。
 *
 * 判定语义（与 docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md · D1 对齐）：
 * - 未安装 → install；已安装且市场更高 → update；其余 → installed。
 * 更新执行通道 = 重装（服务端幂等增量，只增不删），因此这里只守「呈现哪种动作」。
 */
import { describe, expect, it } from 'vitest'
import { resolveInstallAction, shouldOpenManageOnInstalledTap } from '../src/lib/plugins/install-state.ts'

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

describe('shouldOpenManageOnInstalledTap（P3-6：触屏点“已安装”先进管理）', () => {
  it('触屏点已安装（uninstall 态）→ 进管理，不直接弹卸载确认', () => {
    expect(shouldOpenManageOnInstalledTap('uninstall', true)).toBe(true)
  })

  it('鼠标点已安装（uninstall 态）→ 保持原样，走卸载确认弹窗', () => {
    expect(shouldOpenManageOnInstalledTap('uninstall', false)).toBe(false)
  })

  it('触屏点安装 / 更新不受影响（只拦截 uninstall 态）', () => {
    expect(shouldOpenManageOnInstalledTap('install', true)).toBe(false)
    expect(shouldOpenManageOnInstalledTap('upgrade', true)).toBe(false)
    expect(shouldOpenManageOnInstalledTap('install', false)).toBe(false)
    expect(shouldOpenManageOnInstalledTap('upgrade', false)).toBe(false)
  })
})
