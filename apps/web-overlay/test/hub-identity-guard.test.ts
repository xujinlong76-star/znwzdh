import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  encodeAnonCookie,
  isAnonIdentity,
  parseAnonCookie,
  resolveHubIdentity,
} from '../src/lib/hub-identity-guard'

/**
 * /api/hub/* 身份裁决的单元测试。
 *
 * 守护的核心命题：**签名 ≠ 授权**。代理必须把「会话派生身份」当作唯一可信来源，
 * 客户端自报的非匿名身份一律拒绝；否则改一个 anonId 参数就能读写他人数据。
 */

const ROOT = resolve(__dirname, '..')

describe('resolveHubIdentity：会话优先', () => {
  it('有会话时忽略客户端自称的任意身份（anon 与 github 都不例外）', () => {
    expect(
      resolveHubIdentity({ sessionIdentity: 'github:42', claimedIdentity: 'anon-aaaaaaaa-1111' }),
    ).toEqual({ kind: 'session', identity: 'github:42' })
    expect(
      resolveHubIdentity({ sessionIdentity: 'github:42', claimedIdentity: 'github:999' }),
    ).toEqual({ kind: 'session', identity: 'github:42' })
  })

  it('会话身份为空串时按无会话处理', () => {
    expect(resolveHubIdentity({ sessionIdentity: '  ', claimedIdentity: 'anon-bbbbbbbb-2222' })).toEqual({
      kind: 'anon',
      identity: 'anon-bbbbbbbb-2222',
    })
  })
})

describe('resolveHubIdentity：匿名域与拒绝', () => {
  it('无会话 + anon 前缀 → 允许（凭据即 localStorage 内的随机 UUID）', () => {
    expect(resolveHubIdentity({ claimedIdentity: 'anon-9f8e7d6c-5b4a-3210-fedc-ba9876543210' })).toEqual({
      kind: 'anon',
      identity: 'anon-9f8e7d6c-5b4a-3210-fedc-ba9876543210',
    })
  })

  it('无会话 + 非匿名自称（github:victim）→ 拒绝', () => {
    expect(resolveHubIdentity({ claimedIdentity: 'github:123456' })).toEqual({
      kind: 'rejected',
      claimed: 'github:123456',
    })
    expect(resolveHubIdentity({ claimedIdentity: 'admin' }).kind).toBe('rejected')
  })

  it('无任何自称 → 匿名（中枢回退默认匿名身份）', () => {
    expect(resolveHubIdentity({ claimedIdentity: '' })).toEqual({ kind: 'anonymous' })
    expect(resolveHubIdentity({})).toEqual({ kind: 'anonymous' })
  })
})

describe('isAnonIdentity 边界', () => {
  it('接受合法 UUID 形态，拒绝过短/带点/空值', () => {
    expect(isAnonIdentity('anon-12345678')).toBe(true)
    expect(isAnonIdentity('anon-abc')).toBe(false) // 太短
    expect(isAnonIdentity('anon-abc.def')).toBe(false) // cookie 分隔符不进身份
    expect(isAnonIdentity('anon-')).toBe(false)
    expect(isAnonIdentity('github:1')).toBe(false)
    expect(isAnonIdentity(null)).toBe(false)
  })
})

describe('匿名绑定 cookie 编解码', () => {
  const mac = 'a'.repeat(64)
  const anonId = 'anon-9f8e7d6c-5b4a-3210-fedc-ba9876543210'

  it('roundtrip 保持 anonId 与 mac', () => {
    const parsed = parseAnonCookie(encodeAnonCookie(anonId, mac))
    expect(parsed).toEqual({ anonId, mac })
  })

  it('拒绝畸形值（无点/空 mac/非法 anonId/短 mac）', () => {
    expect(parseAnonCookie(null)).toBeNull()
    expect(parseAnonCookie('')).toBeNull()
    expect(parseAnonCookie(anonId)).toBeNull()
    expect(parseAnonCookie(anonId + '.')).toBeNull()
    expect(parseAnonCookie('github:1.' + mac)).toBeNull()
    expect(parseAnonCookie(anonId + '.abc')).toBeNull()
  })
})

describe('源码守卫：代理与 BFF 真的用了裁决器', () => {
  it('/api/hub 代理：会话优先、拒绝非匿名自称、剥离客户端身份头', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/api/hub/[...path]/route.ts'), 'utf8')
    expect(src).toContain('resolveHubIdentity(')
    expect(src).toContain('identityFromRequest(url')
    expect(src).toContain("verdict.kind === 'rejected'")
    expect(src).toContain("headers['x-navhub-user-id'] = verdict.identity")
    expect(src).toContain("delete headers['x-navhub-anon-id']")
    // 匿名请求必须写绑定 cookie（共享设备防串号）
    expect(src).toContain('encodeAnonCookie(')
    expect(src).toContain('set-cookie')
  })

  it('/api/me BFF：合并前校验匿名绑定 cookie，不一致即 401', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/api/me/[[...path]]/route.ts'), 'utf8')
    expect(src).toContain('parseAnonCookie(')
    expect(src).toContain('匿名身份与当前浏览器不一致')
    expect(src).toContain('pendingAnonCookie')
    expect(src).toContain('ANON_COOKIE')
  })
})
