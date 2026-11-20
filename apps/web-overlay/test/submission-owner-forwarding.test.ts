/**
 * 投稿归属链守卫：匿名投稿必须能进收录反馈页。
 *
 * 链路：浏览器带 X-Navhub-Anon-Id → Next /api/submissions BFF 校验 anon- 前缀
 * → 服务端签名后转发中枢 → POST /api/submissions 写 submission_owners →
 * GET /api/submissions/feedback 按同一身份返回。此前 BFF 只转发会话身份，
 * 匿名投稿全成无主数据，反馈页对主力用户（未登录投稿者）恒为空。
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

const route = overlaySource('src/app/api/submissions/route.ts')

describe('投稿归属链：匿名身份转发', () => {
  it('只接受 anon-* 自报身份，拒绝客户端自称登录账号', () => {
    const guard = route.slice(route.indexOf('function claimedAnonIdentity'), route.indexOf('async function submitToHub'))
    expect(guard).toContain("request.headers.get('x-navhub-anon-id')")
    expect(guard).toContain("request.headers.get('x-anon-id')")
    expect(guard).toContain("identity.startsWith('anon-')")
    // 不允许把任意声称身份直接写进归属链
    expect(guard).not.toContain('return raw.trim()')
  })

  it('会话优先、匿名兜底：两种身份分别用正确的头并签名转发', () => {
    const forward = route.slice(route.indexOf('const session = await auth()'), route.indexOf("fetch(HUB_BASE + '/api/submissions'"))
    expect(forward).toContain('const sessionIdentity = canonicalUserId(session?.user)')
    expect(forward).toContain('sessionIdentity ?? claimedAnonIdentity(request)')
    expect(forward).toContain("if (sessionIdentity) headers['x-navhub-user-id'] = signedIdentity")
    expect(forward).toContain("else headers['x-navhub-anon-id'] = signedIdentity")
    expect(forward).toContain('identitySignatureHeaders(secret, signedIdentity)')
  })

  it('无签名密钥时仍不借用管理凭据或伪造身份', () => {
    expect(route).toContain('if (identity && secret)')
    expect(route).not.toContain("headers['x-navhub-user-id'] = 'anonymous'")
  })
})
