/**
 * 身份就绪（方案 v2 N1）与三个已交付能力的接线（N3）。
 *
 * 这组守卫锁的是「时序」而不是样式：页面不能再在挂载时读一次 localStorage
 * 就下结论——首次登录直接落在 /favorites 或 /me/history 时，SessionSync 可能
 * 还没把 userId 写入，页面会整页按匿名渲染且永不重试。
 *
 * P1-1 分层：这里断言的是 hook 接线与事件订阅（node 环境无法渲染 Next 页面，
 * 删掉这些 import/调用就没有任何测试能挡住）；渲染结果由 `e2e/user-center.spec.ts`
 * 与共享态/存储测试覆盖。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('身份就绪：事件是唯一信号', () => {
  it('useIdentityReady 订阅三种身份事件并带 3 秒兜底', () => {
    const hook = overlaySource('src/hooks/useIdentityReady.ts')
    for (const event of [
      'navhub_identity_ready',
      'navhub_identity_changed',
      'navhub_identity_merged',
      'storage',
    ]) {
      expect(hook).toContain(event)
    }
    expect(hook).toContain('3000')
    // 兜底必须有：事件丢失时页面不能无限等待
    expect(hook).toContain('setTimeout')
  })

  it('SessionSync 在所有路径（登录 / 匿名 / 失败）广播一次 ready', () => {
    const sync = overlaySource('src/components/user-center/session-sync.tsx')
    expect(sync).toContain('navhub_identity_ready')
    // finally 保证网络失败也解锁页面
    expect(sync).toMatch(/finally\s*\{[\s\S]*announceReady\(\)/)
    // 只广播一次：重复 ready 会让页面反复重置
    expect(sync).toContain('announced')
  })

  it('/favorites 的同步依赖身份就绪，而不是挂载时读一次', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    expect(page).toContain('useIdentityReady()')
    expect(page).toContain('identityReady.ready')
    expect(page).toContain('identityReady.identity')
    // 旧的「挂载读一次 getIdentity」不能再出现在同步 effect 里
    expect(page).not.toMatch(/const identity = getIdentity\(\)/)
  })

  it('/me/history 在身份变化后自动重取', () => {
    const page = overlaySource('src/app/me/history/page.tsx')
    expect(page).toContain('useIdentityReady()')
    expect(page).toContain('load(identityReady.identity')
    expect(page).toMatch(/identityReady\.ready[\s\S]*identityReady\.identity/)
  })
})

describe('三个已交付能力在 UI 上可达（N3）', () => {
  it('/me 概览展示最近操作，失败静默', () => {
    const page = overlaySource('src/app/me/me-view.tsx')
    expect(page).toContain('/api/me/activity?limit=10')
    expect(page).toContain('最近操作')
    // 辅助信息失败不弹错误条：只看取数块本身，不扫整个文件（页面其它位置有 setError）
    const at = page.indexOf('/api/me/activity')
    const block = page.slice(at, at + 700)
    expect(block).not.toContain('setError(')
  })

  it('/me/data 提供书签 HTML 导出入口', () => {
    const page = overlaySource('src/app/me/data/page.tsx')
    expect(page).toContain('/api/me/export/bookmarks.html')
    expect(page).toContain('Chrome / Firefox / Safari / Edge')
  })

  it('/favorites 提供两步确认的清空云端入口', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    expect(page).toContain('clearCloudFavorites(cloudIdentity)')
    expect(page).toContain('confirmClearCloud')
    // 清云端必须连本地缓存一起清，否则下次同步会把旧数据推回去
    expect(page).toMatch(/clearCloudFavorites\(cloudIdentity\)[\s\S]{0,400}favorites\.clear\(\)/)
  })
})
