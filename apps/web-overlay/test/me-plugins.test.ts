import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 「插件中心」页守卫（用户中心升级批次）。
 *
 * 用户中心把散落在 /marketplace 的入口收拢，但不重写那边的大页面。
 * 计数取数失败必须显式落 error（可重试），不能让 0 冒充事实。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('/me/plugins 插件中心', () => {
  it('页面与视图存在，复用概览计数', () => {
    expect(existsSync(join(ROOT, 'src/app/me/plugins/page.tsx'))).toBe(true)
    const view = read('src/app/me/plugins/me-plugins-view.tsx')
    expect(view).toContain('useMeOverview')
    expect(view).toContain('id="main-content"')
  })

  it('四个入口指向既有页面（不改 URL、不搬家）', () => {
    const view = read('src/app/me/plugins/me-plugins-view.tsx')
    for (const href of ['/marketplace/installed', '/marketplace/mine', '/marketplace', '/submit', '/custom']) {
      expect(view.includes(`'${href}'`) || view.includes(`"${href}"`), `${href} 入口必须存在`).toBe(true)
    }
  })

  it('失败态显式可重试，且不把失败渲染成 0', () => {
    const view = read('src/app/me/plugins/me-plugins-view.tsx')
    expect(view).toContain('variant="error"')
    expect(view).toContain('onRetry')
    expect(view).toContain('插件数据暂时取不到')
    expect(view).not.toContain('counts?.activePluginInstalls ?? 0')
    expect(view).not.toContain('counts?.authoredPlugins ?? 0')
  })

  it('匿名态说明计数按 0 展示的原因', () => {
    const view = read('src/app/me/plugins/me-plugins-view.tsx')
    expect(view).toContain('当前是匿名身份')
    expect(view).toContain('登录后自动同步')
  })
})
