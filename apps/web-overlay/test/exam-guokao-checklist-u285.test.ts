/**
 * U-285：国考准考证打印前清单勾选岛（Spec §4.2 C）。
 * 交互照抄 U-237：① <label> 包复选框 + 行文本（点行文字即勾选），行内无外链；
 * ② 复选框视觉保持 20px，加 ::after 隐形扩区到 44×44（站内 U-27 同款
 * after:-inset-3）；③ 已勾行 line-through；④ 挂载前渲染与服务端一致的
 * 未勾选视图（checked 为 null 时按空数组渲染）。
 * 清单项 id 与文案一律复用 W2 内容定稿（@/lib/guokao-checklist），本文件
 * 不另编项；状态照抄 my-exams.ts 收敛模式：新键
 * navhub.guokao-admission-checklist.v1，只存已勾项 id 数组；未知 id 丢弃；
 * 绝不复用 toggleNodeCheck（R8）。
 * 渲染用 renderToString（node 环境前例见 exam-tracker-label-u237.test.ts）；
 * hook 用 vi.doMock 桩 useGuokaoChecklist 后动态 import 渲染。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  GUOKAO_CHECKLIST_GROUPS,
  GUOKAO_CHECKLIST_SOURCE_NOTE,
} from '../src/lib/guokao-checklist'
import {
  GUOKAO_CHECKLIST_ITEMS,
  groupCheckedCount,
  parseGuokaoChecklist,
  toggleGuokaoChecklist,
} from '../src/lib/guokao-checklist-state'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

async function renderIsland(checked: string[] | null, storageBlocked: string | null = null) {
  vi.resetModules()
  vi.doMock('@/hooks/useGuokaoChecklist', () => ({
    useGuokaoChecklist: () => ({
      checked,
      storageBlocked,
      toggle: () => false,
    }),
  }))
  const { GuokaoChecklistIsland } = await import(
    '../src/app/exam/guokao-checklist/guokao-checklist-island'
  )
  return renderToString(createElement(GuokaoChecklistIsland))
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

describe('U-285 纯规则层：清单项与收敛（复用 W2 定稿）', () => {
  it('清单共 7 项：A 组 3 项 + B 组 3 项 + C 组 1 项，id 与文案与 W2 定稿一致', () => {
    expect(GUOKAO_CHECKLIST_ITEMS).toHaveLength(7)
    expect(GUOKAO_CHECKLIST_GROUPS.map((g) => g.items.length)).toEqual([3, 3, 1])
    expect(GUOKAO_CHECKLIST_ITEMS.map((i) => i.id)).toEqual([
      'registration-number',
      'id-number',
      'account-login',
      'exam-site',
      'exam-room',
      'exam-time',
      'spare-copies',
    ])
    const labels = GUOKAO_CHECKLIST_ITEMS.map((i) => i.label)
    expect(labels).toEqual([
      '报名序号已找到',
      '身份证号在手边',
      '账号可登录',
      '考点名称',
      '考场号',
      '考试时间',
      '多打两份备用',
    ])
    // 时间值与国考节点一致（行测 9:00–11:00、申论 14:00–17:00、专业科目 11-28 14:00–16:00）。
    const timeItem = GUOKAO_CHECKLIST_ITEMS.find((i) => i.id === 'exam-time')!
    expect(timeItem.note).toContain('行测 11 月 29 日 9:00–11:00')
    expect(timeItem.note).toContain('申论 14:00–17:00')
    expect(timeItem.note).toContain('专业科目 11 月 28 日 14:00–16:00')
    expect(timeItem.note).toContain('仅部分职位')
    // C 组注：电子版另存一份 + 《须知》兜底。
    const spare = GUOKAO_CHECKLIST_ITEMS.find((i) => i.id === 'spare-copies')!
    expect(spare.note).toContain('电子版另存一份')
    expect(spare.note).toContain('以报名系统《准考证打印须知》为准')
  })

  it('parse：未知 id 与非字符串丢弃、去重；非数组返回空', () => {
    expect(
      parseGuokaoChecklist(['registration-number', 'no-such-item', 3, 'registration-number']),
    ).toEqual(['registration-number'])
    expect(parseGuokaoChecklist(null)).toEqual([])
    expect(parseGuokaoChecklist('registration-number')).toEqual([])
  })

  it('toggle：未知 id 是 no-op；同一项反复切换', () => {
    expect(toggleGuokaoChecklist([], 'no-such-item')).toEqual([])
    expect(toggleGuokaoChecklist([], 'registration-number')).toEqual(['registration-number'])
    expect(toggleGuokaoChecklist(['registration-number'], 'registration-number')).toEqual([])
    expect(toggleGuokaoChecklist(['registration-number'], 'id-number')).toEqual([
      'registration-number',
      'id-number',
    ])
  })

  it('groupCheckedCount：按组计数（A 组「已完成 x / 3」的分子）', () => {
    const groupA = GUOKAO_CHECKLIST_GROUPS[0]
    expect(groupCheckedCount(['registration-number', 'exam-site'], groupA)).toBe(1)
    expect(
      groupCheckedCount(['registration-number', 'id-number', 'account-login'], groupA),
    ).toBe(3)
  })
})

describe('U-285 勾选岛：label 包复选框 + 行文本，行内无外链', () => {
  it('7 项各一个 <label>，复选框在 label 内、行文本在 label 内', async () => {
    const html = await renderIsland(['registration-number'])
    const labels = labelChunks(html)
    expect(labels).toHaveLength(7)
    for (const label of labels) {
      expect(label).toContain('<input type="checkbox"')
      expect(label).toContain('font-medium')
    }
    expect(liChunks(html)).toHaveLength(7)
  })

  it('label 内无任何 <a>：行内不嵌交互元素，点行文字只触发勾选', async () => {
    const html = await renderIsland([])
    for (const label of labelChunks(html)) {
      expect(label).not.toContain('<a ')
    }
    expect(html).not.toContain('<a ')
  })

  it('复选框视觉保持 20px，但 ::after 隐形扩区到 44×44', async () => {
    const html = await renderIsland([])
    expect(html).toContain('after:-inset-3')
    expect(html).toContain('after:content-')
    for (const label of labelChunks(html)) {
      expect(label).toContain('h-5 w-5')
      expect(label).toContain('after:-inset-3')
    }
  })

  it('已勾选行打删除线、未勾选行不打', async () => {
    const html = await renderIsland(['registration-number', 'exam-site'])
    const chunks = liChunks(html)
    expect(chunks.find((c) => c.includes('报名序号已找到'))).toContain('line-through')
    expect(chunks.find((c) => c.includes('考点名称'))).toContain('line-through')
    expect(chunks.find((c) => c.includes('身份证号在手边'))).not.toContain('line-through')
  })

  it('进度文案：总进度「已完成 x / 7」，A 组「已完成 x / 3」', async () => {
    const html = await renderIsland(['registration-number', 'id-number'])
    expect(html).toContain('已完成 2 / 7')
    expect(html).toContain('已完成 2 / 3')
  })

  it('组 footnote 与页脚来源小字（转载级措辞）齐全', async () => {
    const html = await renderIsland([])
    expect(html).toContain('据官方公告转载整理，以官方最新公告为准')
    expect(html).toContain('异地考生请提前安排住宿与交通（转载建议）')
    expect(html).toContain(GUOKAO_CHECKLIST_SOURCE_NOTE)
    expect(html).toContain('勾选只保存在本机浏览器，不登录、不跨设备同步')
  })
})

describe('U-285 勾选岛：挂载前 SSR 一致 + 存储被禁不崩', () => {
  it('checked 为 null（挂载前）时按未勾选渲染：无 line-through、无 checked 框', async () => {
    const html = await renderIsland(null)
    expect(html).not.toContain('line-through')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('已完成 0 / 7')
    expect(html).toContain('报名序号已找到')
  })

  it('存储被禁时显示原因（role=alert），不崩、清单仍可见', async () => {
    const html = await renderIsland([], '浏览器不允许读写本地存储')
    expect(html).toContain('role="alert"')
    expect(html).toContain('浏览器不允许读写本地存储')
    expect(html).toContain('报名序号已找到')
  })
})

describe('U-285：源码守卫——U-237 结构与新键不回潮', () => {
  it('岛源码：label 包行、after 扩区、line-through；不用 toggleNodeCheck', () => {
    const src = read('src/app/exam/guokao-checklist/guokao-checklist-island.tsx')
    expect(src).toContain('<label')
    expect(src).toContain('after:-inset-3')
    expect(src).toContain('line-through')
    // 守卫只拦真实调用/引用：注释里提及 toggleNodeCheck（说明为何不用）是允许的。
    expect(src).not.toContain('toggleNodeCheck(')
    expect(src).not.toContain("from '@/lib/my-exams'")
    expect(src).not.toContain("from '@/hooks/useMyExams'")
  })

  it('状态层源码：新键独立，复用 W2 定稿的 id 与文案', () => {
    const src = read('src/lib/guokao-checklist-state.ts')
    expect(src).toContain('navhub.guokao-admission-checklist.v1')
    expect(src).toContain("from './guokao-checklist'")
    expect(src).not.toContain('MY_EXAMS_STORAGE_KEY')
    expect(src).not.toContain('报名序号已找到')
  })

  it('my-exams.ts 旧键未被改动（本轮只读新键）', () => {
    const src = read('src/lib/my-exams.ts')
    expect(src).toContain("MY_EXAMS_STORAGE_KEY = 'navhub.my-exams.v1'")
  })
})
