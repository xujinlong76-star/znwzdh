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

describe('safeFetch 五道防线', () => {
  /**
   * 2026-11-21 架构变更：web 层从「第二份完整实现」收口为 packages/ai 的
   * 薄壳 re-export。原测试对两侧都做同一组字面量断言（因为当时是两份代码，
   * 怕漂移）；现在只有一处实现，断言相应改为：
   *   - 权威层：五道防线的符号必须都在；
   *   - web 层：必须是转发而非自带第二份实现。
   * 后者比原来的双份比对更强——双份写错时原断言会通过，收口断言不会。
   */
  it('权威层: 连接级 IP 钉扎（lookup 回调）', () => {
    expect(AI).toContain('pinnedLookup')
    expect(AI).toContain('lookup: pinnedLookup')
    expect(AI).toContain('servername:')
  })
  it('权威层: 协议/端口/凭据 + DNS 后 IP 黑名单', () => {
    expect(AI).toContain('assertUrlShape')
    expect(AI).toContain('resolveAndCheck')
    expect(AI).toContain('::ffff:')
  })
  it('权威层: 严格域名白名单 + 受控重定向 + 超时体积', () => {
    expect(AI).toContain('allowedHosts')
    expect(AI).toContain('isHostAllowed')
    expect(AI).toMatch(/redirect:\s*['"]manual['"]/)
    expect(AI).toContain('maxBytes')
    expect(AI).toContain('maxRedirects')
  })
  it('web 层: 独立实现（依赖边界禁止 @navhub/*），行为由 parity 测试守', () => {
    /*
     * 2026-11-22 订正：原断言要求 web 层 re-export 权威层，但
     * scripts/check-import-boundaries.mjs 明确禁止 overlay 依赖 @navhub/*
     *（理由：vendored 底座生产镜像只含 overlay，不含 workspace 包）。
     * 因此 web 层必须是独立实现，两侧行为一致性由 ssrf-parity.test.ts
     * 与 ssrf-ports-drift.test.ts 守——这才是符合架构约束的形态。
     */
    expect(WEB).not.toContain("from '@navhub/ai")
    expect(WEB).toContain('export async function safeFetch')
    expect(WEB).toContain('export function isHostAllowed')
    expect(WEB).toContain('::ffff:')
  })
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
    expect(route).toContain('SAFE_DATA_IMAGE_HEADER_RE')
  })

  it('website-metadata 路由出站全部收口到 safeFetch / guardedFetch 并拒绝 SVG 上传', () => {
    const route = readRepo('apps/web-overlay/src/app/api/website-metadata/route.ts')
    expect(route).not.toMatch(/await fetch\(/)
    expect(route).toContain("allowedHosts: ['api.bilibili.com']")
    expect(route).toContain("allowedHosts: ['www.google.com']")
    expect(route).toContain("allowedHosts: ['api.github.com']")
    expect(route).toContain('SAFE_BITMAP_EXTENSIONS')
    expect(route).toContain('isSafeBitmapPayload')
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
