/**
 * N1（2026-11-25 落地）：国考页 urgency 行 + 国家电网 2027 第一批一行。
 *
 * 事实源：0222-W3 已核实——各单位报名 11-25 截止（8 家单位公告一致）、
 * 统一笔试初定 12-06（全国总公告原文“初定”）；zhaopin.sgcc.com.cn
 * 抓取端 HTTP 412（本轮复测仍为 412），真人浏览器未复核，行内只留文字、不挂链。
 *
 * 覆盖：
 *  - sgccBatch1Phase：11-25 当天 'today'（草稿 A）、11-26–12-06 'closed'
 *    （草稿 B），11-25 之前与 12-07 之后 null（行下线）；
 *  - sgccBatch1Copy：草稿 A/B 全文逐项核对（初定、截止日、唯一入口、
 *    防仿冒），禁写项（约 1.95 万人、截止时刻、深链、分步链接）不在场；
 *  - urgency：open 期 strip 与瘦身行均含紧迫感提醒 + 具体理由（截止日就是
 *    公共科目笔试当天），且 U-236 去重口径不变（瘦身行仍不含日期时刻与域名）。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SgccBatch1Row } from '../src/components/sgcc-batch1-row'
import {
  EXAMS,
  admissionReminderFor,
  sgccBatch1Copy,
  sgccBatch1Phase,
} from '../src/lib/exam-calendar'

const guokao = EXAMS.find((e) => e.id === 'guokao')!

/** 北京时间：11-24 / 11-25 / 11-26 / 12-06 / 12-07（均为 CST 正午或 0:00 边界） */
const NOV_24_NOON_CST = Date.UTC(2026, 10, 24, 4, 0, 0)
const NOV_25_0000_CST = Date.UTC(2026, 10, 24, 16, 0, 0)
const NOV_25_NOON_CST = Date.UTC(2026, 10, 25, 4, 0, 0)
const NOV_26_0000_CST = Date.UTC(2026, 10, 25, 16, 0, 0)
const NOV_26_NOON_CST = Date.UTC(2026, 10, 26, 4, 0, 0)
const DEC_06_NOON_CST = Date.UTC(2026, 11, 6, 4, 0, 0)
const DEC_07_0000_CST = Date.UTC(2026, 11, 6, 16, 0, 0)
const NOV_23_NOON_CST = Date.UTC(2026, 10, 23, 4, 0, 0)
const NOV_27_NOON_CST = Date.UTC(2026, 10, 27, 4, 0, 0)

describe('N1：sgccBatch1Phase 按自然日切 A/B，窗口外行下线', () => {
  it('11-25 之前 null；11-25 当天 today；11-26–12-06 closed；12-07 起 null', () => {
    expect(sgccBatch1Phase(NOV_24_NOON_CST)).toBeNull()
    expect(sgccBatch1Phase(NOV_25_0000_CST)).toBe('today')
    expect(sgccBatch1Phase(NOV_25_NOON_CST)).toBe('today')
    expect(sgccBatch1Phase(NOV_26_0000_CST)).toBe('closed')
    expect(sgccBatch1Phase(NOV_26_NOON_CST)).toBe('closed')
    expect(sgccBatch1Phase(DEC_06_NOON_CST)).toBe('closed')
    expect(sgccBatch1Phase(DEC_07_0000_CST)).toBeNull()
  })

  it('sgccBatch1Copy 窗口外返回 null', () => {
    expect(sgccBatch1Copy(NOV_24_NOON_CST)).toBeNull()
    expect(sgccBatch1Copy(DEC_07_0000_CST)).toBeNull()
  })
})

describe('N1：草稿 A/B 全文（0222-W3 §5 逐字）', () => {
  it('草稿 A（11-25 当天）：截至今天 + 初定 + 唯一入口 + 防仿冒声明', () => {
    const copy = sgccBatch1Copy(NOV_25_NOON_CST)!
    expect(copy.phase).toBe('today')
    expect(copy.line).toContain('国家电网 2027 第一批')
    expect(copy.line).toContain('报名截至今天 11-25')
    expect(copy.line).toContain('统一笔试初定 12-06')
    expect(copy.line).toContain('唯一官方报名入口')
    expect(copy.line).toContain('国家电网有限公司人力资源招聘平台')
    expect(copy.line).toContain('https://zhaopin.sgcc.com.cn')
    expect(copy.line).toContain('谨防虚假招聘')
    expect(copy.line).toContain('未授权其他网站、社交媒体、个人发布招聘信息')
    expect(copy.line).toContain('招聘不收取任何费用')
  })

  it('草稿 B（11-26 起）：已截止 + 初定 + 以招聘平台考试公告为准', () => {
    const copy = sgccBatch1Copy(NOV_26_NOON_CST)!
    expect(copy.phase).toBe('closed')
    expect(copy.line).toContain('国家电网 2027 第一批')
    expect(copy.line).toContain('报名已截止（11-25）')
    expect(copy.line).toContain('统一笔试初定 12-06')
    expect(copy.line).toContain('具体时间以招聘平台考试公告为准')
    expect(copy.line).toContain('唯一官方入口')
    expect(copy.line).toContain('https://zhaopin.sgcc.com.cn')
    expect(copy.line).toContain('谨防虚假招聘')
    expect(copy.line).not.toContain('报名截至今天')
  })

  it('两稿禁写项均不在场：总数、截止时刻、深链、分步链接', () => {
    for (const t of [NOV_25_NOON_CST, NOV_26_NOON_CST]) {
      const line = sgccBatch1Copy(t)!.line
      expect(line).not.toContain('1.95')
      expect(line).not.toContain('万人')
      expect(line).not.toContain('24 点')
      expect(line).not.toContain('今晚')
      expect(line).not.toContain('unitPart')
      expect(line).not.toContain('bullet_id')
      expect(line).not.toContain('/login')
      expect(line).not.toContain('/register')
    }
  })
})

describe('N1：国考页 urgency 行（open 期 strip + 瘦身行）', () => {
  it('open 期 strip 含紧迫感提醒 + 具体理由，旧要素不变', () => {
    const open = admissionReminderFor(guokao, NOV_23_NOON_CST)!
    expect(open.phase).toBe('open')
    expect(open.stripLine).toContain('别拖到当天')
    expect(open.stripLine).toContain('截止日就是公共科目笔试当天')
    expect(open.stripLine).toContain('打印已开放')
    expect(open.stripLine).toContain('11 月 29 日 15:00 截止')
    expect(open.stripLine).toContain('登录专题网站 bm.scs.gov.cn/kl2027')
    expect(open.stripLine).not.toContain('15 分钟后不得入场')
  })

  it('open 期瘦身行含紧迫感提醒 + 理由，且 U-236 去重口径不变', () => {
    const slim = admissionReminderFor(guokao, NOV_23_NOON_CST)?.slimCardLine ?? ''
    expect(slim).toContain('别拖到最后一天')
    expect(slim).toContain('截止日就是公共科目笔试当天')
    expect(slim).toContain('逾期无法补打')
    expect(slim).toContain('多打两份备用')
    expect(slim).toContain('开考 15 分钟后不得入场')
    expect(slim).not.toContain('11 月 29 日 15:00')
    expect(slim).not.toContain('11 月 23 日')
    expect(slim).not.toContain('gwy.cpta.com.cn')
    expect(slim).not.toContain('bm.scs.gov.cn')
    expect(slim).not.toContain('报名序号')
    expect(slim).not.toContain('行测 9:00–11:00')
  })

  it('last-call 期 strip 不动（已有“末班提醒”，不重复加紧迫感）', () => {
    const last = admissionReminderFor(guokao, NOV_27_NOON_CST)!
    expect(last.phase).toBe('last-call')
    expect(last.stripLine).toContain('末班提醒')
    expect(last.stripLine).not.toContain('别拖到当天')
    expect(last.stripLine).not.toContain('别拖到最后一天')
  })
})

describe('N1：SgccBatch1Row 客户端岛挂载前渲染 null（SSR 不直出日期敏感文案）', () => {
  it('renderToString 为空（useEffect 未执行，now 为 null）', () => {
    expect(renderToString(createElement(SgccBatch1Row))).toBe('')
  })
})

describe('N1：链接门禁——SGCC 行只留文字、不挂链（源码级守卫）', () => {
  it('sgcc-batch1-row.tsx 源码内无 <a>、Link、href、safeHref', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', 'src/components/sgcc-batch1-row.tsx'), 'utf8')
    expect(src).not.toContain('<a')
    expect(src).not.toContain('Link')
    expect(src).not.toContain('href')
    expect(src).not.toContain('safeHref')
  })

  it('sgccBatch1Copy 文案本身不含任何锚点标记', () => {
    for (const t of [NOV_25_NOON_CST, NOV_26_NOON_CST]) {
      const line = sgccBatch1Copy(t)!.line
      expect(line).not.toContain('<a')
      expect(line).not.toContain('href')
    }
  })
})
