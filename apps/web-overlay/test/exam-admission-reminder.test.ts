/**
 * 国考准考证打印提醒红线测试：
 *  - 门控只按北京时间翻：11-15–11-21 倒计时、11-22 预热、11-23–11-26 已开放、
 *    11-27–11-29 15:00 末班，11-15 之前与 11-29 15:00 之后一律不显示；
 *  - 只有国考有提醒，其余三场任何时刻都返回 null（不打扰非考生）；
 *  - 文案全部取自已核实的提醒准备稿 A 版：窗口、报名序号、多打两份备用、
 *    笔试时间一个不少；官方链接是报名确认及准考证打印系统直达
 *    http://gwy.cpta.com.cn（官方 2026-10-25 公告所载，教育在线 2026-10-26
 *    逐字转载，http，不许写成 https）；专题网站门户 http://bm.scs.gov.cn/kl2027
 *    见 GUOKAO_PORTAL_URL，不作打印直链；
 *  - 链接唯一事实源在 exam-calendar 常量里，提醒组件与页面不写死域名，
 *    外链一律过 safeHref、target _blank + noopener。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  GUOKAO_ADMISSION_URL,
  GUOKAO_PORTAL_URL,
  admissionReminderFor,
  examNodeStatus,
  guokaoAdmissionPhase,
  isNodeActionable,
  nextExamNode,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 北京时间 2026-11-14 12:00（UTC 11-14 04:00）：倒计时开始前一天 */
const NOV_14_NOON_CST = Date.UTC(2026, 10, 14, 4, 0, 0)
/** 北京时间 2026-11-15 00:00（UTC 11-14 16:00）：倒计时开始 */
const NOV_15_0000_CST = Date.UTC(2026, 10, 14, 16, 0, 0)
/** 北京时间 2026-11-15 12:00（UTC 11-15 04:00）：距打印开启 8 天 */
const NOV_15_NOON_CST = Date.UTC(2026, 10, 15, 4, 0, 0)
/** 北京时间 2026-11-21 12:00（UTC 11-21 04:00）：预热前一天 */
const NOV_21_NOON_CST = Date.UTC(2026, 10, 21, 4, 0, 0)
/** 北京时间 2026-11-22 00:00（UTC 11-21 16:00）：预热开始 */
const NOV_22_0000_CST = Date.UTC(2026, 10, 21, 16, 0, 0)
/** 北京时间 2026-11-22 23:59 */
const NOV_22_LATE_CST = Date.UTC(2026, 10, 22, 15, 59, 0)
/** 北京时间 2026-11-23 00:00 */
const NOV_23_0000_CST = Date.UTC(2026, 10, 22, 16, 0, 0)
/** 北京时间 2026-11-26 23:59 */
const NOV_26_LATE_CST = Date.UTC(2026, 10, 26, 15, 59, 0)
/** 北京时间 2026-11-27 00:00 */
const NOV_27_0000_CST = Date.UTC(2026, 10, 26, 16, 0, 0)
/** 北京时间 2026-11-29 14:59 */
const NOV_29_1459_CST = Date.UTC(2026, 10, 29, 6, 59, 0)
/** 北京时间 2026-11-29 15:00：截止时刻整，提醒下线 */
const NOV_29_1500_CST = Date.UTC(2026, 10, 29, 7, 0, 0)
/** 北京时间 2026-11-30 08:00 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)

describe('guokaoAdmissionPhase（北京时间门控）', () => {
  it('11-15–11-21 倒计时、11-22 预热、11-23–11-26 已开放、11-27–11-29 15:00 末班，之外不显示', () => {
    expect(guokaoAdmissionPhase(NOV_21_NOON_CST)).toBe('countdown')
    expect(guokaoAdmissionPhase(NOV_22_0000_CST)).toBe('warmup')
    expect(guokaoAdmissionPhase(NOV_22_LATE_CST)).toBe('warmup')
    expect(guokaoAdmissionPhase(NOV_23_0000_CST)).toBe('open')
    expect(guokaoAdmissionPhase(NOV_26_LATE_CST)).toBe('open')
    expect(guokaoAdmissionPhase(NOV_27_0000_CST)).toBe('last-call')
    expect(guokaoAdmissionPhase(NOV_29_1459_CST)).toBe('last-call')
  })

  it('11-15 之前仍不显示：11-14 中午为 null，11-15 0 点整进入倒计时', () => {
    expect(guokaoAdmissionPhase(NOV_14_NOON_CST)).toBeNull()
    expect(guokaoAdmissionPhase(NOV_15_0000_CST)).toBe('countdown')
  })

  it('11-29 15:00 整点下线，之前一分钟仍在末班', () => {
    expect(guokaoAdmissionPhase(NOV_29_1500_CST)).toBeNull()
    expect(guokaoAdmissionPhase(NOV_30_0800_CST)).toBeNull()
  })
})

describe('admissionReminderFor（只对国考）', () => {
  const guokao = EXAMS.find((e) => e.id === 'guokao')!

  it('窗口内返回三档文案：预热说明天开放、开放期说已开放、末班说无法补打', () => {
    const warmup = admissionReminderFor(guokao, NOV_22_0000_CST)!
    expect(warmup.phase).toBe('warmup')
    expect(warmup.stripLine).toContain('明天 0:00 开放打印')
    expect(warmup.cardLine).toContain('11 月 23 日')
    const open = admissionReminderFor(guokao, NOV_23_0000_CST)!
    expect(open.phase).toBe('open')
    expect(open.stripLine).toContain('打印已开放')
    const last = admissionReminderFor(guokao, NOV_27_0000_CST)!
    expect(last.phase).toBe('last-call')
    expect(last.stripLine).toContain('末班提醒')
    expect(last.cardLine).toContain('无法补打')
  })

  it('倒计时档文案：11-15 距打印开启 8 天、11-21 距打印开启 2 天，card 含已核实要素', () => {
    const early = admissionReminderFor(guokao, NOV_15_NOON_CST)!
    expect(early.phase).toBe('countdown')
    expect(early.stripLine).toContain('距打印开启 8 天')
    expect(early.stripLine).toContain('11 月 23 日 0:00 开放打印')
    expect(early.cardLine).toContain('距打印开启 8 天')
    expect(early.cardLine).toContain('11 月 29 日 15:00 截止')
    expect(early.cardLine).toContain('报名序号')
    expect(early.cardLine).toContain('多打两份备用')
    expect(early.cardLine).toContain('行测 9:00–11:00')
    expect(early.cardLine).toContain('不得提前退场（考场规则）')
    expect(early.url).toBe('http://gwy.cpta.com.cn')
    const late = admissionReminderFor(guokao, NOV_21_NOON_CST)!
    expect(late.phase).toBe('countdown')
    expect(late.stripLine).toContain('距打印开启 2 天')
    expect(late.cardLine).toContain('距打印开启 2 天')
  })

  it('三档文案都含已核实的要素：截止、报名序号、多打两份、笔试时间', () => {
    for (const t of [NOV_22_0000_CST, NOV_23_0000_CST, NOV_27_0000_CST]) {
      const r = admissionReminderFor(guokao, t)!
      expect(r.stripLine).toContain('11 月 29 日 15:00 截止')
      expect(r.cardLine).toContain('11 月 29 日 15:00 截止')
      expect(r.cardLine).toContain('报名序号')
      expect(r.cardLine).toContain('多打两份备用')
      expect(r.cardLine).toContain('行测 9:00–11:00')
      expect(r.cardLine).toContain('申论 14:00–17:00')
      // 口径：卡片主句按最早首考日说事，不只讲公共科目 11-29
      expect(r.cardLine).toContain('笔试 11 月 28–29 日')
      expect(r.cardLine).toContain('专业科目 11 月 28 日 14:00–16:00')
    }
  })

  it('三档 card 均含 15 分钟入场规则：新规、去年 30 分钟、最晚入场、不得退场', () => {
    for (const t of [NOV_22_0000_CST, NOV_23_0000_CST, NOV_27_0000_CST]) {
      const r = admissionReminderFor(guokao, t)!
      expect(r.cardLine).toContain('开考 15 分钟后不得入场')
      expect(r.cardLine).toContain('去年为 30 分钟')
      expect(r.cardLine).toContain('行测最晚 8:45')
      expect(r.cardLine).toContain('申论、专业科目最晚 13:45')
      expect(r.cardLine).toContain('不得提前退场')
      expect(r.cardLine).toContain('不得提前退场（考场规则）')
      expect(r.cardLine).toContain('国家公务员局 2027 年度招考公告')
    }
  })

  it('仅末班档 strip 含入场规则短句，预热/开放档 strip 不含（规则只在考前 3 天上首页条带）', () => {
    const warmup = admissionReminderFor(guokao, NOV_22_0000_CST)!
    expect(warmup.stripLine).not.toContain('15 分钟后不得入场')
    const open = admissionReminderFor(guokao, NOV_23_0000_CST)!
    expect(open.stripLine).not.toContain('15 分钟后不得入场')
    const last = admissionReminderFor(guokao, NOV_27_0000_CST)!
    expect(last.stripLine).toContain('开考 15 分钟后不得入场')
    expect(last.stripLine).toContain('行测最晚 8:45')
    expect(last.stripLine).toContain('申论 13:45')
  })

  it('准考证直链是报名确认及准考证打印系统 http://gwy.cpta.com.cn，不许写成 https', () => {
    expect(GUOKAO_ADMISSION_URL).toBe('http://gwy.cpta.com.cn')
    const r = admissionReminderFor(guokao, NOV_23_0000_CST)!
    expect(r.url).toBe('http://gwy.cpta.com.cn')
    expect(r.url).not.toContain('https://')
  })

  it('U-59：准考证节点直链为 gwy 打印系统，门户 bm 链另存常量、不作直链', () => {
    expect(GUOKAO_PORTAL_URL).toBe('http://bm.scs.gov.cn/kl2027')
    const node = guokao.nodes.find((n) => n.label === '准考证打印')!
    expect(node.url).toBe(GUOKAO_ADMISSION_URL)
    expect(node.url).toBe('http://gwy.cpta.com.cn')
    expect(node.url).not.toBe(GUOKAO_PORTAL_URL)
  })

  it('U-98：card/strip 双写两层（专题网站门户 + 打印系统直链），点击目标仍只挂 gwy 直链', () => {
    for (const t of [NOV_15_NOON_CST, NOV_22_0000_CST, NOV_23_0000_CST, NOV_27_0000_CST]) {
      const r = admissionReminderFor(guokao, t)!
      // 两层都写清：门户 bm.scs.gov.cn/kl2027（选「考生考务入口」）与打印系统直达 gwy.cpta.com.cn
      expect(r.cardLine).toContain('登录专题网站 bm.scs.gov.cn/kl2027')
      expect(r.cardLine).toContain('选「考生考务入口」进入打印系统')
      expect(r.cardLine).toContain('直达 gwy.cpta.com.cn')
      expect(r.stripLine).toContain('登录专题网站 bm.scs.gov.cn/kl2027')
      expect(r.stripLine).toContain('选「考生考务入口」进入打印系统')
      expect(r.stripLine).toContain('直达 gwy.cpta.com.cn')
      // 不再用裸「登录专题网站打印」混淆两层；点击目标仍只挂 gwy 直链
      expect(r.cardLine).not.toContain('登录专题网站打印')
      expect(r.url).toBe(GUOKAO_ADMISSION_URL)
      expect(r.url).toBe('http://gwy.cpta.com.cn')
    }
  })

  it('其余三场任何时刻都没有提醒', () => {
    for (const exam of EXAMS.filter((e) => e.id !== 'guokao')) {
      expect(admissionReminderFor(exam, NOV_23_0000_CST)).toBeNull()
      expect(admissionReminderFor(exam, NOV_27_0000_CST)).toBeNull()
    }
  })

  it('国考在窗口外也没有提醒（11-14 与 11-29 15:00 后）', () => {
    expect(admissionReminderFor(guokao, Date.UTC(2026, 10, 14, 0, 0, 0))).toBeNull()
    expect(admissionReminderFor(guokao, NOV_29_1500_CST)).toBeNull()
  })
})

describe('导航站国考专题条目（U-98）', () => {
  function findById(node: unknown, id: string): Record<string, unknown> | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findById(child, id)
        if (found) return found
      }
      return undefined
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      if (obj.id === id) return obj
      for (const value of Object.values(obj)) {
        const found = findById(value, id)
        if (found) return found
      }
    }
    return undefined
  }

  it('国考专题条目 description 改门户口径，不写准考证打印入口', () => {
    const nav = JSON.parse(read('src/navsphere/content/navigation.json'))
    const entry = findById(nav, 'nav-7465492db41a')!
    expect(entry.href).toBe('http://bm.scs.gov.cn/kl2027')
    expect(entry.description).toBe(
      '中央机关及其直属机构2027年度考试录用公务员专题网站：招考公告、报名入口、笔试安排与成绩查询',
    )
    expect(entry.description as string).not.toContain('准考证打印')
  })
})

describe('准考证提醒源码守卫', () => {
  const reminder = read('src/components/guokao-admission-reminder.tsx')
  const page = read('src/app/exam/page.tsx')

  it('提醒组件：链接只走 exam-calendar 常量，不写死域名；外链过 safeHref 且带 noopener', () => {
    expect(reminder).toContain("from '@/lib/exam-calendar'")
    expect(reminder).toContain('safeHref')
    expect(reminder).toContain('rel="noopener noreferrer"')
    expect(reminder).toContain('target="_blank"')
    expect(reminder).not.toContain('bm.scs.gov.cn')
    expect(reminder).not.toContain('kl2027')
    // 组件注释里只许出现「http://」一词（说明用 http 而非 https 的原因），
    // 不许出现任何完整 URL 字面量：完整 URL 的 // 后必跟字母数字
    expect(reminder).not.toMatch(/https?:\/\/[a-zA-Z0-9]/)
  })

  it('提醒组件：挂载前渲染 null（防 SSR/水合午夜边界错位），窗口外渲染 nothing', () => {
    expect(reminder).toContain('useState<number | null>(null)')
    expect(reminder).toContain('if (now === null) return null')
    expect(reminder).toContain('if (!reminder) return null')
  })

  it('/exam 页：只有国考卡片挂提醒岛，官方域名不在页面写死', () => {
    expect(page).toContain('GuokaoAdmissionReminderIsland')
    expect(page).toContain("exam.id === 'guokao' ? <GuokaoAdmissionReminderIsland exam={exam} />")
    expect(page).not.toContain('scs.gov.cn')
    expect(page).not.toContain('bm.scs.gov.cn')
  })
})

describe('广东成绩复核节点（U-110）', () => {
  const chengkao = EXAMS.find((e) => e.id === 'chengkao')!
  /** 北京时间 2026-11-20 10:00（UTC 11-20 02:00）：复核截止日当天上午 */
  const NOV_20_1000_CST = Date.UTC(2026, 10, 20, 2, 0, 0)

  it('节点行存在：单日 2026-11-20，不写 11-19；detail 含 15:00 截止与线下书面申请渠道；url 不设', () => {
    // 广东复查无起始日证实、只知截止 11 月 20 日 15:00，故单日节点 11-20；
    // 11-19 只属于江西复核窗口，不可写进广东节点。detail 沿用 note 原文口径。
    const node = chengkao.nodes.find((n) => n.label === '广东成绩复核')!
    expect(node.startISO).toBe('2026-11-20')
    expect(node.endISO).toBe('2026-11-20')
    expect(node.detail).toContain('11 月 20 日 15:00')
    expect(node.detail).toContain('凭身份证件、准考证到当地县（市、区）招生办书面申请')
    expect(node.detail).toContain('逾期不予受理')
    expect(node.url).toBeUndefined()
  })

  it('以 2026-11-20 10:00 为现在：节点当天可办，nextExamNode 能选中它', () => {
    const node = chengkao.nodes.find((n) => n.label === '广东成绩复核')!
    expect(examNodeStatus(node, NOV_20_1000_CST)).toBe('today')
    expect(isNodeActionable(node, chengkao, NOV_20_1000_CST)).toBe(true)
    // 真实成考的下一步仍是更早开启的新疆复核（11-18 开启）；广东复核的
    // 可选中性用仅含广东两节点的合成考试验证，避免被更早节点遮蔽。
    const guangdongOnly = {
      ...chengkao,
      nodes: chengkao.nodes.filter((n) => n.label.startsWith('广东')),
    }
    expect(nextExamNode(guangdongOnly, NOV_20_1000_CST)?.label).toBe('广东成绩复核')
  })

  it('成考现为七省十一节点：头注释同步改数；证书下载仍只在 note，不作节点', () => {
    expect(chengkao.nodes).toHaveLength(11)
    const calendar = read('src/lib/exam-calendar.ts')
    expect(calendar).toContain('七省十一节点')
    expect(calendar).not.toContain('七省十节点')
    expect(chengkao.nodes.some((n) => n.label.includes('证书'))).toBe(false)
    expect(chengkao.note ?? '').toContain(
      '成绩证书 11 月 28 日 16:00 起可通过官微/支付宝/百度小程序下载打印',
    )
  })
})
