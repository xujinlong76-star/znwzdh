import { describe, expect, it } from 'vitest'
import { shouldTrackUnread, unreadBadgeText } from '../src/lib/notification-badge'

describe('通知角标纯逻辑', () => {
  it('只有已就绪且非匿名的登录身份才请求未读数', () => {
    expect(shouldTrackUnread({ ready: false, identity: 'github:u1', isAnonymous: false })).toBe(false)
    expect(shouldTrackUnread({ ready: true, identity: null, isAnonymous: false })).toBe(false)
    expect(shouldTrackUnread({ ready: true, identity: 'anon-12345678', isAnonymous: true })).toBe(false)
    expect(shouldTrackUnread({ ready: true, identity: 'github:u1', isAnonymous: false })).toBe(true)
  })

  it('0 与非法值不显示，超过 9 显示 9+ 且 aria 仍用真实数量', () => {
    expect(unreadBadgeText(0)).toBeNull()
    expect(unreadBadgeText(Number.NaN)).toBeNull()
    expect(unreadBadgeText(-2)).toBeNull()
    expect(unreadBadgeText(9)).toBe('9')
    expect(unreadBadgeText(10)).toBe('9+')
    expect(unreadBadgeText(1234)).toBe('9+')
  })
})
