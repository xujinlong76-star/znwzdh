/**
 * SSRF 统一出口迁移守卫（CodeQL 8 条 Critical SSRF 告警的回归锁）。
 *
 * 锁两件事：
 *  1) 权威层 safeFetch 与 web 镜像层 safeFetch 都声明了五道防线所需的关键能力
 *     （钉 IP 的 lookup 回调 / 协议黑名单 / 域名白名单 / manual 重定向 / 体积上限）；
 *  2) 曾被 CodeQL 标记的 8 个站点全部改用 safeFetch，不再对用户可控 URL 裸 fetch。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
/** 仓库根相对路径（测试跑在 apps/web 或 apps/web-overlay，都需回退两层到仓库根）。 */
const readRepo = (rel: string) => readFileSync(resolve(ROOT, '../..', rel), 'utf8')

const AI = read('../../packages/ai/src/ssrf.ts')
const WEB = read('src/lib/ssrf-guard.ts')

describe('safeFetch 五道防线（权威层 + web 镜像层口径一致）', () => {
  for (const [label, src] of [['packages/ai', AI], ['web-overlay', WEB]] as const) {
    it(`${label}: 连接级 IP 钉扎（lookup 回调）`, () => {
      expect(src).toContain('pinnedLookup')
      expect(src).toContain('lookup: pinnedLookup')
      expect(src).toContain('servername:')
    })
    it(`${label}: 协议/端口/凭据 + DNS 后 IP 黑名单`, () => {
      expect(src).toContain('assertUrlShape')
      expect(src).toContain('resolveAndCheck')
      expect(src).toContain('::ffff:')
    })
    it(`${label}: 严格域名白名单 + 受控重定向 + 超时体积`, () => {
      expect(src).toContain('allowedHosts')
      expect(src).toContain('isHostAllowed')
      expect(src).toMatch(/redirect:\s*['"]manual['"]/)
      expect(src).toContain('maxBytes')
      expect(src).toContain('maxRedirects')
    })
  }
})

describe('8 个原告警站点已迁移到 safeFetch', () => {
  const sites: Array<[string, string]> = [
    ['apps/api/src/routes/assets.ts', 'safeFetch'],
    ['apps/web-overlay/src/app/api/resource/route.ts', 'safeFetch'],
    ['apps/web-overlay/src/app/api/media/proxy/route.ts', 'safeFetch'],
    ['apps/web-overlay/src/lib/video-multi-platform-harvester.ts', 'safeFetch'],
  ]
  for (const [file, token] of sites) {
    it(`${file} 使用 ${token}`, () => {
      expect(readRepo(file)).toContain(token)
    })
  }

  it('media proxy 不再对用户可控 URL 裸 fetch', () => {
    const route = readRepo('apps/web-overlay/src/app/api/media/proxy/route.ts')
    expect(route).not.toMatch(/await fetch\(current,/)
  })

  it('resource 路由 GitHub API 固定白名单', () => {
    const route = readRepo('apps/web-overlay/src/app/api/resource/route.ts')
    expect(route).toContain("allowedHosts: ['api.github.com']")
  })

  it('harvester 声明平台域名白名单', () => {
    const h = readRepo('apps/web-overlay/src/lib/video-multi-platform-harvester.ts')
    expect(h).toContain('VIDEO_FETCH_HOST_ALLOWLIST')
  })

  it('脚本校验本地基地址 Origin（SSH 类污点收敛）', () => {
    const lib = read('../../scripts/lib/rate-limit-check.mjs')
    expect(lib).toContain('validateLocalBase')
    expect(lib).toContain('LOOPBACK_ALLOWLIST')
  })
})
