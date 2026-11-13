/**
 * 考试日历页（/exam）红线测试：
 *  - 倒计时天数按北京时间自然日算，午夜边界正确；
 *  - 考试/节点状态只按已核实的日期翻转，预计日期（考研准考证）不自动标「已结束」；
 *  - 考试清单只含已核实的四场：国考、四六级、省考、考研，不含已考完的
 *    经济师（11-07–08）等过期场次；省考文案不写「联考」；
 *  - 页面外链一律过 safeHref，备考站点从 navigation.json 现读、页面不硬编码
 *    12 条站点地址；canonical 自指 /exam；
 *  - 小字链接不用 text-primary（深色/三皮肤下仅 3.33–4.46:1，不达 AA），
 *    不用 11px 小字与锌灰低对比文字。
 * 真 SSR 直出由端到端实测（临时实例）覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  countdownParts,
  daysUntil,
  examNodeStatus,
  examStatus,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)

describe('daysUntil（北京时间自然日）', () => {
  it('四场考试距 11-13 的天数与日历一致', () => {
    expect(daysUntil('2026-11-29', NOV_13_0800_CST)).toBe(16)
    expect(daysUntil('2026-12-06', NOV_13_0800_CST)).toBe(23)
    expect(daysUntil('2026-12-12', NOV_13_0800_CST)).toBe(29)
    expect(daysUntil('2026-12-19', NOV_13_0800_CST)).toBe(36)
  })

  it('午夜边界：11-28 深夜算 1 天，11-29 零点算 0 天', () => {
    expect(daysUntil('2026-11-29', Date.UTC(2026, 10, 28, 15, 30))).toBe(1)
    expect(daysUntil('2026-11-29', Date.UTC(2026, 10, 28, 16, 0))).toBe(0)
  })

  it('已过的日期为负数', () => {
    expect(daysUntil('2026-11-07', NOV_13_0800_CST)).toBeLessThan(0)
  })
})

describe('examStatus', () => {
  it('考前 upcoming、考试当天 today、考后 ended', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    expect(examStatus(guokao, NOV_13_0800_CST)).toBe('upcoming')
    expect(examStatus(guokao, Date.UTC(2026, 10, 29, 2, 0))).toBe('today')
    expect(examStatus(guokao, Date.UTC(2026, 10, 30, 0, 0))).toBe('ended')
  })

  it('多日考试中间天为 ongoing', () => {
    const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
    expect(examStatus(kaoyan, Date.UTC(2026, 11, 19, 2, 0))).toBe('ongoing')
    expect(examStatus(kaoyan, Date.UTC(2026, 11, 21, 0, 0))).toBe('ended')
  })
})

describe('examNodeStatus', () => {
  it('准考证打印窗口内为进行中，窗口前后翻转', () => {
    const guokao = EXAMS.find((e) => e.id === 'guokao')!
    const admit = guokao.nodes[0]
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 22, 0, 0))).toBe('upcoming')
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 25, 0, 0))).toBe('active')
    expect(examNodeStatus(admit, Date.UTC(2026, 10, 30, 0, 0))).toBe('done')
  })

  it('预计节点（考研准考证）不按日期自动翻转，恒为 estimated', () => {
    const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
    const admit = kaoyan.nodes[0]
    expect(admit.estimated).toBe(true)
    expect(examNodeStatus(admit, NOV_13_0800_CST)).toBe('estimated')
    expect(examNodeStatus(admit, Date.UTC(2026, 11, 15, 0, 0))).toBe('estimated')
  })
})

describe('countdownParts', () => {
  it('25 小时 1 分 1 秒拆成 1 天 1 时 1 分 1 秒', () => {
    expect(countdownParts(90061000, 0)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 })
  })

  it('目标时刻已过则全 0', () => {
    expect(countdownParts(1000, 2000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('考试清单只含已核实的四场', () => {
  it('恰好四场，首日与核实日期一致', () => {
    expect(EXAMS.map((e) => e.id)).toEqual(['guokao', 'cet', 'shengkao', 'kaoyan'])
    expect(EXAMS.map((e) => e.startISO)).toEqual([
      '2026-11-29',
      '2026-12-12',
      '2026-12-06',
      '2026-12-19',
    ])
  })

  it('不含已考完的经济师（11-07–08）等过期场次', () => {
    expect(EXAMS.map((e) => e.startISO)).not.toContain('2026-11-07')
    expect(EXAMS.map((e) => e.startISO)).not.toContain('2026-11-08')
  })

  it('省考文案不写「联考」：六省均为单独招考', () => {
    // 守的是面向用户的文案（考试名/节点/备注/提醒），不是模块注释里的说明句
    const userFacing = [
      ...EXAMS.flatMap((e) => [e.name, e.tagline, e.examDateLabel, e.note ?? '']),
      ...EXAMS.flatMap((e) => e.nodes.flatMap((n) => [n.label, n.detail])),
    ].join('')
    expect(userFacing).not.toContain('联考')
    expect(EXAMS.find((e) => e.id === 'shengkao')?.note).toContain('单独招考')
  })
})

describe('考试日历页源码守卫', () => {
  const page = read('src/app/exam/page.tsx')

  it('canonical 自指 /exam，且为相对路径', () => {
    expect(page).toContain("canonical: '/exam'")
    expect(page).not.toMatch(/canonical:\s*'https?:\/\//)
  })

  it('所有外链都过 safeHref，且带 noopener', () => {
    expect(page).toContain("import { safeHref } from '@/lib/safe-url'")
    expect(page).toContain('rel="noopener noreferrer"')
    expect(page).not.toMatch(/href=\{site\.href\}/)
  })

  it('备考站点从 navigation.json 现读，不硬编码 12 条站点地址', () => {
    expect(page).toContain("EXAM_PREP_CATEGORY_ID")
    expect(page).toContain("EXAM_PREP_SUB_ID")
    expect(page).not.toContain('cet.neea.edu.cn')
    expect(page).not.toContain('yz.chsi.com.cn')
    expect(page).not.toContain('scs.gov.cn')
    expect(page).not.toContain('fenbi.com')
  })

  it('倒计时走客户端岛，服务端 JSX 里不直出天数', () => {
    expect(page).toContain('<ExamCountdown exam={exam} />')
    // 服务端只用 daysUntil 挑「最近一场」（不渲染数字）；天数本身只在岛内算
    expect(page).not.toMatch(/\{daysUntil\(/)
  })

  it('小字不用 text-primary、不用 11px、不用锌灰低对比', () => {
    expect(page).not.toContain('text-primary')
    expect(page).not.toContain('text-[11px]')
    expect(page).not.toMatch(/text-zinc-\d/)
  })

  it('徽章不用 bg-*-500/10 + text-*-600 旧配方（实测不足 AA，改 text-*-700）', () => {
    expect(page).not.toContain('text-sky-600')
  })
})

describe('倒计时岛源码守卫', () => {
  const island = read('src/app/exam/exam-countdown.tsx')

  it('挂载前渲染占位（防 SSR/水合 mismatch），基于时间戳倒计时', () => {
    expect(island).toContain('useState<number | null>(null)')
    expect(island).toContain('setInterval')
    expect(island).toContain('Date.now()')
    expect(island).toContain('countdownParts')
  })
})
