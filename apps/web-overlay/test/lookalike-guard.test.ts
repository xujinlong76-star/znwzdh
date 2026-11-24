/**
 * 仿冒判定与出站守卫（W4）定向单测。
 *
 * 口径见 src/lib/lookalike-guard.ts：official 只认规范域名、www/裸域变体
 * 与备注确认的官方入口；lookalike 只认品牌 token 在 host 标签里的词界
 * 出现；其余一切（含未确认子域、备注已说明的非仿冒域、拿不准的）判 unknown。
 * 本文件只覆盖 lookalike-guard.ts；vendored 镜像 apps/web/test/** 由
 * vendor 同步步骤生成（见根 vitest.config.ts 的注释）。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyOutboundUrl,
  isOfficialHost,
  type OutboundClassification,
} from '@/lib/lookalike-guard'
import { VERIFIED_BRANDS, type VerifiedBrand } from '@/lib/verified-brands'

function brand(name: string): VerifiedBrand {
  const b = VERIFIED_BRANDS.find((x) => x.name === name)
  if (!b) throw new Error(`test fixture missing brand: ${name}`)
  return b
}

function expectVerdict(
  url: string,
  verdict: OutboundClassification['verdict'],
  brandName: string | null,
  host: string,
) {
  const got = classifyOutboundUrl(url)
  expect(got, url).toEqual({ verdict, brand: brandName ? brand(brandName) : null, host })
}

describe('isOfficialHost：只认规范域名、www/裸域变体与备注确认的官方入口', () => {
  it('规范域名本身是官方', () => {
    expect(isOfficialHost('chatgpt.com', brand('ChatGPT'))).toBe(true)
    expect(isOfficialHost('https://github.com/features/copilot', brand('GitHub'))).toBe(true)
    expect(isOfficialHost('www.12306.cn', brand('铁路12306'))).toBe(true)
    expect(isOfficialHost('leetcode.cn', brand('力扣 LeetCode'))).toBe(true)
  })

  it('www/裸域变体是官方（大小写、端口、尾点归一化后）', () => {
    expect(isOfficialHost('www.python.org', brand('Python'))).toBe(true)
    expect(isOfficialHost('python.org', brand('Python'))).toBe(true)
    expect(isOfficialHost('figma.com', brand('Figma'))).toBe(true)
    expect(isOfficialHost('WWW.FIGMA.COM.', brand('Figma'))).toBe(true)
    expect(isOfficialHost('chatgpt.com:443', brand('ChatGPT'))).toBe(true)
  })

  it('备注确认的官方入口是官方', () => {
    expect(isOfficialHost('chat.deepseek.com', brand('DeepSeek'))).toBe(true)
    expect(isOfficialHost('deepseek.com', brand('DeepSeek'))).toBe(true)
  })

  it('别的品牌、未确认子域、仿冒域都不是官方', () => {
    expect(isOfficialHost('chatgpt.com', brand('DeepSeek'))).toBe(false)
    expect(isOfficialHost('kimi.moonshot.cn', brand('Kimi'))).toBe(false)
    expect(isOfficialHost('api.claude.ai', brand('Claude'))).toBe(false)
    expect(isOfficialHost('chatgpt-login.com', brand('ChatGPT'))).toBe(false)
    expect(isOfficialHost('', brand('ChatGPT'))).toBe(false)
  })
})

describe('classifyOutboundUrl：official', () => {
  it.each([
    ['https://chatgpt.com', 'ChatGPT', 'chatgpt.com'],
    ['https://CHATGPT.COM:443/x', 'ChatGPT', 'chatgpt.com'],
    ['https://chat.deepseek.com', 'DeepSeek', 'chat.deepseek.com'],
    ['https://www.kimi.com', 'Kimi', 'www.kimi.com'],
    ['https://www.doubao.com/work', '豆包', 'www.doubao.com'],
    ['https://gemini.google.com', 'Gemini', 'gemini.google.com'],
    ['https://github.com/features/copilot', 'GitHub', 'github.com'],
    ['https://www.python.org/', 'Python', 'www.python.org'],
    ['https://figma.com', 'Figma', 'figma.com'],
    ['https://www.12306.cn', '铁路12306', 'www.12306.cn'],
    ['https://leetcode.cn', '力扣 LeetCode', 'leetcode.cn'],
    ['https://v.qq.com', '腾讯视频', 'v.qq.com'],
  ] as const)('%s → official %s', (url, name, host) => {
    expectVerdict(url, 'official', name, host)
  })
})

describe('classifyOutboundUrl：lookalike（token 在 host 标签里以词界出现）', () => {
  it.each([
    ['https://chatgpt-login.com', 'ChatGPT', 'chatgpt-login.com'],
    ['https://chatgpt.com.evil.com', 'ChatGPT', 'chatgpt.com.evil.com'],
    ['https://chatgpt.com.cn', 'ChatGPT', 'chatgpt.com.cn'],
    ['https://deepseek-official.com', 'DeepSeek', 'deepseek-official.com'],
    ['https://www-alipay.com', '支付宝', 'www-alipay.com'],
    ['https://alipay-security.cn', '支付宝', 'alipay-security.cn'],
    ['https://kimi.moonshot.cn/', 'Kimi', 'kimi.moonshot.cn'],
    ['https://leetcode.com', '力扣 LeetCode', 'leetcode.com'],
    ['https://doubao-app.com', '豆包', 'doubao-app.com'],
    ['https://qianwen-ai.com', '通义千问', 'qianwen-ai.com'],
  ] as const)('%s → lookalike %s', (url, name, host) => {
    expectVerdict(url, 'lookalike', name, host)
  })
})

describe('classifyOutboundUrl：unknown——零误拦', () => {
  it('未确认的官方子域：同一注册域，不判仿冒', () => {
    expectVerdict('https://api.claude.ai', 'unknown', null, 'api.claude.ai')
    expectVerdict('https://x.chatgpt.com', 'unknown', null, 'x.chatgpt.com')
    expectVerdict('https://oversea.cnki.net', 'unknown', null, 'oversea.cnki.net')
    expectVerdict('https://corporate.jd.com', 'unknown', null, 'corporate.jd.com')
  })

  it('名单备注已说明不是仿冒的域', () => {
    expectVerdict('https://didi.cn', 'unknown', null, 'didi.cn')
    expectVerdict('https://www.rednote.com/login', 'unknown', null, 'www.rednote.com')
    expectVerdict('https://rednote.com', 'unknown', null, 'rednote.com')
  })

  it('GitHub Pages：host 里的 github 是平台本身', () => {
    expectVerdict('https://esbuild.github.io', 'unknown', null, 'esbuild.github.io')
  })

  it('token 藏在字母串中间、短 token、形近拼写都不判仿冒', () => {
    expectVerdict('https://nodebb.org', 'unknown', null, 'nodebb.org')
    expectVerdict('https://qwenwork.cn/', 'unknown', null, 'qwenwork.cn')
    expectVerdict('https://chatgpot.com', 'unknown', null, 'chatgpot.com')
    expectVerdict('https://jd-coupon.example.com', 'unknown', null, 'jd-coupon.example.com')
  })

  it('无关域名', () => {
    expectVerdict('https://example.com', 'unknown', null, 'example.com')
    expectVerdict('https://www.google.com', 'unknown', null, 'www.google.com')
    expectVerdict('https://notebook.google.com', 'unknown', null, 'notebook.google.com')
    expectVerdict('https://baidu.com', 'unknown', null, 'baidu.com')
  })

  it('非 http(s)、相对路径、解析失败', () => {
    expectVerdict('javascript:alert(1)', 'unknown', null, '')
    expectVerdict('ftp://example.com', 'unknown', null, '')
    expectVerdict('/marketplace/chatgpt', 'unknown', null, '')
    expectVerdict('not a url', 'unknown', null, '')
    expectVerdict('', 'unknown', null, '')
  })
})
