import { describe, expect, it } from 'vitest'
import { isAllowedHost } from '../src/lib/safe-url'

/**
 * URL 子字符串误判回归（CodeQL #140 / #128 / #129 / #130）。
 *
 * 背景：多处曾用 `url.includes('github.com')` / `indexOf` / 宽松正则判断
 * 「这个 URL 是否指向某个允许的站点」。子串匹配可被两类输入绕过：
 *
 *   https://evil.com/?github.com     —— 子串出现在 query 里
 *   https://github.com.evil.com/     —— 子串出现在真正的域名前面
 *
 * 两者都能让攻击者冒充目标站点（拿它的图标自愈逻辑、白名单豁免、SEO 判断）。
 * isAllowedHost 用标准 URL 解析 + hostname 严格比对（含子域）来消除这个面。
 */
describe('isAllowedHost', () => {
  describe('拒绝子串绕过', () => {
    const attacks = [
      'https://evil.com/?github.com',
      'https://evil.com/?cursor.com',
      'https://evil.com#github.com',
      'https://github.com.evil.com/',
      'https://notgithub.com/',
      'https://evil.com/github.com/path',
      'https://evil.com/?google.com/s2/favicons',
    ]
    for (const url of attacks) {
      it(`拒绝 ${url}`, () => {
        expect(isAllowedHost(url, ['github.com', 'cursor.com', 'google.com'])).toBe(false)
      })
    }
  })

  describe('放行合法目标', () => {
    it('精确域名', () => {
      expect(isAllowedHost('https://github.com/RooVetGit', ['github.com'])).toBe(true)
    })
    it('子域', () => {
      expect(isAllowedHost('https://api.github.com/repos', ['github.com'])).toBe(true)
      expect(isAllowedHost('https://www.youtube.com/watch', ['youtube.com'])).toBe(true)
    })
    it('带端口与路径', () => {
      expect(isAllowedHost('https://github.com:443/x/y', ['github.com'])).toBe(true)
    })
    it('末尾点归一（WHATWG 保留 host 末尾点）', () => {
      expect(isAllowedHost('https://github.com./x', ['github.com'])).toBe(true)
    })
    it('大小写不敏感', () => {
      expect(isAllowedHost('HTTPS://GITHUB.COM/x', ['github.com'])).toBe(true)
    })
  })

  describe('协议限制', () => {
    for (const url of ['ftp://github.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x']) {
      it(`拒绝非 http(s) 协议: ${url}`, () => {
        expect(isAllowedHost(url, ['github.com'])).toBe(false)
      })
    }
    it('放行 http 与 https', () => {
      expect(isAllowedHost('http://github.com/', ['github.com'])).toBe(true)
      expect(isAllowedHost('https://github.com/', ['github.com'])).toBe(true)
    })
  })

  describe('边界输入', () => {
    it('空串 / 非字符串 / 非法 URL 一律拒绝', () => {
      expect(isAllowedHost('', ['github.com'])).toBe(false)
      expect(isAllowedHost('   ', ['github.com'])).toBe(false)
      expect(isAllowedHost('not a url', ['github.com'])).toBe(false)
      expect(isAllowedHost(null as unknown as string, ['github.com'])).toBe(false)
    })
    it('空白名单拒绝一切', () => {
      expect(isAllowedHost('https://github.com/', [])).toBe(false)
    })
  })
})
