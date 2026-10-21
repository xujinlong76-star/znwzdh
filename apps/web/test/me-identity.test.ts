import { describe, expect, it } from 'vitest'
import { canonicalUserId, isAnonId } from '@/lib/me-identity'

describe('用户中心身份归一', () => {
  it('provider + 原始 id 归一为 provider:id', () => {
    expect(canonicalUserId({ id: '12345', provider: 'github' })).toBe('github:12345')
    expect(canonicalUserId({ id: 'admin', provider: 'credentials' })).toBe('credentials:admin')
  })

  it('已是 canonical 形态时不重复加前缀', () => {
    expect(canonicalUserId({ id: 'github:12345' })).toBe('github:12345')
    expect(canonicalUserId({ id: 'credentials:admin' })).toBe('credentials:admin')
  })

  it('旧会话没有 provider 时有确定回退', () => {
    expect(canonicalUserId({ id: 'admin' })).toBe('credentials:admin')
    expect(canonicalUserId({ id: '999' })).toBe('github:999')
  })

  it('空身份返回 null', () => {
    expect(canonicalUserId(null)).toBeNull()
    expect(canonicalUserId({})).toBeNull()
    expect(canonicalUserId({ id: '   ' })).toBeNull()
  })

  it('anonId 形态校验', () => {
    expect(isAnonId('anon-11111111-1111-1111-1111-111111111111')).toBe(true)
    expect(isAnonId('anon-short')).toBe(false)
    expect(isAnonId('github:123')).toBe(false)
    expect(isAnonId('')).toBe(false)
    expect(isAnonId(null)).toBe(false)
  })
})
