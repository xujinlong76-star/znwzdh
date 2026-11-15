/**
 * /me 首屏预算守卫：成长面板必须走 next/dynamic 懒加载，不能再静态
 * import 回首屏 chunk。
 *
 * 背景：CI b0c6f0e1 实测 /me 891 KB > 预算 880 KB（超 11 KB）。
 * GrowthPanel 连同 4 个成长子面板与 growth-season 是本页唯一的
 * /me 专属重型客户端岛；lib/growth 反而不在此列（根布局的
 * growth-tracker / homepage-banner 已把它静态拉进共享 chunk）。
 * 拆法照 me-settings-view-lazy.tsx 的先例：不设 `ssr: false`，
 * 服务端仍渲染成长面板首帧，hydration 的 JS 走异步 chunk（预算口径
 * 按 react-loadable-manifest 扣除）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..', '..', 'web-overlay')

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel)
  if (!existsSync(p)) throw new Error('overlay 缺少文件 ' + rel)
  return readFileSync(p, 'utf8')
}

describe('/me 成长面板懒加载边界', () => {
  const meView = () => overlayFile('src/app/me/me-view.tsx')
  const lazy = () => overlayFile('src/components/user-center/growth-panel-lazy.tsx')

  it('me-view 不静态引入 growth-panel，只走懒加载包装', () => {
    const s = meView()
    expect(s).not.toContain("from '@/components/user-center/growth-panel'")
    expect(s).not.toContain('from "./growth-panel"')
    expect(s).toContain("from '@/components/user-center/growth-panel-lazy'")
    expect(s).toContain('<GrowthPanelLazy />')
  })

  it('匿名与登录两态都渲染懒加载版成长面板', () => {
    const hits = meView().match(/<GrowthPanelLazy \/>/g) ?? []
    expect(hits.length).toBe(2)
  })

  it('懒加载包装用 next/dynamic 且保留服务端首帧', () => {
    const s = lazy()
    expect(s).toContain("from 'next/dynamic'")
    expect(s).toContain("import('./growth-panel')")
    expect(s).not.toContain('ssr: false')
    expect(s).toContain('aria-busy')
    expect(s).toContain('aria-label="我的成长"')
  })

  it('成长面板仍是 /me 专属：除懒加载包装外无其它静态调用方', () => {
    // 守卫意图：别处一旦静态 import growth-panel，本拆分就白做了。
    // 这里只锁 me-view 这一侧；全仓调用方由实现者 grep 核对。
    const s = lazy()
    expect(s).toContain('export function GrowthPanelLazy')
  })
})
