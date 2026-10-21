import { describe, expect, it } from 'vitest'
import { originFromHeaders } from '../src/lib/seo/origin'

/**
 * canonical / sitemap / OG 的 origin 只能来自可信格式的 Host 头。
 *
 * 旧实现直接拼接 `proto://host`，攻击者可以用 `Host: evil.com/x` 或
 * `Host: user@evil.com` 把整站 canonical 指到外部；这里守住格式收敛边界。
 */
describe('originFromHeaders', () => {
  it('接受普通 host，并默认 https', () => {
    expect(originFromHeaders('navhub.example.com', null)).toBe('https://navhub.example.com')
  })

  it('保留合法端口，只认 http/https 协议', () => {
    expect(originFromHeaders('localhost:3000', 'http')).toBe('http://localhost:3000')
    expect(originFromHeaders('navhub.example.com:8443', 'ftp')).toBe('https://navhub.example.com:8443')
  })

  it('x-forwarded-host 多值取第一个', () => {
    expect(originFromHeaders('navhub.example.com, proxy.internal', 'https')).toBe('https://navhub.example.com')
  })

  it.each([
    ['带路径', 'evil.example.com/path'],
    ['带查询', 'evil.example.com?x=1'],
    ['带 userinfo', 'user@evil.example.com'],
    ['带空白', 'evil.example.com '],
    ['带反斜杠', 'evil.example.com\\path'],
    ['空值', ''],
  ])('拒绝%s的 Host', (_label, host) => {
    expect(originFromHeaders(host, 'https')).toBeNull()
  })
})
