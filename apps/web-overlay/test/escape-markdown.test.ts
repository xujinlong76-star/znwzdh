import { describe, expect, it } from 'vitest'
import { escapeMarkdownText } from '../src/lib/save-annotations'

/**
 * 转义逃逸回归（CodeQL #136/#137）。
 *
 * 漏洞原理：如果用**分步 replace** 转义 Markdown 特殊字符——
 *   text.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\\/g, '\\\\')
 * 那么用户输入里**已有的反斜杠**会在后续步骤里"吃掉"刚加上的转义符，
 * 把本应失效的 `[` 重新变回活字符：
 *   `\\[` → 第一步变成 `\\\\[` → 最后一步反斜杠翻倍 → 最终 `\\[`（仍是活的链接起始）
 * 攻击者可用 `[点我](javascript:alert(1))` 这类输入在导出的 Markdown 里注入链接。
 *
 * 正确做法：**单遍映射表**——每个输入字符恰好映射一次，不存在二次处理。
 */
describe('escapeMarkdownText（转义逃逸回归）', () => {
  describe('反斜杠本身必须被转义', () => {
    it('单个反斜杠 → 双反斜杠', () => {
      expect(escapeMarkdownText('a\\b')).toBe('a\\\\b')
    })
    it('两个反斜杠 → 四个', () => {
      expect(escapeMarkdownText('a\\\\b')).toBe('a\\\\\\\\b')
    })
    it('反斜杠紧邻方括号时不产生活字符', () => {
      // 关键攻击向量：\[ 若分步处理会复活成 [
      const out = escapeMarkdownText('\\[')
      expect(out).toBe('\\\\\\[')
      // 去掉所有转义用的反斜杠后，剩下的 [ 必须已被转义（即前面是 ）
      expect(out).not.toMatch(/(?<!\\)\[/)
    })
  })

  describe('Markdown 特殊字符', () => {
    it('方括号被转义（防链接注入）', () => {
      expect(escapeMarkdownText('[点我](javascript:alert(1))')).toBe(
        '\\[点我\\](javascript:alert(1))',
      )
    })
    it('尖括号被转义（防 HTML 注入）', () => {
      expect(escapeMarkdownText('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;',
      )
    })
    it('普通文本不受影响', () => {
      expect(escapeMarkdownText('普通中文 abc 123')).toBe('普通中文 abc 123')
    })
  })

  describe('幂等性与组合攻击', () => {
    it('连续调用两次不会还原成活字符', () => {
      const once = escapeMarkdownText('[x]')
      const twice = escapeMarkdownText(once)
      // 第二次转义会再次处理第一次引入的反斜杠，结果必须仍然是"死的"
      expect(twice).not.toBe('[x]')
      expect(twice).toContain('\\\\')
    })

    it('混合攻击串里每个危险字符都被处理', () => {
      const evil = '\\[<a>](http://x)\\]'
      const out = escapeMarkdownText(evil)
      // 输出里不应存在未被转义的反斜杠开头的 [
      expect(out).not.toMatch(/(?<!\\)\[/)
      expect(out).not.toContain('<a>')
    })

    it('空串安全', () => {
      expect(escapeMarkdownText('')).toBe('')
    })
  })
})
