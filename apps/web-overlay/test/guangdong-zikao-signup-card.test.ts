/**
 * C4 广东自考报名报考卡（2027 年 1 月考期）单元测试 — W4（2026-11-23 10:22 轮）。
 *
 * 依据（只认这两份，不得自创 API）：
 *  - 主设计 0922-w2.md §4.2 七相位 P0–P6、§4.3 的 18 个点、§4.5 验收 C4-G1–C4-G7。
 *  - W2 决策定稿 1022-w2.md：D1–D4 已裁决（P3 弱提醒无 CTA；nearest 接受；点击不记录；
 *    C4 不等 C1、C1 在上 C4 在下）、§5.3 phase 签名与返回值、§5.4 组件 props 与
 *    `guangdongZikaoSignupCardCopy` 返回结构、§5.5 逐相位文案表、§5.6 高度预算 220px、
 *    §5.7 的 18 个点、§5.8 改写后的 C4-G3/C4-G6。
 *
 * import 契约（全部以 W2 定稿为准，仓库内逐项核实）：
 *  - `guangdongZikaoSignupPhase(nowMs)` + 类型 `GuangdongZikaoSignupPhase`
 *    （`../src/lib/exam-calendar`）：返回值 'signup' | 'signup-last-call' |
 *    'waiting' | 'apply' | 'pay-last-call' | null（1022-W2 §5.3）。
 *  - `guangdongZikaoSignupCardCopy(phase)`（`../src/components/guangdong-zikao-signup-card`）：
 *    返回 { badge, title, statusLines[], subLines[], ctaLabel: string | null,
 *    antiFraudLine }（1022-W2 §5.4）。
 *  - `GuangdongZikaoSignupCard()` 无 props（1022-W2 §5.4，门控与 tick 在组件内含）。
 *  - 新条目 id `guangdong-zikao-2027-01`，短名 '广东自考·1月'（1022-W2 §5.2 定稿）。
 *
 * 本文件落笔时 W3 实现状态（2026-11-23 10:40 CST 实测，overlay 工作树，未提交）：
 *  - phase 函数、copy 函数、组件、挂载均已按 1022-W2 重写对齐；落笔过程中 W3 还在改
 *    （本文件初稿读到的旧版组件与定稿多处不符，半小时后重读已全部对齐，挂载的
 *    `GuangdongZikaoSignupCardIsland` 引用也在落笔期间被 W3 改回 `GuangdongZikaoSignupCard`）。
 *  - 剩余两项与定稿不一致（见 W4 笔记 §2，本文件对应断言目前为红，属预期）：
 *    ① 新条目缺“考试”节点（1022-W2 §5.2 要求 5 个节点，实装 4 个）；
 *    ② tagline 微调 '新生报名 11 月 24 日 10:00 开始'（1022-W2 建议 '新生报名 11 月 24 日开始'，
 *    可微调但须复审确认；本文件只断言含 '11 月 24 日'，不逐字断言）。
 *  - 另：实现目前只在 overlay 树（`apps/web` 树内 phase/条目/组件/挂载全无），
 *    vitest 只收 `apps/web/test/**`，故 W7 跑本文件前须先 `pnpm mirror:web`
 *    （overlay → web，见 W4 笔记 §7）。
 *
 * 不猜的清单（定稿未给，不写进 expect）：
 *  - 节点 detail 文案逐字（1022-W2 §5.2 只定 label/日期/url，不定 detail 措辞）。
 *  - tagline 逐字（1022-W2 标“建议”，可微调）。
 *  - 390px 实测高度 220px 是预算值（1022-W2 §5.6，待 live L1 实测）：单测只能断言
 *    决定高度的行数/字号结构代理（见 C4-G6 段），高度本身以 it.todo 记 live 待测。
 *
 * 时刻构造：`shanghaiMidnightMs(日期) + 分钟数`（1022-W2 §5.7 模式）；边界含整点本身
 * （10:00:00 即进入该相位、17:00:00 即离开，与 guokaoAdmissionPhase 的 15:00 同款语义）。
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  GUANGDONG_ZIKAO_SCORE_URL,
  guangdongZikaoSignupPhase,
  shanghaiMidnightMs,
} from '../src/lib/exam-calendar'
import {
  GuangdongZikaoSignupCard,
  guangdongZikaoSignupCardCopy,
} from '../src/components/guangdong-zikao-signup-card'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/**
 * 去掉 // 行注释与 /* *\/ 块注释后再做 grep 守卫：禁写清单针对渲染/执行的代码，
 * 注释里复述禁令（如“不得写‘距广东自考 N 天’”“无 text-xs 正文”）不算违规。
 * 行注释正则要求 // 前不是 :，不误伤字符串里的 https://。
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** 北京时间某日 h:m（整点边界用 h:00） */
const at = (date: string, h: number, m = 0) =>
  shanghaiMidnightMs(date) + (h * 60 + m) * 60 * 1000

// ---- 18 个点用到的时刻（全部北京时间）----
// #1  2026-11-23 09:59（窗口未开）
const NOV_23_0959 = at('2026-11-23', 9, 59)
// #2  2026-11-24 09:59（开窗前 1 分钟）
const NOV_24_0959 = at('2026-11-24', 9, 59)
// #3  2026-11-24 10:00（开窗整点，进入 P1）
const NOV_24_1000 = at('2026-11-24', 10, 0)
// #4  2026-11-26 23:59（P1 日内不翻相位）
const NOV_26_2359 = at('2026-11-26', 23, 59)
// #5  2026-11-27 11:59（预报名截止前 1 分钟，仍是 P1）
const NOV_27_1159 = at('2026-11-27', 11, 59)
// #6  2026-11-27 12:00（预报名截止整点，进入 P2）
const NOV_27_1200 = at('2026-11-27', 12, 0)
// #7  2026-11-27 16:59（P2 末班前 1 分钟）
const NOV_27_1659 = at('2026-11-27', 16, 59)
// #8  2026-11-27 17:00（正式报名截止整点，进入 P3）
const NOV_27_1700 = at('2026-11-27', 17, 0)
// #9  2026-11-30 12:00（gap 期内）
const NOV_30_1200 = at('2026-11-30', 12, 0)
// #10 2026-12-01 13:59（报考开始前 1 分钟）
const DEC_01_1359 = at('2026-12-01', 13, 59)
// #11 2026-12-01 14:00（报考开始整点，进入 P4）
const DEC_01_1400 = at('2026-12-01', 14, 0)
// #12 2026-12-02 10:00（缴费开始，不切相位）
const DEC_02_1000 = at('2026-12-02', 10, 0)
// #13 2026-12-04 17:00（报考截止整点，进入 P5）
const DEC_04_1700 = at('2026-12-04', 17, 0)
// #13 前 1 分钟：2026-12-04 16:59（仍是 P4）
const DEC_04_1659 = at('2026-12-04', 16, 59)
// #14 2026-12-05 16:59（P5 末班前 1 分钟）
const DEC_05_1659 = at('2026-12-05', 16, 59)
// #15 2026-12-05 17:00（缴费截止整点，整卡消失）
const DEC_05_1700 = at('2026-12-05', 17, 0)
// #16 2026-12-06 00:00（窗口后）
const DEC_06_0000 = at('2026-12-06', 0, 0)

describe('guangdongZikaoSignupPhase（北京时间门控，七相位 P0–P6，1022-W2 §5.3）', () => {
  it('#1/#2 窗口未开不渲染：11-23 09:59 与 11-24 09:59 均为 null', () => {
    expect(guangdongZikaoSignupPhase(NOV_23_0959)).toBeNull()
    expect(guangdongZikaoSignupPhase(NOV_24_0959)).toBeNull()
  })

  it('#3 开窗整点进入 P1 signup：11-24 10:00 为 signup', () => {
    expect(guangdongZikaoSignupPhase(NOV_24_1000)).toBe('signup')
  })

  it('#4/#5 P1 日内不翻相位：11-26 23:59 与 11-27 11:59 均为 signup', () => {
    expect(guangdongZikaoSignupPhase(NOV_26_2359)).toBe('signup')
    expect(guangdongZikaoSignupPhase(NOV_27_1159)).toBe('signup')
  })

  it('#6/#7 预报名截止切 P2 signup-last-call：11-27 12:00 与 16:59 均为 signup-last-call', () => {
    expect(guangdongZikaoSignupPhase(NOV_27_1200)).toBe('signup-last-call')
    expect(guangdongZikaoSignupPhase(NOV_27_1659)).toBe('signup-last-call')
  })

  it('#8/#9/#10 gap 期为 P3 waiting（D1 定稿：弱提醒，无 CTA）：11-27 17:00、11-30 12:00、12-01 13:59 均为 waiting', () => {
    expect(guangdongZikaoSignupPhase(NOV_27_1700)).toBe('waiting')
    expect(guangdongZikaoSignupPhase(NOV_30_1200)).toBe('waiting')
    expect(guangdongZikaoSignupPhase(DEC_01_1359)).toBe('waiting')
  })

  it('#11/#12 报考开始切 P4 apply：12-01 14:00 与缴费开始 12-02 10:00 均为 apply（缴费开始不切相位）', () => {
    expect(guangdongZikaoSignupPhase(DEC_01_1400)).toBe('apply')
    expect(guangdongZikaoSignupPhase(DEC_02_1000)).toBe('apply')
  })

  it('#13/#14 报考截止切 P5 pay-last-call：12-04 17:00 与 12-05 16:59 均为 pay-last-call', () => {
    expect(guangdongZikaoSignupPhase(DEC_04_1700)).toBe('pay-last-call')
    expect(guangdongZikaoSignupPhase(DEC_05_1659)).toBe('pay-last-call')
  })

  it('#15/#16 窗口后整卡消失：12-05 17:00 整点（含本身）与 12-06 00:00 均为 null', () => {
    expect(guangdongZikaoSignupPhase(DEC_05_1700)).toBeNull()
    expect(guangdongZikaoSignupPhase(DEC_06_0000)).toBeNull()
  })
})

describe('六处相位切换时刻：前后各 1 分钟（1022-W2 §5.7，含 6 个时刻边界）', () => {
  it('11-24 10:00（null→signup）、11-27 12:00（signup→signup-last-call）、11-27 17:00（→waiting）、12-01 14:00（→apply）、12-04 17:00（→pay-last-call）、12-05 17:00（→null）前后 1 分钟必翻态', () => {
    expect(guangdongZikaoSignupPhase(NOV_24_0959)).toBeNull()
    expect(guangdongZikaoSignupPhase(NOV_24_1000)).toBe('signup')
    expect(guangdongZikaoSignupPhase(NOV_27_1159)).toBe('signup')
    expect(guangdongZikaoSignupPhase(NOV_27_1200)).toBe('signup-last-call')
    expect(guangdongZikaoSignupPhase(NOV_27_1659)).toBe('signup-last-call')
    expect(guangdongZikaoSignupPhase(NOV_27_1700)).toBe('waiting')
    expect(guangdongZikaoSignupPhase(DEC_01_1359)).toBe('waiting')
    expect(guangdongZikaoSignupPhase(DEC_01_1400)).toBe('apply')
    expect(guangdongZikaoSignupPhase(DEC_04_1659)).toBe('apply')
    expect(guangdongZikaoSignupPhase(DEC_04_1700)).toBe('pay-last-call')
    expect(guangdongZikaoSignupPhase(DEC_05_1659)).toBe('pay-last-call')
    expect(guangdongZikaoSignupPhase(DEC_05_1700)).toBeNull()
  })
})

describe('guangdongZikaoSignupCardCopy（逐相位文案，1022-W2 §5.5 逐字）', () => {
  const BADGE = '广东自考 · 报名报考'
  const ANTI_FRAUD = '唯一官方入口，认准 eeagd.edu.cn · 新页面打开'

  it('#3/#4/#5 P1 signup：标题 + 双截止行 + 相片审核后缀 + 老生副行 + 报名 CTA', () => {
    expect(guangdongZikaoSignupCardCopy('signup')).toEqual({
      badge: BADGE,
      title: '新生报名进行中',
      statusLines: ['预报名 11 月 27 日 12:00 截止，正式报名同日 17:00 截止；相片审核需时间，别拖到最后一天'],
      subLines: ['老生不用报名，12 月 1 日 14:00 再来报考'],
      ctaLabel: '去广东省自学考试管理系统报名 →',
      antiFraudLine: ANTI_FRAUD,
    })
  })

  it('#6/#7 P2 signup-last-call：今天截止标题 + 预报名已截止 + 未预报名分流句 + 凭预报名号 CTA', () => {
    expect(guangdongZikaoSignupCardCopy('signup-last-call')).toEqual({
      badge: BADGE,
      title: '今天截止：正式报名 17:00 截止',
      statusLines: ['预报名已截止，正式报名今天 17:00 截止，11 月 28 日后不再受理'],
      subLines: ['还没预报名的，本次 1 月考期已无法报名；已拿到预报名号的，今天 17:00 前去正式报名。'],
      ctaLabel: '去正式报名（凭预报名号）→',
      antiFraudLine: ANTI_FRAUD,
    })
  })

  it('#8/#9/#10 P3 waiting：报名已截止 + 报考/缴费开始行 + 分流句延续 + ctaLabel 为 null（D1：无 CTA）', () => {
    expect(guangdongZikaoSignupCardCopy('waiting')).toEqual({
      badge: BADGE,
      title: '报名已截止',
      statusLines: ['报考 12 月 1 日 14:00 开始，缴费 12 月 2 日 10:00 开始'],
      subLines: ['还没预报名的，本次 1 月考期已无法报名；已拿到准考证号的，12 月 1 日 14:00 回来报考'],
      ctaLabel: null,
      antiFraudLine: ANTI_FRAUD,
    })
  })

  it('#11/#12 P4 apply：报考进行中标题 + 双截止行 + 考区/确认/缴费两行副行 + 报考 CTA', () => {
    expect(guangdongZikaoSignupCardCopy('apply')).toEqual({
      badge: BADGE,
      title: '报考进行中 · 最多 4 门',
      statusLines: ['报考 12 月 4 日 17:00 截止；缴费 12 月 2 日 10:00 至 12 月 5 日 17:00'],
      subLines: [
        '每次只限报考一次、只能选一个考区、最多 4 门',
        '一经确认不得增减更改，缴费不退；缴费后须回系统确认已缴费',
      ],
      ctaLabel: '去报考选课 →',
      antiFraudLine: ANTI_FRAUD,
    })
  })

  it('#13/#14 P5 pay-last-call：今天截止标题 + 报考已截止 + 未缴费 = 报考不成功 + 缴费 CTA', () => {
    expect(guangdongZikaoSignupCardCopy('pay-last-call')).toEqual({
      badge: BADGE,
      title: '今天截止：缴费 17:00 截止',
      statusLines: ['报考已截止；未缴费 = 报考不成功'],
      subLines: ['缴费后须回系统确认已缴费'],
      ctaLabel: '去缴费 →',
      antiFraudLine: ANTI_FRAUD,
    })
  })

  it('徽章常驻五相位相同：逐字「广东自考 · 报名报考」，且不含「国考」（防复制 C1 徽章，RW-C4-03）', () => {
    for (const phase of ['signup', 'signup-last-call', 'waiting', 'apply', 'pay-last-call'] as const) {
      const copy = guangdongZikaoSignupCardCopy(phase)
      expect(copy.badge).toBe('广东自考 · 报名报考')
      expect(copy.badge).not.toContain('国考')
    }
  })

  it('防仿冒行常驻五相位相同：逐字「唯一官方入口，认准 eeagd.edu.cn · 新页面打开」（S2 并入防仿冒行）', () => {
    for (const phase of ['signup', 'signup-last-call', 'waiting', 'apply', 'pay-last-call'] as const) {
      expect(guangdongZikaoSignupCardCopy(phase).antiFraudLine).toBe(
        '唯一官方入口，认准 eeagd.edu.cn · 新页面打开',
      )
    }
  })

  it('CTA 文案逐相位不同：P1 全名报名、P2 凭预报名号、P4 报考选课、P5 缴费（RW-C4-01）', () => {
    expect(guangdongZikaoSignupCardCopy('signup').ctaLabel).toBe('去广东省自学考试管理系统报名 →')
    expect(guangdongZikaoSignupCardCopy('signup-last-call').ctaLabel).toBe('去正式报名（凭预报名号）→')
    expect(guangdongZikaoSignupCardCopy('waiting').ctaLabel).toBeNull()
    expect(guangdongZikaoSignupCardCopy('apply').ctaLabel).toBe('去报考选课 →')
    expect(guangdongZikaoSignupCardCopy('pay-last-call').ctaLabel).toBe('去缴费 →')
  })
})

describe('新考期条目 guangdong-zikao-2027-01（1022-W2 §5.2）', () => {
  it('新条目存在：2027 年 1 月考期、短名定稿、考试 2027-01-09–10', () => {
    const entry = EXAMS.find((e) => e.id === 'guangdong-zikao-2027-01')!
    expect(entry).toBeDefined()
    expect(entry.name).toBe('2027 年 1 月广东省高等教育自学考试')
    expect(entry.shortName).toBe('广东自考·1月')
    expect(entry.shortName).not.toBe('广东自考')
    expect(entry.examDateLabel).toBe('1 月 9–10 日')
    expect(entry.startISO).toBe('2027-01-09')
    expect(entry.endISO).toBe('2027-01-10')
    // tagline 是“建议”可微调（1022-W2 §5.2），只断言含开窗日，不逐字断言。
    expect(entry.tagline).toContain('11 月 24 日')
    expect(entry.tagline).toContain('报名')
  })

  it('新条目在旧条目之后（1022-W2 §5.2 位置定稿；决定 exam-page.test.ts:183 的追加顺序）', () => {
    const oldIdx = EXAMS.findIndex((e) => e.id === 'guangdong-zikao')
    const newIdx = EXAMS.findIndex((e) => e.id === 'guangdong-zikao-2027-01')
    expect(newIdx).toBe(oldIdx + 1)
  })

  it('新条目 5 个节点：label 与起止日期逐字一致（1022-W2 §5.2），url 一律挂复用常量', () => {
    const entry = EXAMS.find((e) => e.id === 'guangdong-zikao-2027-01')!
    expect(entry.nodes).toHaveLength(5)
    expect(entry.nodes.map((n) => n.label)).toEqual([
      '新生预报名',
      '正式报名',
      '考生报考',
      '网上缴费',
      '考试',
    ])
    expect(entry.nodes.map((n) => [n.startISO, n.endISO])).toEqual([
      ['2026-11-24', '2026-11-27'],
      ['2026-11-24', '2026-11-27'],
      ['2026-12-01', '2026-12-04'],
      ['2026-12-02', '2026-12-05'],
      ['2027-01-09', '2027-01-10'],
    ])
    for (const n of entry.nodes) {
      expect(n.url).toBe(GUANGDONG_ZIKAO_SCORE_URL)
      expect(n.detail.length).toBeGreaterThan(0)
    }
  })

  it('新条目不设打印与成绩节点（无确切日，不得编造；1022-W2 §5.2）', () => {
    const entry = EXAMS.find((e) => e.id === 'guangdong-zikao-2027-01')!
    expect(entry.nodes.some((n) => n.label.includes('打印'))).toBe(false)
    expect(entry.nodes.some((n) => n.label.includes('成绩'))).toBe(false)
  })

  it('旧条目 guangdong-zikao 不动：仍是 2026 年 10 月考期 + 唯一成绩查询节点', () => {
    const old = EXAMS.find((e) => e.id === 'guangdong-zikao')!
    expect(old.name).toBe('2026 年 10 月广东省高等教育自学考试')
    expect(old.shortName).toBe('广东自考')
    expect(old.startISO).toBe('2026-10-24')
    expect(old.endISO).toBe('2026-10-25')
    expect(old.nodes).toHaveLength(1)
    expect(old.nodes[0].label).toBe('成绩查询')
    expect(old.nodes[0].startISO).toBe('2026-11-18')
    expect(old.nodes[0].endISO).toBe('2026-11-18')
    expect(old.nodes[0].url).toBe(GUANGDONG_ZIKAO_SCORE_URL)
  })
})

describe('#17 CTA 外链（1022-W2 §5.5 / §5.7 点 17）', () => {
  it('入口常量值就是官方系统直链（已核实，0922-W2 §2.2）', () => {
    expect(GUANGDONG_ZIKAO_SCORE_URL).toBe('https://www.eeagd.edu.cn/selfec/')
  })

  it('组件 CTA 走 safeHref(常量)、带 target="_blank" rel="noopener noreferrer"，且整卡只有一个 <a>', () => {
    const src = read('src/components/guangdong-zikao-signup-card.tsx')
    expect(src).toContain('safeHref(GUANGDONG_ZIKAO_SCORE_URL)')
    expect(src).toContain('target="_blank"')
    expect(src).toContain('rel="noopener noreferrer"')
    // href 不得写死完整 URL 字面量（常量是唯一事实源）；可见的防仿冒行只写域名不带协议。
    expect(src).not.toContain('href="https://www.eeagd.edu.cn/selfec/"')
    expect(src).not.toContain("href='https://www.eeagd.edu.cn/selfec/'")
    expect(src).not.toContain('https://www.eeagd.edu.cn/selfec/')
    // 整卡只有一个链接（P3 无链接靠 ctaLabel 条件渲染，见下一条）。
    expect(src.match(/<a[\s>]/g)).toHaveLength(1)
  })

  it('P3 渲染中无 <a> CTA：copy 的 ctaLabel 为 null，且组件只在 ctaLabel 非空时渲染链接', () => {
    expect(guangdongZikaoSignupCardCopy('waiting').ctaLabel).toBeNull()
    const src = read('src/components/guangdong-zikao-signup-card.tsx')
    expect(src).toContain('copy.ctaLabel ? (')
    expect(src).toContain(') : null}')
  })
})

describe('#18 / C4-G4 / C4-G5 / D3 禁写清单（源码 grep 守卫，注释已剥离）', () => {
  /** 全部五相位的用户可见文案拼在一起：禁写清单首先针对读卡片的人看到的字。 */
  const allCopyText = (
    ['signup', 'signup-last-call', 'waiting', 'apply', 'pay-last-call'] as const
  )
    .map((phase) => {
      const c = guangdongZikaoSignupCardCopy(phase)
      return [c.badge, c.title, ...c.statusLines, ...c.subLines, c.ctaLabel ?? '', c.antiFraudLine].join('\n')
    })
    .join('\n')

  it('卡片文案不得有“距广东自考 N 天”“距截止 0 天”“下次再来”类写死字面量（C4-G4）', () => {
    expect(allCopyText).not.toContain('距广东自考')
    expect(allCopyText).not.toContain('距截止')
    expect(allCopyText).not.toContain('下次再来')
    expect(allCopyText).not.toContain('下次 4 月')
  })

  it('卡片文案不得编造未官宣日期：无准考证打印确切日、无成绩公布确切日、无各科时段（C4-G5）', () => {
    expect(allCopyText).not.toContain('12 月 30 日')
    expect(allCopyText).not.toContain('9:00–11:30')
    expect(allCopyText).not.toContain('14:30–17:00')
    // 考试日只许写双源已核实的“2027 年 1 月 9–10 日”，不许写成单日
    expect(allCopyText).not.toContain('2027 年 1 月 9 日')
    expect(allCopyText).not.toContain('2027 年 1 月 10 日')
  })

  it('组件源码（剥离注释后）不得有上述禁写字面量，也不得调点击记录函数（D3 grep 守卫）', () => {
    const code = stripComments(read('src/components/guangdong-zikao-signup-card.tsx'))
    expect(code).not.toContain('距广东自考')
    expect(code).not.toContain('距截止')
    expect(code).not.toContain('下次再来')
    expect(code).not.toContain('12 月 30 日')
    expect(code).not.toContain('9:00–11:30')
    expect(code).not.toContain('14:30–17:00')
    // D3 定稿 (a) 不记录：不得调用 reportClick / recordOfflineVisit，不得用 in-site: 前缀。
    // 断言调用形态（带括号 / 带引号前缀），注释里复述禁令不算违规。
    expect(code).not.toContain('reportClick(')
    expect(code).not.toContain('recordOfflineVisit(')
    expect(code).not.toMatch(/['"]in-site:/)
  })

  it('门控不得另写日期字面量：组件源码（剥离注释后）不含门控日期，只认 phase 函数', () => {
    const code = stripComments(read('src/components/guangdong-zikao-signup-card.tsx'))
    expect(code).toContain('guangdongZikaoSignupPhase')
    expect(code).not.toMatch(/2026-11-24/)
    expect(code).not.toMatch(/2026-11-27/)
    expect(code).not.toMatch(/2026-12-01/)
    expect(code).not.toMatch(/2026-12-04/)
    expect(code).not.toMatch(/2026-12-05/)
  })

  it('门控日期只活在 phase 函数里：exam-calendar 含 6 个边界时刻构造（1022-W2 §5.3）', () => {
    const calendar = read('src/lib/exam-calendar.ts')
    expect(calendar).toContain("shanghaiMidnightMs('2026-11-24')")
    expect(calendar).toContain("shanghaiMidnightMs('2026-11-27')")
    expect(calendar).toContain("shanghaiMidnightMs('2026-12-01')")
    expect(calendar).toContain("shanghaiMidnightMs('2026-12-04')")
    expect(calendar).toContain("shanghaiMidnightMs('2026-12-05')")
    expect(calendar).toContain('export function guangdongZikaoSignupPhase')
  })
})

describe('C4-G6 手机端可读可点（1022-W2 §5.8 改写版：高度上限 220px）', () => {
  it('容器 aria-label 逐字、标题 sky 档、文案块 basis-full', () => {
    const src = read('src/components/guangdong-zikao-signup-card.tsx')
    expect(src).toContain('aria-label="广东自考 2027 年 1 月报名报考"')
    expect(src).toContain('basis-full sm:basis-0')
    expect(src).toContain('text-sky-700')
  })

  it('正文一律 text-sm：标题与内容行均用 text-sm；text-xs 只许出现在徽章 chip（非正文），剥离注释后恰一次', () => {
    const code = stripComments(read('src/components/guangdong-zikao-signup-card.tsx'))
    expect(code).toContain('text-sm font-semibold')
    expect(code).toContain('mt-0.5 text-sm leading-relaxed text-muted-foreground')
    expect(code).toContain('min-h-11')
    const xs = code.match(/text-xs/g) ?? []
    expect(xs).toHaveLength(1)
    expect(code).toMatch(/<span[^>]*text-xs[^>]*>/)
  })

  it('高度代理（220px 是预算值，实测见 live L1）：各相位行数定死——徽章 1 + 标题 1 + 状态行 + 副行 + 防仿冒 1 + CTA 0/1，不得多行', () => {
    // 行数 = statusLines + subLines 长度；P4 副行 2 行是 S3 定稿上限，其余各 1 行。
    expect(guangdongZikaoSignupCardCopy('signup').statusLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('signup').subLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('signup-last-call').statusLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('signup-last-call').subLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('waiting').statusLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('waiting').subLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('apply').statusLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('apply').subLines).toHaveLength(2)
    expect(guangdongZikaoSignupCardCopy('pay-last-call').statusLines).toHaveLength(1)
    expect(guangdongZikaoSignupCardCopy('pay-last-call').subLines).toHaveLength(1)
  })
})

describe('C4-G7 首页清退守卫（2026-11-24：不再在首页顶置堆叠考试公告卡，保留在 /exam 考历入口）', () => {
  it('首页 navigation-content.tsx 与 /brief 均不挂载该卡', () => {
    const nav = read('src/components/navigation-content.tsx')
    expect(nav).not.toContain('@/components/guangdong-zikao-signup-card')
    expect(nav).not.toContain('<GuangdongZikaoSignupCardContent')
    const brief = read('src/app/brief/page.tsx')
    expect(brief).not.toContain('guangdong-zikao-signup-card')
  })
})

describe('U-436：/exam 考历页挂载（2026-11-27，截止日 11-27 在即）', () => {
  it('/exam 在 guangdong-zikao-2027-01 卡片内挂载该卡（与国考提醒岛同款 per-exam 位）', () => {
    const page = read('src/app/exam/page.tsx')
    expect(page).toContain(
      "import { GuangdongZikaoSignupCard } from '@/components/guangdong-zikao-signup-card'",
    )
    expect(page).toContain(
      "{exam.id === 'guangdong-zikao-2027-01' ? <GuangdongZikaoSignupCard /> : null}",
    )
  })

  it('今天（2026-11-26）处于 signup 相位：文案含 11-27 双截止时刻', () => {
    // 11-26 12:00（上海）仍在预报名窗口内（11-24 10:00 起、11-27 12:00 止）。
    const noon = shanghaiMidnightMs('2026-11-26') + 12 * 3600 * 1000
    expect(guangdongZikaoSignupPhase(noon)).toBe('signup')
    const copy = guangdongZikaoSignupCardCopy('signup')
    expect(copy.statusLines[0]).toContain('11 月 27 日 12:00')
    expect(copy.statusLines[0]).toContain('同日 17:00')
    expect(copy.ctaLabel).toContain('报名')
  })

  it('首页与 /brief 仍不挂载该卡（C4-G7 清退守卫不因 /exam 接线而松动）', () => {
    const nav = read('src/components/navigation-content.tsx')
    expect(nav).not.toContain('@/components/guangdong-zikao-signup-card')
    const brief = read('src/app/brief/page.tsx')
    expect(brief).not.toContain('guangdong-zikao-signup-card')
  })
})

describe('挂载前 null 与 60 秒 tick（U-235 同款，1022-W2 §5.4）', () => {
  it('组件源码：挂载前渲染 null、60 秒 interval + 清理，不许 1 秒 tick', () => {
    const src = read('src/components/guangdong-zikao-signup-card.tsx')
    expect(src).toContain('useState<number | null>(null)')
    expect(src).toContain('if (now === null) return null')
    expect(src).toContain('setInterval(() => setNow(Date.now()), 60_000)')
    expect(src).toContain('clearInterval(timer)')
    expect(src).not.toMatch(/setInterval\([\s\S]{0,80}?,\s*1000\s*\)/)
  })

  it('服务端渲染挂载前为空：GuangdongZikaoSignupCard（无 props）在 renderToString 下渲染 nothing（effects 不跑，now 为 null）', () => {
    expect(renderToString(createElement(GuangdongZikaoSignupCard))).toBe('')
  })
})

describe('待补（不在本文件断言范围，见 W4 笔记）', () => {
  it.todo('渲染级逐相位断言：GuangdongZikaoSignupCardView 未导出，renderToString 无法按相位渲染；待 W3 导出视图（或协调员定其他渲染缝）后补逐相位渲染文本、P3 无 <a>、CTA href/target 渲染断言')
  it.todo('live L1：390px 各相位实测高度 ≤ 220px（1022-W2 §5.6 预算值），实现轮 live 实测后登记实际值；超 220px 回协调员，不许悄悄压字号凑数')
})
