/**
 * 代理侧身份签名的接线与向量一致性（P0-2）。
 *
 * 为什么必须在两侧都测同一个向量：签名对象、编码、截断规则任何一处不一致，
 * 都会表现为「开了密钥之后全是 401」，而单看任一侧的代码都自洽。
 * 这里把 `apps/api/test/identity-signature.test.ts` 的向量抄过来做交叉锁。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  hubIdentitySecret,
  identityFromRequest,
  identitySignatureHeaders,
  signIdentity,
  signIdentityV2,
} from '../src/lib/identity-signature'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const SECRET = 'test-secret-please-rotate'
const VECTOR_ALICE = '8091d0f3cb74f22698ca395cb5d7e16896a2a6d1a18dbd102e1148c18836b7a1'
/** HMAC-SHA256(secret, JSON.stringify(["github:alice", 1700000000, "abcdefghijklmnop"])) */
const VECTOR_V2 = '72364c04ae727e48196f6ef3a48036dca52f0113e1b6f5871ab68fcd71c24a34'

describe('signIdentityV2：时间戳与 nonce 一起进 MAC（重放防护）', () => {
  it('载荷格式与中枢一致：[identity, ts, nonce] 的规范 JSON', async () => {
    expect(await signIdentityV2(SECRET, 'github:alice', 1700000000, 'abcdefghijklmnop')).toBe(VECTOR_V2)
  })

  it('identitySignatureHeaders 下发 v1 + v2 三件套（ts 按秒、nonce 合规）', async () => {
    const h = await identitySignatureHeaders(SECRET, 'github:alice', 'x-navhub-identity', 1_700_000_000_000)
    expect(h['x-navhub-identity-ts']).toBe('1700000000')
    expect(h['x-navhub-identity-nonce']).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    expect(h['x-navhub-identity-signature']).toBe(VECTOR_ALICE)
    expect(h['x-navhub-identity-signature-v2']).toBe(
      await signIdentityV2(SECRET, 'github:alice', 1700000000, h['x-navhub-identity-nonce']),
    )
    expect(h['x-navhub-identity-signature-v2']).not.toBe(h['x-navhub-identity-signature'])
  })

  it('anon 前缀自成一套头，不与登录身份头撞名', async () => {
    const headers = await identitySignatureHeaders(SECRET, 'anon-1', 'x-navhub-anon', 1_700_000_000_000)
    expect(Object.keys(headers).sort()).toEqual([
      'x-navhub-anon-nonce',
      'x-navhub-anon-signature',
      'x-navhub-anon-signature-v2',
      'x-navhub-anon-ts',
    ])
  })

  it('每次调用 nonce 都不同（同一秒内也不复用）', async () => {
    const now = 1_700_000_000_000
    const a = await identitySignatureHeaders(SECRET, 'github:alice', 'x-navhub-identity', now)
    const b = await identitySignatureHeaders(SECRET, 'github:alice', 'x-navhub-identity', now)
    expect(a['x-navhub-identity-nonce']).not.toBe(b['x-navhub-identity-nonce'])
    expect(a['x-navhub-identity-signature-v2']).not.toBe(b['x-navhub-identity-signature-v2'])
  })
})

describe('signIdentity：与中枢共用同一向量', () => {
  it('HMAC-SHA256(secret, github:alice) 与中枢实现逐字节一致', async () => {
    expect(await signIdentity(SECRET, 'github:alice')).toBe(VECTOR_ALICE)
  })

  it('中文身份也稳定（UTF-8 编码，不依赖 btoa）', async () => {
    const a = await signIdentity(SECRET, '匿名·用户')
    const b = await signIdentity(SECRET, '匿名·用户')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('identityFromRequest：优先级与截断必须与中枢 identityOf 一致', () => {
  it('query.userId 优先于 query.anonId', () => {
    expect(identityFromRequest(new URL('https://x/api/a?userId=u1&anonId=a1'))).toBe('u1')
  })

  it('只有 anonId 时取 anonId', () => {
    expect(identityFromRequest(new URL('https://x/api/a?anonId=a1'))).toBe('a1')
  })

  it('query 无身份时回退到 JSON body', () => {
    expect(identityFromRequest(new URL('https://x/api/a'), JSON.stringify({ userId: 'u2' }))).toBe('u2')
    expect(identityFromRequest(new URL('https://x/api/a'), JSON.stringify({ anonId: 'a2' }))).toBe('a2')
  })

  it('非 JSON body / 空 body / 无身份 → null（不签名）', () => {
    expect(identityFromRequest(new URL('https://x/api/a'), '{oops')).toBeNull()
    expect(identityFromRequest(new URL('https://x/api/a'), '')).toBeNull()
    expect(identityFromRequest(new URL('https://x/api/a'), JSON.stringify({ other: 1 }))).toBeNull()
    expect(identityFromRequest(new URL('https://x/api/a'))).toBeNull()
  })

  it('截断到 64 字符（中枢 identityOf 同样 slice(0,64)，不截断就会签名对不上）', () => {
    const long = 'u'.repeat(80)
    expect(identityFromRequest(new URL(`https://x/api/a?userId=${long}`))).toBe('u'.repeat(64))
    expect(identityFromRequest(new URL('https://x/api/a'), JSON.stringify({ userId: long }))).toBe(
      'u'.repeat(64),
    )
  })

  it('header 身份优先于 query/body（与中枢 identityOf 同序）', () => {
    const headers = new Headers({
      'x-navhub-anon-id': 'anon-header',
      'x-navhub-user-id': 'user-header',
    })
    expect(
      identityFromRequest(
        new URL('https://x/api/a?userId=user-query&anonId=anon-query'),
        JSON.stringify({ userId: 'user-body' }),
        headers,
      ),
    ).toBe('user-header')

    expect(
      identityFromRequest(
        new URL('https://x/api/a?anonId=anon-query'),
        undefined,
        new Headers({ 'x-navhub-anon-id': 'anon-header' }),
      ),
    ).toBe('anon-header')

    // 旧版 x-user-id / x-anon-id 也要兼容，且 64 字符截断一致
    expect(identityFromRequest(new URL('https://x/api/a'), undefined, { 'x-user-id': 'legacy' })).toBe('legacy')
    expect(identityFromRequest(new URL('https://x/api/a'), undefined, { 'x-anon-id': 'legacy-anon' })).toBe(
      'legacy-anon',
    )
    expect(
      identityFromRequest(new URL('https://x/api/a'), undefined, new Headers({ 'x-user-id': 'u'.repeat(80) })),
    ).toBe('u'.repeat(64))
  })
})

describe('hubIdentitySecret：未配置时必须完全不影响行为', () => {
  it('未设置 / 空串 → null', () => {
    expect(hubIdentitySecret({})).toBeNull()
    expect(hubIdentitySecret({ NAVHUB_IDENTITY_SECRET: '' })).toBeNull()
  })

  it('设置了就返回密钥', () => {
    expect(hubIdentitySecret({ NAVHUB_IDENTITY_SECRET: SECRET })).toBe(SECRET)
  })
})

describe('接线：代理必须真的把签名加上', () => {
  const src = readFileSync(resolve(ROOT, 'src/app/api/hub/[...path]/route.ts'), 'utf8')

  it('从环境读取密钥，并写身份签名头（v1+v2 双发）', () => {
    expect(src).toContain('hubIdentitySecret()')
    // 2026-10-27：单写 v1 改成 identitySignatureHeaders 双发
    // （v2 = HMAC(secret, [identity, ts, nonce])，中枢据此做重放防护）
    expect(src).toContain('identitySignatureHeaders(identitySecret, resolvedIdentity)')
    expect(src).toContain('Object.assign(headers,')
  })

  it('签名取值走 identityFromRequest 并带入请求头（header-only 身份不能丢）', () => {
    expect(src).toMatch(/identityFromRequest\(url/)
    expect(src).toContain('request.headers')
  })

  it('签名对象必须是「裁决后的身份」而不是客户端自称（签名 ≠ 授权）', () => {
    // 2026-10-22 口径变更：会话优先，客户端自称的非匿名身份一律拒绝。
    // 详细用例见 hub-identity-guard.test.ts。
    expect(src).toContain('resolveHubIdentity(')
    expect(src).toMatch(/identitySignatureHeaders\(identitySecret, resolvedIdentity\)/)
    expect(src).not.toMatch(/identitySignatureHeaders\(identitySecret, identity\)/)
  })
})
