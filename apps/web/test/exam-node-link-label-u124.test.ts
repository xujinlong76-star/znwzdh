/**
 * U-124 考试节点外链文案按节点类型映射：渲染断言（T1–T8）。
 *
 * 根因：my-exam-tracker.tsx 把带 url 的节点一律渲染成「去官网打印准考证」
 *（aria-label 同样硬编码「…官方打印入口」），与节点类型无关——京考报名、
 * 京考公共科目笔试（链接是首都之窗公告页）、江西成绩复核三处是错文案。
 * 修面：渲染层按 node.label 映射文案，不改 exam-calendar.ts 数据、
 * 不给 ExamNode 加字段、不新增节点/URL。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom——用 react-dom/server 的
 * renderToString 做服务端渲染断言（不挂载，effect 不跑，正好对应 SSR 输出）。
 * MyExamTracker 是 'use client' 岛：useMyExams 桩返回未关注哨兵态，
 * 只测链接文案本身。
 *
 * 定稿文案（任务原文）：
 *   报名 →「去官网报名」/ aria「报名官方报名入口（新窗口打开）」
 *   公共科目笔试（京考）→「查看官方公告」/ aria「公共科目笔试官方公告入口（新窗口打开）」
 *   江西成绩复核 →「去报名系统申请复核」/ aria「江西成绩复核报名系统申请复核入口（新窗口打开）」
 *   广东自考成绩查询 →「去系统查成绩」/ aria「成绩查询系统查询成绩入口（新窗口打开）」
 *   其余 13 处准考证打印类节点 →「去官网打印准考证」不变。
 *
 * label 键安全性：'公共科目笔试' 在国考/省考也出现，但那两处节点无 url、
 * 不渲染链接，映射只在 node.url 分支内调用，误伤不到；'报名' 与
 * '江西成绩复核' 各只出现一次；'成绩查询' 在江苏与广东自考各出现一次，
 * 但只有广东节点带 url，映射只在 node.url 分支内调用，误伤不到。T6 锁死这一事实源状态。
 *
 * 计数口径修正（相对 /tmp/u124-test-plan.md 草稿 T5）：
 * 「打印准考证」短串在渲染 HTML 里修后仍出现 16 次——13 次链接文案 +
 * 3 处节点 detail 原文（教资/文职/京考准考证打印行写「下载打印准考证」），
 * 故 T5 只对链接文案与「去官网打印准考证」全串计数，不对短串全量计数。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  CET_ADMISSION_URL,
  EXAMS,
  GUANGDONG_SHENGKAO_ADMISSION_URL,
  GUANGDONG_ZIKAO_SCORE_URL,
  GUOKAO_ADMISSION_URL,
  JIANGSU_SHENGKAO_ADMISSION_URL,
  JIANGXI_CHENGKAO_REVIEW_URL,
  JIAOSHI_MIANSHI_URL,
  JINGKAO_APPLY_URL,
  JINGKAO_NOTICE_URL,
  JUNDUANWENZHI_ADMISSION_URL,
  SHANDONG_SHENGKAO_ADMISSION_URL,
  SHANGHAI_SHENGKAO_ADMISSION_URL,
  SICHUAN_SHENGKAO_ADMISSION_URL,
  TIANJIN_SHENGKAO_ADMISSION_URL,
  ZHEJIANG_SHENGKAO_ADMISSION_URL,
  type ExamInfo,
} from '../src/lib/exam-calendar'
import { safeHref } from '../src/lib/safe-url'
import { MyExamTracker } from '../src/app/exam/my-exam-tracker'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

// useMyExams 是客户端岛的共享 hook（useSyncExternalStore + localStorage）：
// renderToString 不跑 effect，桩回未关注哨兵态即可，只测链接文案本身。
vi.mock('@/hooks/useMyExams', () => ({
  useMyExams: () => ({
    state: null,
    storageBlocked: null,
    toggleFollow: () => false,
    toggleNodeCheck: () => false,
  }),
}))

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

interface RenderedLink {
  examId: string
  label: string
  href: string
  ariaLabel: string
  text: string
  target: string
  rel: string
}

/** renderToString 会转义 &：href 比对前先还原，与 safeHref 计算值逐字比对。 */
const unesc = (html: string) =>
  html.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&')

/** 逐 <li> 解析：每行一个节点，带 url 的行含一个 <a>，与 node.label 配对。 */
function linksOf(exam: ExamInfo): RenderedLink[] {
  const html = renderToString(createElement(MyExamTracker, { exam }))
  const out: RenderedLink[] = []
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g
  let m: RegExpExecArray | null
  while ((m = liRe.exec(html)) !== null) {
    const chunk = m[1]
    const aMatch = chunk.match(/<a ([^>]*)>([^<]*)/)
    if (!aMatch) continue
    const attrs = aMatch[1]
    const label = chunk.match(/font-medium[^>]*>([^<]+)</)?.[1] ?? ''
    out.push({
      examId: exam.id,
      label,
      href: unesc(attrs.match(/href="([^"]*)"/)?.[1] ?? ''),
      ariaLabel: unesc(attrs.match(/aria-label="([^"]*)"/)?.[1] ?? ''),
      text: aMatch[2].trim(),
      target: attrs.match(/target="([^"]*)"/)?.[1] ?? '',
      rel: attrs.match(/rel="([^"]*)"/)?.[1] ?? '',
    })
  }
  return out
}

const allLinks = (): RenderedLink[] => EXAMS.flatMap((exam) => linksOf(exam))

const examById = (id: string): ExamInfo => EXAMS.find((e) => e.id === id)!

/** 17 个带 url 节点逐字映射（examId + label → URL 常量），T4/T6 共用。 */
const EXPECTED_URLS: Array<[string, string, string]> = [
  ['guokao', '准考证打印', GUOKAO_ADMISSION_URL],
  ['cet', '口试准考证打印', CET_ADMISSION_URL],
  ['cet', '笔试准考证打印', CET_ADMISSION_URL],
  ['shengkao', '天津准考证打印', TIANJIN_SHENGKAO_ADMISSION_URL],
  ['shengkao', '山东准考证打印', SHANDONG_SHENGKAO_ADMISSION_URL],
  ['shengkao', '四川准考证打印', SICHUAN_SHENGKAO_ADMISSION_URL],
  ['shengkao', '浙江准考证打印', ZHEJIANG_SHENGKAO_ADMISSION_URL],
  ['shengkao', '江苏准考证打印', JIANGSU_SHENGKAO_ADMISSION_URL],
  ['shengkao', '广东准考证打印', GUANGDONG_SHENGKAO_ADMISSION_URL],
  ['shengkao', '上海准考证打印', SHANGHAI_SHENGKAO_ADMISSION_URL],
  ['jiaoshi-mianshi', '准考证打印', JIAOSHI_MIANSHI_URL],
  ['jundui-wenzhi', '准考证打印', JUNDUANWENZHI_ADMISSION_URL],
  ['jingkao', '报名', JINGKAO_APPLY_URL],
  ['jingkao', '准考证打印', JINGKAO_APPLY_URL],
  ['jingkao', '公共科目笔试', JINGKAO_NOTICE_URL],
  ['chengkao', '江西成绩复核', JIANGXI_CHENGKAO_REVIEW_URL],
  ['guangdong-zikao', '成绩查询', GUANGDONG_ZIKAO_SCORE_URL],
]

/** 4 处例外 label（其余 13 处仍为「去官网打印准考证」）。 */
const EXCEPTION_LABELS = new Set(['报名', '公共科目笔试', '江西成绩复核', '成绩查询'])

describe('T1：京考报名改对', () => {
  it('报名行链接文本为「去官网报名」，不含「打印」，href 仍为报名系统原值', () => {
    const link = linksOf(examById('jingkao')).find((l) => l.label === '报名')!
    expect(link.text).toBe('去官网报名')
    expect(link.text).not.toContain('打印准考证')
    expect(link.ariaLabel).toBe('报名官方报名入口（新窗口打开）')
    expect(link.ariaLabel).not.toContain('打印')
    expect(link.href).toBe(safeHref(JINGKAO_APPLY_URL))
  })
})

describe('T2：京考公共科目笔试改对', () => {
  it('笔试行链接文本为「查看官方公告」（公告页非办事入口），不含「打印」，href 仍为公告原值', () => {
    const link = linksOf(examById('jingkao')).find((l) => l.label === '公共科目笔试')!
    expect(link.text).toBe('查看官方公告')
    expect(link.text).not.toContain('打印准考证')
    expect(link.ariaLabel).toBe('公共科目笔试官方公告入口（新窗口打开）')
    expect(link.ariaLabel).not.toContain('打印')
    expect(link.href).toBe(safeHref(JINGKAO_NOTICE_URL))
  })
})

describe('T3：江西成绩复核改对', () => {
  it('复核行链接文本为「去报名系统申请复核」，不含「打印」「查分」「查询成绩」，href 仍为报名系统原值', () => {
    const link = linksOf(examById('chengkao')).find((l) => l.label === '江西成绩复核')!
    expect(link.text).toBe('去报名系统申请复核')
    expect(link.text).not.toContain('打印准考证')
    expect(link.text).not.toContain('查分')
    expect(link.text).not.toContain('查询成绩')
    expect(link.ariaLabel).toBe('江西成绩复核报名系统申请复核入口（新窗口打开）')
    expect(link.ariaLabel).not.toContain('打印')
    expect(link.href).toBe(safeHref(JIANGXI_CHENGKAO_REVIEW_URL))
  })
})


describe('T3b：广东自考成绩查询改对', () => {
  it('查询行链接文本为「去系统查成绩」，不含「打印」「打印准考证」，href 仍为系统原值', () => {
    const link = linksOf(examById('guangdong-zikao')).find((l) => l.label === '成绩查询')!
    expect(link.text).toBe('去系统查成绩')
    expect(link.text).not.toContain('打印准考证')
    expect(link.text).not.toContain('打印')
    expect(link.ariaLabel).toBe('成绩查询系统查询成绩入口（新窗口打开）')
    expect(link.ariaLabel).not.toContain('打印')
    expect(link.href).toBe(safeHref(GUANGDONG_ZIKAO_SCORE_URL))
  })
})

describe('T4：其余 13 处准考证打印类节点文案不变', () => {
  it('13 处链接文本仍为「去官网打印准考证」，aria-label 仍为「…官方打印入口」，href 各自原值', () => {
    const links = allLinks()
    expect(links).toHaveLength(17)
    for (const [examId, label, url] of EXPECTED_URLS) {
      if (EXCEPTION_LABELS.has(label)) continue
      const link = links.find((l) => l.examId === examId && l.label === label)!
      expect(link.text).toBe('去官网打印准考证')
      expect(link.ariaLabel).toBe(`${label}官方打印入口（新窗口打开）`)
      expect(link.href).toBe(safeHref(url))
    }
  })
})

describe('T5：全量计数（防漏网/防多改）', () => {
  it('「去官网打印准考证」恰好 13 次、带 url 的 <a> 恰好 17 个、4 处例外无「打印」残留', () => {
    const links = allLinks()
    expect(links).toHaveLength(17)
    expect(links.filter((l) => l.text === '去官网打印准考证')).toHaveLength(13)
    for (const link of links) {
      if (EXCEPTION_LABELS.has(link.label)) {
        expect(link.text).not.toContain('打印')
        expect(link.ariaLabel).not.toContain('打印')
      }
    }
    const html = EXAMS.map((exam) =>
      renderToString(createElement(MyExamTracker, { exam })),
    ).join('')
    expect(html.match(/去官网打印准考证/g)?.length).toBe(13)
  })
})

describe('T6：无数据改动（数据层守卫）', () => {
  it('十一场 id、节点总数 43、17 个 url 逐字一致，无新增 url，ExamNode 无新增字段', () => {
    expect(EXAMS.map((e) => e.id)).toEqual([
      'guokao',
      'cet',
      'shengkao',
      'jiaoshi-mianshi',
      'jundui-wenzhi',
      'jingkao',
      'kaoyan',
      'chengkao',
      'jiangsu-zikao',
      'guangdong-zikao',
      'shanghai-zikao',
    ])
    expect(EXAMS.flatMap((e) => e.nodes)).toHaveLength(43)
    const byKey = new Map(
      EXAMS.flatMap((e) => e.nodes.map((n) => [`${e.id}:${n.label}`, n] as const)),
    )
    expect(byKey.size).toBe(43)
    for (const [examId, label, url] of EXPECTED_URLS) {
      expect(byKey.get(`${examId}:${label}`)?.url).toBe(url)
    }
    expect(EXAMS.flatMap((e) => e.nodes).filter((n) => n.url)).toHaveLength(17)
    // U-144：江苏两节点不挂 url；广东自考查询节点挂线上系统直链（U-87），
    // url 总数 16→17。U-163：上海两节点不挂 url（无网页深链可挂），url 总数仍 17。
    // U-164：海南查分不挂 url（U-102 口径），url 总数仍 17。
    // U-160：山西复核不挂 url（sxkszx.cn 未证实可达），url 总数仍 17，节点总数 41→42。
    // U-162：天津复核不挂 url（招考资讯网未直读到官方原文），url 总数仍 17，节点总数 42→43。
    expect(byKey.get('chengkao:天津成绩复核')?.url).toBeUndefined()
    expect(byKey.get('jiangsu-zikao:成绩查询')?.url).toBeUndefined()
    expect(byKey.get('jiangsu-zikao:成绩复核')?.url).toBeUndefined()
    expect(byKey.get('guangdong-zikao:成绩查询')?.url).toBe(GUANGDONG_ZIKAO_SCORE_URL)
    expect(byKey.get('shanghai-zikao:成绩查询')?.url).toBeUndefined()
    expect(byKey.get('shanghai-zikao:成绩复核')?.url).toBeUndefined()
    expect(byKey.get('chengkao:海南成绩查询')?.url).toBeUndefined()
    for (const node of EXAMS.flatMap((e) => e.nodes)) {
      for (const key of Object.keys(node)) {
        expect(['label', 'detail', 'url', 'startISO', 'endISO', 'estimated']).toContain(key)
      }
      expect(node.label).toBeTruthy()
      expect(node.detail).toBeTruthy()
      expect(node.startISO).toBeTruthy()
      expect(node.endISO).toBeTruthy()
    }
    // label 键安全性锁死：国考/省考的「公共科目笔试」无 url，不渲染链接。
    expect(byKey.get('guokao:公共科目笔试')?.url).toBeUndefined()
    expect(byKey.get('shengkao:公共科目笔试')?.url).toBeUndefined()
  })
})

describe('T7：链接安全属性不变', () => {
  it('全部 17 个链接均有 target="_blank" 与 rel="noopener noreferrer"，href 均过 safeHref', () => {
    const links = allLinks()
    expect(links).toHaveLength(17)
    const urlByKey = new Map(EXPECTED_URLS.map(([e, l, u]) => [`${e}:${l}`, u]))
    for (const link of links) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noopener noreferrer')
      expect(link.href).toBe(safeHref(urlByKey.get(`${link.examId}:${link.label}`)!))
    }
  })
})

describe('T8：源码硬编码不回潮', () => {
  it('「去官网打印准考证」只出现一次且位于映射函数内，四处例外文案各出现一次', () => {
    const island = read('src/app/exam/my-exam-tracker.tsx')
    expect(island.match(/去官网打印准考证/g)?.length).toBe(1)
    expect(island).toContain('function nodeLinkCopy')
    const fnAt = island.indexOf('function nodeLinkCopy')
    const defaultAt = island.indexOf('去官网打印准考证')
    expect(fnAt).toBeGreaterThan(-1)
    expect(defaultAt).toBeGreaterThan(fnAt)
    expect(island.match(/去官网报名/g)?.length).toBe(1)
    expect(island.match(/查看官方公告/g)?.length).toBe(1)
    expect(island.match(/去报名系统申请复核/g)?.length).toBe(1)
    expect(island.match(/去系统查成绩/g)?.length).toBe(1)
    // 映射表恰好覆盖 4 个例外 label + 默认分支，不写死域名。
    expect(island).toContain("label === '报名'")
    expect(island).toContain("label === '公共科目笔试'")
    expect(island).toContain("label === '江西成绩复核'")
    expect(island).toContain("label === '成绩查询'")
    expect(island).not.toContain('rsj.beijing.gov.cn')
    expect(island).not.toContain('beijing.gov.cn')
    expect(island).not.toContain('jdyw.jxeea.cn')
    expect(island).not.toContain('eeagd.edu.cn')
  })
})
