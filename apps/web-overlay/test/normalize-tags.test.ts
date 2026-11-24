import { describe, expect, it } from 'vitest'
import { ACRONYM_CANON, TAG_SYNONYM_MAP, normalizeTagName } from '../../../scripts/normalize-tags.mjs'

/**
 * 标签规范化（2026-11-21）。
 *
 * 三条规则的纯函数部分——不碰数据库，保证规则本身可独立验证。
 * 剥离分类复读需要 categories 表，属数据侧逻辑，由 dry-run 报告覆盖。
 */
describe('normalizeTagName', () => {
  describe('同义词归并', () => {
    it.each([
      ['postgres', 'PostgreSQL'],
      ['ai编程', 'AI 编程'],
      ['AI编程', 'AI 编程'],
      ['ai搜索', 'AI 搜索'],
      ['rag架构', 'RAG 架构'],
      ['自建', '自托管'],
      ['高性价比', '性价比'],
      ['大语言模型', '大模型'],
      ['llm', '大模型'],
      ['桌面', '桌面端'],
      ['跨端', '跨平台'],
      ['边缘', '边缘计算'],
      ['配音', 'AI 配音'],
      ['智能配音', 'AI 配音'],
      ['语音合成', 'AI 配音'],
      ['tts', 'AI 配音'],
      ['视频生成', 'AI 视频'],
    ])('%s → %s', (input, expected) => {
      expect(normalizeTagName(input)).toBe(expected)
    })
  })

  describe('缩写强制大写', () => {
    it.each([
      ['ai', 'AI'],
      ['ui', 'UI'],
      ['ux', 'UX'],
      ['bi', 'BI'],
      ['seo', 'SEO'],
      // `rag` 已被同义词表收敛到业务规范名「RAG 架构」（用户交付标准明确要求），
      // 缩写仍强制大写，只是不能停留在裸缩写形态。
      ['rag', 'RAG 架构'],
      ['mcp', 'MCP'],
      ['wasm', 'WASM'],
      ['k12', 'K12'],
      ['3d', '3D'],
      ['ar', 'AR'],
      ['e2e', 'E2E'],
      ['css', 'CSS'],
      ['sql', 'SQL'],
      ['pdf', 'PDF'],
      ['api', 'API'],
      ['cli', 'CLI'],
    ])('%s → %s', (input, expected) => {
      expect(normalizeTagName(input)).toBe(expected)
    })

    it('品牌原名不受影响（nodejs / npm / shadcn 保持原样）', () => {
      // 这些不是缩写，改成 NODEJS 反而错
      expect(normalizeTagName('nodejs')).toBe('nodejs')
      expect(normalizeTagName('npm')).toBe('npm')
      expect(normalizeTagName('shadcn')).toBe('shadcn')
    })
  })

  describe('中英文空格规范化', () => {
    it('「AI编程」补空格为「AI 编程」', () => {
      expect(normalizeTagName('AI编程')).toBe('AI 编程')
    })
    it('「编程AI」补空格为「编程 AI」', () => {
      expect(normalizeTagName('编程AI')).toBe('编程 AI')
    })
    it('多余空格折叠为一个', () => {
      expect(normalizeTagName('AI   编程')).toBe('AI 编程')
    })
    it('已规范的不再改动', () => {
      expect(normalizeTagName('AI 编程')).toBe('AI 编程')
    })
  })

  describe('边界', () => {
    it('空串与纯空白返回 null', () => {
      expect(normalizeTagName('')).toBeNull()
      expect(normalizeTagName('   ')).toBeNull()
      expect(normalizeTagName(null)).toBeNull()
    })
    it('纯中文不受影响', () => {
      expect(normalizeTagName('开源')).toBe('开源')
      expect(normalizeTagName('知识库')).toBe('知识库')
    })
  })

  describe('词典自身的健全性', () => {
    it('同义词表的值都应是规范形态（再规范化后不变）', () => {
      for (const target of new Set(Object.values(TAG_SYNONYM_MAP))) {
        // 规范词自身再跑一遍不应被改写（幂等）
        const once = normalizeTagName(target)
        const twice = normalizeTagName(once)
        expect(twice, `规范词「${target}」不稳定`).toBe(once)
      }
    })

    it('缩写表的 key 全为小写', () => {
      for (const k of Object.keys(ACRONYM_CANON)) {
        expect(k).toBe(k.toLowerCase())
      }
    })
  })
})
