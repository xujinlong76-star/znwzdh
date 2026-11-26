/**
 * 搜索框 AI 模式守卫（T8）。
 *
 * 锁住三件事，任何一项被删掉都会让 AI 模式失效或撒谎：
 *  1. 搜索框里有 AI 切换按钮（aria-pressed 标明开/关），点它进模式；
 *  2. AI 模式下回车直接问 AI 找站（openCopilot 带整句查询），而不是
 *     打开第一条站内结果；空查询不发；
 *  3. 模式有记忆（localStorage）与键盘入口（行首 `?` / `ai ` 前缀，
 *     与 Spotlight 同一约定），占位语明说这是在问 AI。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SEARCH_AI_MODE_STORAGE_KEY,
  SEARCH_AI_PLACEHOLDER,
  readSearchAiMode,
  resolveAiModeInput,
  writeSearchAiMode,
} from '@/lib/search-ai-mode'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('resolveAiModeInput（前缀即模式）', () => {
  it('行首 ? 进 AI 模式并去掉前缀', () => {
    expect(resolveAiModeInput('?做 PPT 用什么网站')).toEqual({ aiMode: true, query: '做 PPT 用什么网站' })
  })

  it('行首 ai + 空格进 AI 模式并去掉前缀（大小写不敏感）', () => {
    expect(resolveAiModeInput('AI 找个免费图片站')).toEqual({ aiMode: true, query: '找个免费图片站' })
  })

  it('只剩一个 ? 不算一句话，不进模式', () => {
    expect(resolveAiModeInput('?')).toEqual({ aiMode: false, query: '?' })
    expect(resolveAiModeInput('?  ')).toEqual({ aiMode: false, query: '?  ' })
  })

  it('中间的问号不动，普通查询不进模式', () => {
    expect(resolveAiModeInput('这是什么？')).toEqual({ aiMode: false, query: '这是什么？' })
    expect(resolveAiModeInput('github')).toEqual({ aiMode: false, query: 'github' })
  })

  it('占位语明说在问 AI，不冒充站内检索', () => {
    expect(SEARCH_AI_PLACEHOLDER).toContain('问 AI')
    expect(SEARCH_AI_MODE_STORAGE_KEY).toBe('navhub.search.aiMode.v1')
  })
})

describe('模式记忆 read/writeSearchAiMode', () => {
  it('无 localStorage 时不抛错、默认关', () => {
    expect(readSearchAiMode()).toBe(false)
    expect(() => writeSearchAiMode(true)).not.toThrow()
  })
})

describe('SearchPalette 接线（源码守卫）', () => {
  const src = overlaySource('src/components/search-palette.tsx')

  it('搜索框里有 AI 切换按钮（aria-pressed 标明开/关）', () => {
    expect(src).toContain('aria-pressed={aiMode}')
    expect(src).toContain('切换到 AI 模式')
    expect(src).toContain('toggleAiMode')
  })

  it('AI 模式下回车问 AI 找站（整句查询发给 openCopilot），空查询不发', () => {
    expect(src).toContain("if (e.key === 'Enter' && aiMode)")
    expect(src).toContain("openCopilot({ query: q, source: 'programmatic' })")
    expect(src).toContain('if (!q) return')
  })

  it('AI 模式占位语切换、输入框有模式描边', () => {
    expect(src).toContain('SEARCH_AI_PLACEHOLDER')
    expect(src).toContain('effectivePlaceholder')
    expect(src).toContain('border-violet-400/70')
  })

  it('行首 ? / ai 前缀自动进模式（与 Spotlight 同一约定）', () => {
    expect(src).toContain('resolveAiModeInput(e.target.value)')
  })

  it('普通搜索行为：回车进结果页（F-01）、方向键仍在', () => {
    expect(src).toContain("e.key === 'ArrowDown'")
    expect(src).toContain("e.key === 'Enter'")
    expect(src).toContain('router.push(searchHref({ q }))')
  })
})
