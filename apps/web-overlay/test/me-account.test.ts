import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 「账号与身份」页守卫（用户中心升级批次）。
 *
 * 资料编辑、云端自检与数据删除入口都必须还在；匿名态只给登录 CTA，
 * 不能渲染资料表单（否则等于宣称匿名用户也能改云端资料）。
 */
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
    expect(view).toContain('当前是匿名身份')
    expect(view).toContain('/auth/signin?callbackUrl=/me/account')
    expect(view).toMatch(/state === 'anonymous'/)
  })

  it('危险区指向数据与隐私页', () => {
    const view = read('src/app/me/account/account-view.tsx')
    expect(view).toContain('href="/me/data"')
  })
})
