/**
 * U-237：考前清单勾选框只有 20×20，且点行文字不能勾选。
 * 修法：① <label> 包复选框 + 行文本（点行文字即勾选），行内外链移出 label
 * （label 内不嵌交互元素）；② 复选框视觉保持 20px，加 ::after 隐形扩区
 * 到 44×44（站内 U-27 同款 after:-inset-3）；③ 未关注态圆点与复选框
 * 同一 20px 槽位，切换关注时行首标记不跳变。
 * 渲染用 renderToString（node 环境前例见 exam-node-link-label-u124.test.ts）；
 * 已关注 / 未关注两态各用 vi.doMock 桩 useMyExams 后动态 import 渲染。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EXAMS, type ExamInfo } from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const guokao = EXAMS.find((e) => e.id === 'guokao')!

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

type MockState = { followed: string[]; checked: Record<string, string[]> } | null

async function renderTracker(state: MockState): Promise<string> {
  vi.resetModules()
  vi.doMock('@/hooks/useMyExams', () => ({
    useMyExams: () => ({
      state,
      storageBlocked: null,
      toggleFollow: () => false,
      toggleNodeCheck: () => false,
    }),
  }))
  const { MyExamTracker } = await import('../src/app/exam/my-exam-tracker')
  return renderToString(createElement(MyExamTracker, { exam: guokao }))
}

/** 逐 <li> 切块 */
function liChunks(h: string): string[] {
  const out: string[] = []
  const re = /<li[^>]*>([\s\S]*?)<\/li>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(h)) !== null) out.push(m[1])
  return out
}

/** 逐 <label> 切块 */
function labelChunks(h: string): string[] {
  const out: string[] = []
  const re = /<label[^>]*>([\s\S]*?)<\/label>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(h)) !== null) out.push(m[1])
  return out
}

describe('U-237：已关注态——label 包复选框 + 行文本，外链在 label 外', () => {
  it('每行一个 <label>，复选框在 label 内、行文本在 label 内', async () => {
    const html = await renderTracker({ followed: ['guokao'], checked: { guokao: ['准考证打印'] } })
    const labels = labelChunks(html)
    expect(labels).toHaveLength(guokao.nodes.length)
    for (const label of labels) {
      expect(label).toContain('<input type="checkbox"')
      expect(label).toContain('font-medium')
    }
  })

  it('label 内无任何 <a>：行内外链移出 label，点链接不误触发勾选', async () => {
    const html = await renderTracker({ followed: ['guokao'], checked: { guokao: [] } })
    for (const label of labelChunks(html)) {
      expect(label).not.toContain('<a ')
    }
    // 外链仍在同行 <li> 内、可点：国考 3 节点中 1 行带入口。
    const chunks = liChunks(html)
    expect(chunks).toHaveLength(guokao.nodes.length)
    expect(chunks.filter((c) => c.includes('<a '))).toHaveLength(1)
    expect(html).toContain('去官网打印准考证')
  })

  it('复选框视觉保持 20px，但 ::after 隐形扩区到 44×44', async () => {
    const html = await renderTracker({ followed: ['guokao'], checked: { guokao: [] } })
    expect(html).toContain('after:-inset-3')
    expect(html).toContain('after:content-')
    for (const label of labelChunks(html)) {
      expect(label).toContain('h-5 w-5')
      expect(label).toContain('after:-inset-3')
    }
  })

  it('已勾选行打删除线、未勾选行不打：label 不改变勾选态渲染', async () => {
    const html = await renderTracker({ followed: ['guokao'], checked: { guokao: ['准考证打印'] } })
    const chunks = liChunks(html)
    const checked = chunks.find((c) => c.includes('准考证打印'))!
    expect(checked).toContain('line-through')
    const unchecked = chunks.find((c) => c.includes('专业科目笔试'))!
    expect(unchecked).not.toContain('line-through')
  })
})

describe('U-237：未关注态——圆点与复选框同一 20px 槽位', () => {
  it('未关注渲染无 <label>、无复选框，圆点居中于 20px 槽位', async () => {
    const html = await renderTracker(null)
    expect(html).not.toContain('<label')
    expect(html).not.toContain('<input type="checkbox"')
    // 圆点槽位：mt-0.5 + 20px 盒 + 居中，与已关注态复选框槽位逐字一致。
    expect(html).toContain('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center')
    expect(html).toContain('h-2 w-2 shrink-0 rounded-full')
    // 行文本与外链仍在：未关注只少勾选框，不少信息。
    expect(html).toContain('准考证打印')
    expect(html).toContain('去官网打印准考证')
  })
})

describe('U-237：源码守卫——label 结构与扩区不回潮', () => {
  it('tracker 源码：label 包行、after 扩区、圆点槽位与复选框同宽', () => {
    const src = read('src/app/exam/my-exam-tracker.tsx')
    expect(src).toContain('<label')
    expect(src).toContain('after:-inset-3')
    expect(src).toContain('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center')
    // 旧结构不回潮：复选框不再裸挂 mt-0.5、圆点不再裸挂 mt-1.5。
    expect(src).not.toContain('className="mt-0.5 h-5 w-5 shrink-0"')
    expect(src).not.toContain('mt-1.5 h-2 w-2')
  })
})
