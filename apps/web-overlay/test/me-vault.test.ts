import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 云端金库管理页守卫（第 5 批）。
 *
 * 守住零知识边界（主密码不出本机、不展示密文内容）、删除两步确认，
 * 以及「本来就没有」与「已删除」两个事实不能被合并成一句成功提示。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('/me/vault 云端金库', () => {
  it('页面存在并接入金库读写接口', () => {
    const rel = 'src/app/me/vault/page.tsx'
    expect(existsSync(join(ROOT, rel))).toBe(true)
    const src = read(rel)
    expect(src).toContain('fetchCloudVault')
    expect(src).toContain('deleteCloudVault')
  })

  it('零知识说明：主密码不出本机，服务端只存密文', () => {
    const src = read('src/app/me/vault/page.tsx')
    expect(src).toContain('主密码不离开本机')
    expect(src).toContain('服务端只保存密文')
    // 管理页不允许展示密文内容
    expect(src).not.toContain('vault.payload.slice')
  })

  it('删除是两步确认，且区分「真删」与「本来就没有」', () => {
    const src = read('src/app/me/vault/page.tsx')
    expect(src).toContain('再次点击确认删除')
    expect(src).toContain('outcome.deleted')
    expect(src).toContain('云端本来就没有金库备份')
  })

  it('取数失败走统一错误态并说明不代表被删除', () => {
    const src = read('src/app/me/vault/page.tsx')
    expect(src).toContain("from '@/components/user-center/section-state'")
    expect(src).toContain('variant="error"')
    expect(src).toContain('这不代表金库被删除')
  })
})
