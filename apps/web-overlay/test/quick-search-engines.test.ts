/**
 * 快捷搜索引擎层（quick-search-engines.ts）的纯函数测试。
 *
 * 重点锁三件事：
 * 1. 新增的百度 / 搜狗 / 知乎拼出来的地址就是各家真实的搜索地址，查询词正确编码；
 * 2. 自定义模板的校验够严：javascript:、http、带 userinfo、缺 %s 一律不通过；
 * 3. 本机选择（stored）优先于卡片配置（configured），脏数据（包括 'constructor'
 *    这类原型链键）永远不会被当成合法引擎。
 */
import { describe, expect, it } from 'vitest'

import {
  BUILTIN_SEARCH_ENGINES,
  buildCustomEngineUrl,
  isValidCustomEngineTemplate,
  parseCustomEngine,
  resolveSelectedEngineId,
} from '../src/lib/quick-search-engines'

describe('内置引擎：地址拼得对，查询词编得对', () => {
  it('八个引擎都在，通用搜索在前、开发类在后', () => {
    expect(Object.keys(BUILTIN_SEARCH_ENGINES)).toEqual([
      'google',
      'baidu',
      'bing',
      'sogou',
      'zhihu',
      'github',
      'npm',
      'mdn',
    ])
  })

  it('百度 / 搜狗 / 知乎是各家真实的搜索地址', () => {
    expect(BUILTIN_SEARCH_ENGINES.baidu.buildUrl('红果短剧')).toBe(
      'https://www.baidu.com/s?wd=%E7%BA%A2%E6%9E%9C%E7%9F%AD%E5%89%A7',
    )
    expect(BUILTIN_SEARCH_ENGINES.sogou.buildUrl('微信文章')).toBe(
      'https://www.sogou.com/web?query=%E5%BE%AE%E4%BF%A1%E6%96%87%E7%AB%A0',
    )
    expect(BUILTIN_SEARCH_ENGINES.zhihu.buildUrl('国考')).toBe(
      'https://www.zhihu.com/search?type=content&q=%E5%9B%BD%E8%80%83',
    )
  })

  it('原有五个引擎的地址没变，查询词里的 & 与空格都被编码', () => {
    expect(BUILTIN_SEARCH_ENGINES.google.buildUrl('a & b')).toBe(
      'https://www.google.com/search?q=a%20%26%20b',
    )
    expect(BUILTIN_SEARCH_ENGINES.github.buildUrl('navhub')).toBe(
      'https://github.com/search?q=navhub',
    )
    expect(BUILTIN_SEARCH_ENGINES.mdn.buildUrl('fetch')).toBe(
      'https://developer.mozilla.org/zh-CN/search?q=fetch',
    )
  })
})

describe('自定义模板校验：只放 https + %s', () => {
  it('含 %s 的 https 模板通过', () => {
    expect(isValidCustomEngineTemplate('https://example.com/search?q=%s')).toBe(true)
    expect(isValidCustomEngineTemplate('  https://weixin.sogou.com/weixin?type=2&query=%s  ')).toBe(true)
  })

  it('缺 %s、http、伪协议、带 userinfo 一律不通过', () => {
    expect(isValidCustomEngineTemplate('https://example.com/search?q=test')).toBe(false)
    expect(isValidCustomEngineTemplate('http://example.com/search?q=%s')).toBe(false)
    expect(isValidCustomEngineTemplate('javascript:alert(%s)')).toBe(false)
    expect(isValidCustomEngineTemplate('data:text/html,%s')).toBe(false)
    expect(isValidCustomEngineTemplate('https://navhub.example@evil.example/?q=%s')).toBe(false)
    expect(isValidCustomEngineTemplate('https://example.com/se\tarch?q=%s')).toBe(false)
  })
})

describe('自定义引擎解析：脏数据当不存在', () => {
  it('合法 JSON 解析出来，名字与模板去空白', () => {
    expect(
      parseCustomEngine(JSON.stringify({ name: ' 微信文章 ', template: 'https://example.com/?q=%s ' })),
    ).toEqual({ name: '微信文章', template: 'https://example.com/?q=%s' })
  })

  it('坏 JSON、缺字段、名字超长、模板不合法都返回 null', () => {
    expect(parseCustomEngine(null)).toBe(null)
    expect(parseCustomEngine('')).toBe(null)
    expect(parseCustomEngine('{不是 json')).toBe(null)
    expect(parseCustomEngine(JSON.stringify({ name: 'x' }))).toBe(null)
    expect(parseCustomEngine(JSON.stringify({ template: 'https://example.com/?q=%s' }))).toBe(null)
    expect(parseCustomEngine(JSON.stringify({ name: '一二三四五六七八九十十一二三', template: 'https://example.com/?q=%s' }))).toBe(null)
    expect(parseCustomEngine(JSON.stringify({ name: 'x', template: 'http://example.com/?q=%s' }))).toBe(null)
  })

  it('模板里的 %s 出现几次就替换几次，查询词编码后填入', () => {
    expect(buildCustomEngineUrl('https://example.com/?q=%s&from=%s', 'a & b')).toBe(
      'https://example.com/?q=a%20%26%20b&from=a%20%26%20b',
    )
  })
})

describe('选中引擎解析：本机选择优先，脏数据不算数', () => {
  it('本机存的合法引擎优先于卡片配置', () => {
    expect(
      resolveSelectedEngineId({ stored: 'baidu', configured: 'google', hasCustom: false }),
    ).toBe('baidu')
  })

  it("stored 是 'custom' 只有自定义真实存在时才算数", () => {
    expect(
      resolveSelectedEngineId({ stored: 'custom', configured: 'google', hasCustom: true }),
    ).toBe('custom')
    expect(
      resolveSelectedEngineId({ stored: 'custom', configured: 'baidu', hasCustom: false }),
    ).toBe('baidu')
  })

  it("原型链键与未知 id 不被当成引擎，配置也未知时回 Google", () => {
    expect(
      resolveSelectedEngineId({ stored: 'constructor', configured: 'google', hasCustom: false }),
    ).toBe('google')
    expect(
      resolveSelectedEngineId({ stored: 'nope', configured: 'alsono', hasCustom: false }),
    ).toBe('google')
    expect(
      resolveSelectedEngineId({ stored: null, configured: 'zhihu', hasCustom: false }),
    ).toBe('zhihu')
  })
})
