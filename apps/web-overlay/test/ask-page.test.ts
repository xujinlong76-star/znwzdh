/**
 * 问问我的收藏（/ask）前端测试。
 *
 * node 环境无 jsdom/RTL，所以行为层只测纯函数（SSE 帧解析、本机历史），
 * 页面接线用源码守卫（brief-page.test.ts 同款做法）：
 *  - 隐私文案常驻、输入框吸底、目标 ≥44px、<5 条置灰、引用只渲染服务端引用表；
 *  - /brief 卡片与 ⌘K 命令都跳 /ask，不在别处内嵌问答。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASK_HISTORY_LIMIT,
  ASK_HISTORY_STORAGE_KEY,
  askHistoryForRequest,
  clearAskHistory,
  loadAskHistory,
  parseAskSseBlock,
  saveAskHistoryEntry,
  type AskHistoryEntry,
} from '../src/lib/ask-client'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

function stubBrowserEnv() {
  const map = new Map<string, string>()
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('window', { localStorage: store })
  return map
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseAskSseBlock：SSE 帧解析', () => {
  it('progress 注释帧解析出两段进度', () => {
    expect(parseAskSseBlock(': progress {"stage":"retrieved","total":5,"matched":2}')).toEqual({
      progress: { stage: 'retrieved', total: 5, matched: 2 },
    })
    expect(parseAskSseBlock(': progress {"stage":"generating"}')).toEqual({
      progress: { stage: 'generating' },
    })
  })

  it('done 帧原样透传（终稿字段不逐个建模）', () => {
    const parsed = parseAskSseBlock(
      'data: {"type":"done","ok":true,"mode":"ai","answer":[{"text":"做 PPT 可以用 PPT 大师。","citations":["ppt"]}]}',
    )
    expect(parsed).toMatchObject({ frame: { type: 'done', ok: true } })
  })

  it('普通注释与心跳不是帧', () => {
    expect(parseAskSseBlock(': connected')).toBeNull()
    expect(parseAskSseBlock(': ping')).toBeNull()
  })

  it('坏 JSON 的 progress 帧丢弃，不炸流', () => {
    expect(parseAskSseBlock(': progress {不是json')).toBeNull()
    expect(parseAskSseBlock('data: 不是json')).toEqual({ frame: null })
  })
})

describe('本机问答历史：最近 20 条 localStorage', () => {
  const entry = (q: string, at: number): AskHistoryEntry => ({
    question: q,
    summary: '摘要' + q,
    siteIds: ['ppt'],
    at,
  })

  it('存取往返、超 20 条截断、同问题去重后置顶', () => {
    stubBrowserEnv()
    for (let i = 0; i < 22; i += 1) saveAskHistoryEntry(entry('问题' + i, i))
    const loaded = loadAskHistory()
    expect(loaded).toHaveLength(ASK_HISTORY_LIMIT)
    expect(loaded[0]?.question).toBe('问题21')
    saveAskHistoryEntry(entry('问题0', 99))
    expect(loadAskHistory()[0]?.question).toBe('问题0')
    expect(loadAskHistory()).toHaveLength(ASK_HISTORY_LIMIT)
  })

  it('一键清空', () => {
    const map = stubBrowserEnv()
    saveAskHistoryEntry(entry('问题', 1))
    expect(map.has(ASK_HISTORY_STORAGE_KEY)).toBe(true)
    clearAskHistory()
    expect(loadAskHistory()).toEqual([])
    expect(map.has(ASK_HISTORY_STORAGE_KEY)).toBe(false)
  })

  it('无 window 环境不抛错、读空', () => {
    expect(loadAskHistory()).toEqual([])
  })
})

describe('askHistoryForRequest：追问上下文最近 3 轮', () => {
  it('3 轮 = 6 条 turns，每条 ≤500 字', () => {
    // loadAskHistory 返回 newest-first；最近 3 轮是前 3 条，拼 turns 前反转为时间顺序（最旧在前）
    const entries: AskHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      question: `问题${4 - i}` + '啊'.repeat(600),
      summary: `摘要${4 - i}` + '啊'.repeat(600),
      siteIds: [],
      at: 4 - i,
    }))
    const turns = askHistoryForRequest(entries)
    expect(turns).toHaveLength(6)
    expect(turns.every((t) => t.content.length <= 500)).toBe(true)
    // 时间顺序：最旧一轮（问题 2）在前，最新一轮（问题 4）在后
    expect(turns[0]?.content).toContain('问题2')
    expect(turns[2]?.content).toContain('问题3')
    expect(turns[4]?.content).toContain('问题4')
  })
})

describe('/ask 页面源码守卫', () => {
  const view = read('src/app/ask/ask-view.tsx')
  const page = read('src/app/ask/page.tsx')

  it('?q= 深链预填（page 读 searchParams，view 接 initialQ）', () => {
    expect(page).toContain('searchParams')
    expect(page).toContain('initialQ')
    expect(view).toContain('initialQ')
  })

  it('隐私说明文案常驻输入框下方', () => {
    expect(view).toContain('你的收藏标题、描述与备注会随问题一起发给 AI 服务商（默认 Agnes）生成答案')
    expect(view).toContain('问题与答案默认只保存在这台设备上，不会同步到服务器')
  })

  it('移动端输入框吸底、目标 ≥44px', () => {
    expect(view).toContain('sticky bottom-0')
    expect(view).toContain('min-h-[44px]')
  })

  it('收藏 <5 条不开放提问：置灰 + 说明 + 去逛逛/去导入入口', () => {
    expect(view).toContain('攒够 5 条才能提问')
    expect(view).toContain('href="/"')
    expect(view).toContain('href="/import"')
    expect(view).toContain('disabled={!canAsk')
  })

  it('引用只渲染服务端引用表：角标 [n] + 站内站点页 + safeHref 外链，不渲染模型原文链接', () => {
    expect(view).toContain("href={`/site/${encodeURIComponent(card.siteId)}`}")
    expect(view).toContain('safeHref(card.url)')
    expect(view).toContain('打开原站')
    expect(view).not.toContain('dangerouslySetInnerHTML')
  })

  it('「不知道」分支标注参考卡片仅供参考', () => {
    expect(view).toContain('仅供参考，不是答案依据')
  })

  it('检索异常 JSON 路径（ok:true/degraded:error）有 error 横幅 + 重试按钮，不留空白', () => {
    expect(view).toContain("result.degraded === 'error'")
    expect(view).toContain('再试一次')
    expect(view).toContain("void ask(question)")
  })

  it('加载分两段诚实展示：翻收藏 → 找到相关 → 整理答案', () => {
    expect(view).toContain('正在翻你的')
    expect(view).toContain('找到')
    expect(view).toContain('条相关')
    expect(view).toContain('AI 正在整理答案')
  })

  it('本机历史一键清空', () => {
    expect(view).toContain('清空')
    expect(view).toContain('clearAskHistory')
  })

  it('/ask 页不参与索引', () => {
    expect(page).toContain('index: false')
  })
})

describe('入口守卫：/brief 卡片与 ⌘K 命令都跳 /ask', () => {
  it('/brief 卡片只跳转，不内嵌问答', () => {
    const brief = read('src/app/brief/page.tsx')
    expect(brief).toContain('问问我的收藏')
    expect(brief).toContain('href="/ask"')
    expect(brief).not.toContain('ask-view')
    expect(brief).not.toContain('streamAskQuestion')
  })

  it('⌘K 有 cmd-ask 命令，跳 /ask', () => {
    const modal = read('src/components/search/spotlight-modal.tsx')
    expect(modal).toContain("id: 'cmd-ask'")
    expect(modal).toContain("router.push('/ask')")
  })
})
