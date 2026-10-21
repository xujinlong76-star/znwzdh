import { describe, expect, it } from 'vitest'
import { isBlockedIp as coreBlockedIp } from '../../../packages/ai/src/ssrf'
import { isBlockedIp as webBlockedIp } from '../src/lib/ssrf-guard'

/**
 * SSRF 防护有两份运行时副本（packages/ai 与 apps/web）。
 * 两份实现可以结构不同，但「哪些地址必须拦」不能漂移。
 */
const IPS = [
  '0.0.0.0',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.1.1',
  '192.0.0.1',
  '192.0.1.1',
  '192.0.2.1',
  '192.88.99.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '8.8.8.8',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::127.0.0.1',
  '64:ff9b::7f00:1',
  '2002:7f00:1::',
  '2001:0000::1',
  '2001:db8::1',
  'fe80::1',
  'fc00::1',
  'ff00::1',
  '100::1',
  '2606:4700::1111',
]

describe('SSRF 双副本行为一致', () => {
  it.each(IPS)('%s 的拦截结论一致', (ip) => {
    expect(webBlockedIp(ip)).toBe(coreBlockedIp(ip))
  })
})
