/**
 * 管理后台侧栏品牌 logo 的消费守卫。
 *
 * 背景：前台、manifest、后台 favicon 早已跟随站点设置，但侧栏三处 logo 仍写死
 * 上游的 /assets/images/alogo.webp。管理员换了品牌图后，后台看起来像「设置没生效」，
 * 而且这类写死不会让任何行为测试报错——只能用结构断言锁住。
 *
 * 为什么用源码守卫：vitest 跑在 node 环境，无法渲染需要 next-auth 会话的 RSC 布局；
 * 这里锁「服务端按设置取值 + 客户端只用传入值」的接线形态。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('管理后台品牌 logo 消费', () => {
  const layout = read('src/app/admin/layout.tsx')
  const client = read('src/app/admin/AdminLayoutClient.tsx')

  it('服务端布局从站点设置读 logo，并保留内置图回退', () => {
    expect(layout).toContain('readSiteSettings()')
    expect(layout).toMatch(/brandLogo=\{settings\.appearance\.logo \|\| '\/assets\/images\/alogo\.webp'\}/)
  })

  it('侧栏三处 logo 都用 brandLogo，不再写死上游图', () => {
    expect(client).not.toContain('/assets/images/alogo.webp')
    expect(client.match(/src=\{brandLogo\}/g)?.length).toBe(3)
  })
})
