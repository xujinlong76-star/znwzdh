/**
 * 「我的考试」关注 + 考前清单（/exam 第二轮）测试：
 *  - 纯规则层 my-exams.ts：解析收敛、关注开关、节点勾选、进度与下一步；
 *  - 源码守卫：岛只读事实源（不硬编码日期）、挂载后才读 localStorage、
 *    小字与徽章配方合规、按钮 44px、真 checkbox、可勾选只对已关注开放。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXAMS } from '../src/lib/exam-calendar'
import {
  MY_EXAMS_STORAGE_KEY,
  checkedCount,
  isFollowed,
  nearestFollowedExam,
  nextTodoNode,
  nextUncheckedNode,
  parseMyExams,
  toggleFollow,
  toggleNodeCheck,
  type MyExamsState,
} from '../src/lib/my-exams'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const guokao = EXAMS.find((e) => e.id === 'guokao')!
const cet = EXAMS.find((e) => e.id === 'cet')!
const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-25 08:00 北京时间：四六级口试已过，笔试准考证未开 */
const NOV_25_0800_CST = Date.UTC(2026, 10, 25, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
/** 2026-12-20 08:00 北京时间：考研末日，仍算未结束 */
const DEC_20_0800_CST = Date.UTC(2026, 11, 20, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：四场全过 */
const DEC_21_0800_CST = Date.UTC(2026, 11, 21, 0, 0, 0)

describe('parseMyExams（不可信输入收敛）', () => {
  it('null / 非对象 / 空对象都收敛成空状态', () => {
    expect(parseMyExams(null)).toEqual({ followed: [], checked: {} })
    expect(parseMyExams('x')).toEqual({ followed: [], checked: {} })
    expect(parseMyExams({})).toEqual({ followed: [], checked: {} })
  })

  it('合法状态原样通过，重复 id 与 label 去重', () => {
    const parsed = parseMyExams({
      followed: ['guokao', 'guokao', 'kaoyan'],
      checked: { guokao: ['准考证打印', '准考证打印'] },
    })
    expect(parsed).toEqual({
      followed: ['guokao', 'kaoyan'],
      checked: { guokao: ['准考证打印'] },
    })
  })

  it('未知的考试 id 与不属于该考试的节点 label 一律丢掉', () => {
    const parsed = parseMyExams({
      followed: ['guokao', 'economist', 42],
      checked: {
        guokao: ['准考证打印', '不存在的节点'],
        economist: ['笔试'],
        kaoyan: 'not-an-array',
      },
    })
    expect(parsed).toEqual({
      followed: ['guokao'],
      checked: { guokao: ['准考证打印'] },
    })
  })
})

describe('toggleFollow', () => {
  it('关注与取消关注来回切换', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    const on = toggleFollow(empty, 'guokao')
    expect(on.followed).toEqual(['guokao'])
    expect(isFollowed(on, 'guokao')).toBe(true)
    const off = toggleFollow(on, 'guokao')
    expect(off.followed).toEqual([])
  })

  it('未知考试 id 是 no-op', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(toggleFollow(empty, 'economist')).toBe(empty)
  })

  it('取消关注保留勾选（再关注回来还在）', () => {
    const state: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印'] },
    }
    const off = toggleFollow(state, 'guokao')
    expect(off.checked).toEqual({ guokao: ['准考证打印'] })
  })
})

describe('toggleNodeCheck', () => {
  const followed: MyExamsState = { followed: ['guokao'], checked: {} }

  it('勾选与取消勾选来回切换，勾空后 key 消失', () => {
    const on = toggleNodeCheck(followed, 'guokao', '准考证打印')
    expect(on.checked).toEqual({ guokao: ['准考证打印'] })
    const off = toggleNodeCheck(on, 'guokao', '准考证打印')
    expect(off.checked).toEqual({})
  })

  it('未关注的考试勾选是 no-op', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(toggleNodeCheck(empty, 'guokao', '准考证打印')).toBe(empty)
  })

  it('未知考试与不属于该考试的节点是 no-op', () => {
    expect(toggleNodeCheck(followed, 'economist', '笔试')).toBe(followed)
    expect(toggleNodeCheck(followed, 'guokao', '不存在的节点')).toBe(followed)
  })
})

describe('checkedCount / nextUncheckedNode', () => {
  it('进度分子只数该场已勾选的节点', () => {
    const state: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印', '专业科目笔试'] },
    }
    expect(checkedCount(state, guokao)).toBe(2)
    expect(checkedCount(state, kaoyan)).toBe(0)
  })

  it('下一步是按开始日排序的第一个未勾选节点，全部勾完为 undefined', () => {
    const state: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印'] },
    }
    // 准考证打印 11-23 已勾，下一个是 11-28 专业科目笔试（不是 11-29 公共科目）
    expect(nextUncheckedNode(state, guokao)?.label).toBe('专业科目笔试')
    const allDone: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印', '专业科目笔试', '公共科目笔试'] },
    }
    expect(nextUncheckedNode(allDone, guokao)).toBeUndefined()
  })
})

describe('存储键', () => {
  it('键名固定为 navhub.my-exams.v1（改键会丢老用户数据）', () => {
    expect(MY_EXAMS_STORAGE_KEY).toBe('navhub.my-exams.v1')
  })
})

describe('nearestFollowedExam（已关注优先，首页条带挂载后用）', () => {
  it('无关注返回 undefined，调用方回退全局最近场', () => {
    expect(nearestFollowedExam({ followed: [], checked: {} }, NOV_13_0800_CST)).toBeUndefined()
  })

  it('只关注一场未过期就返回它（哪怕它不是全局最近）', () => {
    expect(
      nearestFollowedExam({ followed: ['kaoyan'], checked: {} }, NOV_13_0800_CST)?.id,
    ).toBe('kaoyan')
  })

  it('多场关注取首日最早且未结束的一场', () => {
    const state: MyExamsState = { followed: ['kaoyan', 'guokao'], checked: {} }
    expect(nearestFollowedExam(state, NOV_13_0800_CST)?.id).toBe('guokao')
    // 国考已过后，关注场里最早的是四六级（12-12 在考研 12-19 之前）
    const later: MyExamsState = { followed: ['kaoyan', 'cet'], checked: {} }
    expect(nearestFollowedExam(later, NOV_30_0800_CST)?.id).toBe('cet')
  })

  it('已关注场已结束不顶上来，返回 undefined（调用方回退全局最近场）', () => {
    expect(
      nearestFollowedExam({ followed: ['guokao'], checked: {} }, NOV_30_0800_CST),
    ).toBeUndefined()
  })

  it('多日考试末日仍算未结束（考研 12-20 当天仍优先）', () => {
    expect(
      nearestFollowedExam({ followed: ['kaoyan'], checked: {} }, DEC_20_0800_CST)?.id,
    ).toBe('kaoyan')
  })

  it('四场全过、关注场全部已结束返回 undefined', () => {
    const state: MyExamsState = { followed: ['guokao', 'cet', 'kaoyan'], checked: {} }
    expect(nearestFollowedExam(state, DEC_21_0800_CST)).toBeUndefined()
  })

  it('未知 id 不匹配任何考试', () => {
    expect(
      nearestFollowedExam({ followed: ['economist'], checked: {} }, NOV_13_0800_CST),
    ).toBeUndefined()
  })
})

describe('nextTodoNode（下一步待办：未勾选且未结束）', () => {
  it('未勾选时第一个节点就是待办', () => {
    const state: MyExamsState = { followed: ['guokao'], checked: {} }
    expect(nextTodoNode(state, guokao, NOV_13_0800_CST)?.label).toBe('准考证打印')
  })

  it('勾完一个跳到下一个未勾选节点', () => {
    const state: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印'] },
    }
    expect(nextTodoNode(state, guokao, NOV_13_0800_CST)?.label).toBe('专业科目笔试')
  })

  it('全部未结束节点都勾完返回 undefined（不编假下一步）', () => {
    const state: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印', '专业科目笔试', '公共科目笔试'] },
    }
    expect(nextTodoNode(state, guokao, NOV_13_0800_CST)).toBeUndefined()
  })

  it('已结束但未勾的节点不再算待办', () => {
    // 11-30 时国考三节点已全部结束，哪怕一个没勾也不再是下一步
    const state: MyExamsState = { followed: ['guokao'], checked: {} }
    expect(nextTodoNode(state, guokao, NOV_30_0800_CST)).toBeUndefined()
    // 11-25 时四六级：口试（11-21–22）与口试准考证（11-17）已过未勾，跳到 12-01 笔试准考证
    const cetState: MyExamsState = { followed: ['cet'], checked: {} }
    expect(nextTodoNode(cetState, cet, NOV_25_0800_CST)?.label).toBe('笔试准考证打印')
  })

  it('预计节点也算待办，不因 estimated 被跳过', () => {
    const state: MyExamsState = { followed: ['kaoyan'], checked: {} }
    expect(nextTodoNode(state, kaoyan, NOV_13_0800_CST)?.label).toBe('准考证下载')
  })
})

describe('我的考试岛源码守卫', () => {
  const island = read('src/app/exam/my-exam-tracker.tsx')
  const lib = read('src/lib/my-exams.ts')

  it('纯规则层不调 localStorage API（存储只在岛里发生）', () => {
    expect(lib).not.toMatch(/localStorage\.(getItem|setItem|removeItem)/)
  })

  it('岛只读事实源，不硬编码考试日期与考试 id', () => {
    expect(island).toContain("from '@/lib/exam-calendar'")
    expect(island).not.toContain('2026-11-29')
    expect(island).not.toContain('2026-12-12')
    expect(island).not.toContain('2026-12-06')
    expect(island).not.toContain('2026-12-19')
    expect(island).not.toContain("'guokao'")
    expect(island).not.toContain("'kaoyan'")
  })

  it('存储键只从 lib  import，不在岛里写死字面量', () => {
    expect(island).toContain('MY_EXAMS_STORAGE_KEY')
    expect(island).not.toContain("'navhub.my-exams.v1'")
  })

  it('挂载后才读 localStorage（防 SSR/水合 mismatch），读写各一处', () => {
    expect(island).toContain('useState<MyExamsState | null>(null)')
    expect(island).toContain('useEffect')
    expect(island.indexOf('localStorage.getItem')).toBeGreaterThan(island.indexOf('useEffect'))
    expect(island.match(/localStorage\.getItem/g)?.length).toBe(1)
    expect(island.match(/localStorage\.setItem/g)?.length).toBe(1)
  })

  it('用真 checkbox 勾选，带已完成 aria-label；关注按钮带 aria-pressed', () => {
    expect(island).toContain('type="checkbox"')
    expect(island).toContain('aria-label={`${node.label}已完成`}')
    expect(island).toContain('aria-pressed={followed}')
  })

  it('小字不用 text-primary、不用 11px、不用锌灰；徽章不用旧配方', () => {
    expect(island).not.toContain('text-primary')
    expect(island).not.toContain('text-[11px]')
    expect(island).not.toMatch(/text-zinc-\d/)
    expect(island).not.toContain('text-sky-600')
  })

  it('关注按钮 44px 触摸目标，用 sky-700 合规配方', () => {
    expect(island).toContain('min-h-11')
    expect(island).toContain('text-sky-700')
  })

  it('写明只保存在本机，不承诺云同步', () => {
    expect(island).toContain('关注后可逐项勾选考前清单')
    expect(read('src/app/exam/page.tsx')).toContain('只保存在本机浏览器')
    expect(island).not.toContain('云同步')
    expect(island).not.toContain('登录后同步')
  })
})

describe('考试页接线守卫', () => {
  const page = read('src/app/exam/page.tsx')

  it('每场卡片挂 MyExamTracker，倒计时岛仍在', () => {
    expect(page).toContain("import { MyExamTracker } from './my-exam-tracker'")
    expect(page).toContain('<MyExamTracker exam={exam} />')
    expect(page).toContain('<ExamCountdown exam={exam} />')
  })

  it('静态节点时间轴已移进岛里，页面不再自己算节点状态', () => {
    expect(page).not.toContain('EXAM_NODE_STATUS_LABEL')
    expect(page).not.toContain('examNodeStatus(')
    expect(page).not.toContain('NODE_DOT_CLASS')
  })
})
