import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 「设置」页守卫（用户中心升级批次）。
 *
 * 守住三件事：
 *   1. 设置从 `/me` 独立成页，且导航可直达；
 *   2. 保存逻辑仍走 `PATCH /api/me/settings` + `verifySettingsConsistency`；
 *   3. 匿名态写本机、登录态写云端，失败态提供重试（失败不渲染成「默认值」）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('/me/settings 设置页', () => {
  it('页面、客户端岛与设置钩子都存在', () => {
    for (const rel of [
      'src/app/me/settings/page.tsx',
      'src/components/user-center/me-settings-view.tsx',
      'src/components/user-center/settings-panel.tsx',
      'src/hooks/use-me-settings.ts',
    ]) {
      expect(existsSync(join(ROOT, rel)), `${rel} 必须存在`).toBe(true)
    }
  })

  it('保存走 PATCH /api/me/settings 并做一致性回读', () => {
    const hook = read('src/hooks/use-me-settings.ts')
    expect(hook).toContain("'/api/me/settings'")
    expect(hook).toContain("method: 'PATCH'")
    expect(hook).toContain('verifySettingsConsistency')
    expect(hook).toContain('readLocalUserSettings')
    expect(hook).toContain('writeLocalUserSettings')
  })

  it('匿名与登录分开落盘：匿名写本机，登录才写云端', () => {
    const hook = read('src/hooks/use-me-settings.ts')
    expect(hook).toContain("state === 'ready'")
    expect(hook).toContain("setState('anonymous')")
    expect(hook).toContain('setState(\'error\')')
    const view = read('src/components/user-center/me-settings-view.tsx')
    expect(view).toContain('当前为本机匿名身份')
    expect(view).toContain('重试')
  })

  it('导航包含设置入口', () => {
    const nav = read('src/components/user-center/user-center-nav.tsx')
    expect(nav).toContain("'/me/settings'")
  })
})
