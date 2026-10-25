import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 工作空间管理页守卫（第 5 批）。
 *
 * 守住：完整成员管理接线、RBAC 权限来源、最后一个 owner 保护、统一状态组件。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('/me/workspaces 工作空间', () => {
  it('页面存在并接入完整管理能力', () => {
    const rel = 'src/app/me/workspaces/page.tsx'
    expect(existsSync(join(ROOT, rel))).toBe(true)
    const src = read(rel)
    for (const fn of [
      'fetchWorkspaces',
      'createWorkspace',
      'fetchWorkspaceMembers',
      'addWorkspaceMember',
      'removeWorkspaceMember',
    ]) {
      expect(src, `缺少 ${fn} 接线`).toContain(fn)
    }
  })

  it('成员入口按服务端 RBAC 结果渲染', () => {
    const src = read('src/app/me/workspaces/page.tsx')
    expect(src).toContain('permissions.canManageMembers')
    expect(src).toContain('canManage')
  })

  it('最后一个所有者不可移除（与主流产品一致）', () => {
    const src = read('src/app/me/workspaces/page.tsx')
    expect(src).toContain('不能移除最后一个所有者')
    expect(src).toMatch(/ownerCount <= 1/)
  })

  it('失败与空态走统一状态组件，不谎称「没有空间」', () => {
    const src = read('src/app/me/workspaces/page.tsx')
    expect(src).toContain("from '@/components/user-center/section-state'")
    expect(src).toContain('variant="error"')
    expect(src).toContain('variant="empty"')
    expect(src).toContain('工作空间暂时取不到')
  })
})
