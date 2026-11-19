/**
 * U-235：时刻门控只在挂载/渲染时算一次 → 三处各补 60 秒 tick。
 *  - 国考提醒岛：60 秒 interval，15:00 边界最长迟 1 分钟下线；
 *  - 首页条带：60 秒 tick 只重算 tier / reminder / admission（不碰关注状态）；
 *  - 考前清单 tracker：60 秒 tick，按绝对截止时刻重算行文案（非累减）。
 * 禁用口径不动（U-106 未定：18:00 后复选框是否随之禁用无定论，仍按日期口径）。
 * tick 本身是 setInterval 接线（源码守卫锁定）；边界前后两态由数据层
 * 函数（admissionReminderFor / examNodeDeadlineLabel）用 fake now 锁定。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  admissionReminderFor,
  examNodeDeadlineLabel,
} from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const guokao = EXAMS.find((e) => e.id === 'guokao')!
const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
const jundui = EXAMS.find((e) => e.id === 'jundui-wenzhi')!
const jingkaoApply = jingkao.nodes.find((n) => n.label === '报名')!
const junduiFee = jundui.nodes.find((n) => n.label === '缴费')!

/** 2026-11-29 14:59:59 / 15:00:00 北京时间 */
const NOV_29_145959_CST = Date.UTC(2026, 10, 29, 6, 59, 59)
const NOV_29_150000_CST = Date.UTC(2026, 10, 29, 7, 0, 0)
/** 2026-11-18 17:59:59 / 18:00:00 北京时间 */
const NOV_18_175959_CST = Date.UTC(2026, 10, 18, 9, 59, 59)
const NOV_18_180000_CST = Date.UTC(2026, 10, 18, 10, 0, 0)
/** 2026-11-22 23:59 / 11-23 00:00 北京时间（午夜边界） */
const NOV_22_2359_CST = Date.UTC(2026, 10, 22, 15, 59, 0)
const NOV_23_0000_CST = Date.UTC(2026, 10, 22, 16, 0, 0)

describe('U-235：三处 60 秒 tick 接线（源码守卫）', () => {
  it('国考提醒岛：60 秒 interval + 清理，挂载前仍渲染 null', () => {
    const island = read('src/components/guokao-admission-reminder.tsx')
    expect(island).toContain('setInterval(() => setNow(Date.now()), 60_000)')
    expect(island).toContain('clearInterval(timer)')
    expect(island).toContain('useState<number | null>(null)')
    expect(island).toContain('if (now === null) return null')
    expect(island).toContain('admissionReminderFor(exam, now)')
  })

  it('首页条带：60 秒 tick + 清理，now 是 state（不再是渲染时 Date.now()），关注状态不碰', () => {
    const view = read('src/components/home-exam-strip-view.tsx')
    expect(view).toContain('const [now, setNow] = useState(() => Date.now())')
    expect(view).toContain('setInterval(() => setNow(Date.now()), 60_000)')
    expect(view).toContain('clearInterval(timer)')
    expect(view).not.toContain('const now = Date.now()')
    // tick 只重算派生：tier / reminder / admission 仍用 now，关注状态仍走 useMyExams。
    expect(view).toContain('urgencyTier(exam, now)')
    expect(view).toContain('personal && mounted ? reminderTier(exam, now)')
    expect(view).toContain('admissionReminderFor(exam, now)')
    expect(view).toContain('useMyExams()')
  })

  it('考前清单 tracker：60 秒 tick + 清理，行文案按 tick 的 now 重算；禁用口径不动', () => {
    const tracker = read('src/app/exam/my-exam-tracker.tsx')
    expect(tracker).toContain('const [now, setNow] = useState(() => Date.now())')
    expect(tracker).toContain('setInterval(() => setNow(Date.now()), 60_000)')
    expect(tracker).toContain('clearInterval(timer)')
    expect(tracker).toContain('examNodeDeadlineLabel(exam, node, now)')
    expect(tracker).toContain('examNodeStatus(node, now)')
    expect(tracker).toContain('hasActionableNodes(exam, now)')
    // U-106 未定：禁用仍是日期口径（ended && !hasPendingNodes），不随 18:00 翻。
    expect(tracker).toContain('disabled={ended && !hasPendingNodes}')
    expect(tracker).toContain(
      'disabled={storageBlocked !== null || (ended && !hasPendingNodes && !followed)}',
    )
  })

  it('/exam 页注释不再写「15:00 准点下线」：改为 60 秒 tick、最长迟 1 分钟', () => {
    const page = read('src/app/exam/page.tsx')
    expect(page).toContain('最长迟 1 分钟下线')
    expect(page).not.toContain('15:00 准点下线')
    // 服务端区不动：revalidate 仍是 1 小时。
    expect(page).toContain('export const revalidate = 3600')
  })
})

describe('U-235：常驻页边界前后两态（fake now，数据层）', () => {
  it('14:50 打开 /exam 不刷新，到 15:05 时国考提醒块已消失（15:00 整点下线）', () => {
    expect(admissionReminderFor(guokao, NOV_29_145959_CST)).not.toBeNull()
    expect(admissionReminderFor(guokao, NOV_29_145959_CST)?.phase).toBe('last-call')
    expect(admissionReminderFor(guokao, NOV_29_150000_CST)).toBeNull()
  })

  it('17:50 打开不刷新，到 18:05 时京考报名 / 文职缴费行已翻「已截止」', () => {
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_175959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_175959_CST)).toBeNull()
    expect(examNodeDeadlineLabel(jingkao, jingkaoApply, NOV_18_180000_CST)).toBe('已截止')
    expect(examNodeDeadlineLabel(jundui, junduiFee, NOV_18_180000_CST)).toBe('已截止')
  })

  it('首页条带常驻过午夜：国考提醒 11-22 23:59 仍是预热期，11-23 00:00 翻为已开放', () => {
    expect(admissionReminderFor(guokao, NOV_22_2359_CST)?.phase).toBe('warmup')
    expect(admissionReminderFor(guokao, NOV_23_0000_CST)?.phase).toBe('open')
  })
})
