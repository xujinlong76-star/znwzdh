/**
 * stripHtmlTags：单遍状态机剥标签（CodeQL #138/#139「不完整的多字符清理」）。
 *
 * 旧实现是单次正则 `.replace(/<[^>]+>/g, '')`，两处硬伤：
 * 1. 引号盲区：`<a title="x>y">正文</a>` 在属性内的 `>` 处提前截断；
 * 2. 拼接复活：嵌套标签删一次后残片可能拼成新的标签形子串。
 * 以下用例逐个对应这两处，并覆盖纯文本小于号与未闭合标签的边界。
 */
import { describe, expect, it } from 'vitest'

import { stripHtmlTags } from '../src/lib/html-text'

describe('stripHtmlTags（状态机剥标签）', () => {
  it('普通行内标签剥干净', () => {
    expect(stripHtmlTags('<b>bold</b>')).toBe('bold')
    expect(stripHtmlTags('<c.red>colored</c>')).toBe('colored')
    expect(stripHtmlTags('<v Speaker>hello</v>')).toBe('hello')
    expect(stripHtmlTags('plain text')).toBe('plain text')
    expect(stripHtmlTags('')).toBe('')
  })

  it('引号内的 > 不闭合标签：旧正则会输出 y">kept', () => {
    expect(stripHtmlTags('<a title="x>y">kept</a>')).toBe('kept')
    expect(stripHtmlTags(`<a title='a>b'>kept</a>`)).toBe('kept')
  })

  it('嵌套标签删一次后不留活标签', () => {
    const out = stripHtmlTags('<scr<script>ipt>alert(1)</scr</script>ipt>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<scr')
    expect(out).toContain('alert(1)')
  })

  it('纯文本小于号保留：a < b 不被吞掉', () => {
    expect(stripHtmlTags('a < b > c')).toBe('a < b > c')
    expect(stripHtmlTags('5 < 10 and 20 > 3')).toBe('5 < 10 and 20 > 3')
  })

  it('未闭合标签丢弃剩余部分', () => {
    expect(stripHtmlTags('hello <b')).toBe('hello')
  })
})
