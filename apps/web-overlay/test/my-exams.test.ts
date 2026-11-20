/**
 * 「我的考试」关注 + 考前清单（/exam 第二轮）测试：
 *  - 纯规则层 my-exams.ts：解析收敛、关注开关、节点勾选、进度与下一步；
 *  - 共享 hook useMyExams.ts：挂载后才读 localStorage、读写各一处、
 *    十一场卡片与首页条带共用同一份快照（见 test/use-my-exams.test.ts）；
 *  - 源码守卫：岛只读事实源（不硬编码日期）、岛内无直接存储调用、
 *    小字与徽章配方合规、按钮 44px、真 checkbox、可勾选只对已关注开放。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CET_ADMISSION_URL,
  EXAMS,
  GUOKAO_ADMISSION_URL,
  JIAOSHI_MIANSHI_URL,
  JIANGXI_CHENGKAO_REVIEW_URL,
  JINGKAO_APPLY_URL,
  JINGKAO_NOTICE_URL,
  JUNDUANWENZHI_ADMISSION_URL,
  GUANGDONG_SHENGKAO_ADMISSION_URL,
  JIANGSU_SHENGKAO_ADMISSION_URL,
  SHANDONG_SHENGKAO_ADMISSION_URL,
  SHANGHAI_SHENGKAO_ADMISSION_URL,
  SICHUAN_SHENGKAO_ADMISSION_URL,
  TIANJIN_SHENGKAO_ADMISSION_URL,
  ZHEJIANG_SHENGKAO_ADMISSION_URL,
  examNodeStatus,
  examStatus,
  hasActionableNodes,
  type ExamInfo,
} from '../src/lib/exam-calendar'
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
const shengkao = EXAMS.find((e) => e.id === 'shengkao')!
const jingkao = EXAMS.find((e) => e.id === 'jingkao')!
const kaoyan = EXAMS.find((e) => e.id === 'kaoyan')!
const chengkao = EXAMS.find((e) => e.id === 'chengkao')!

/** 2026-11-13 08:00 北京时间（UTC 午夜） */
const NOV_13_0800_CST = Date.UTC(2026, 10, 13, 0, 0, 0)
/** 2026-11-12 08:00 北京时间：京考报名开始日 */
const NOV_12_0800_CST = Date.UTC(2026, 10, 12, 0, 0, 0)
/** 2026-11-17 08:00 北京时间：成考成绩公布前一日（R1） */
const NOV_17_0800_CST = Date.UTC(2026, 10, 17, 0, 0, 0)
/** 2026-11-18 08:00 北京时间：口试准考证开放次日（U-19 回归）；成考成绩公布日 */
const NOV_18_0800_CST = Date.UTC(2026, 10, 18, 0, 0, 0)
/** 2026-11-19 08:00 北京时间：成考成绩公布次日 */
const NOV_19_0800_CST = Date.UTC(2026, 10, 19, 0, 0, 0)
/** 2026-11-20 08:00 北京时间：浙江成考成绩公布日（考试历写「左右」） */
const NOV_20_0800_CST = Date.UTC(2026, 10, 20, 0, 0, 0)
/** 2026-11-28 08:00 北京时间：天津省考准考证开放日（U-30） */
const NOV_28_0800_CST = Date.UTC(2026, 10, 28, 0, 0, 0)
/** 2026-11-25 08:00 北京时间：四六级口试已过，笔试准考证未开 */
const NOV_25_0800_CST = Date.UTC(2026, 10, 25, 0, 0, 0)
/** 2026-12-02 08:00 北京时间：笔试准考证开放次日（U-19 回归） */
const DEC_02_0800_CST = Date.UTC(2026, 11, 2, 0, 0, 0)
/** 2026-12-01 08:00 北京时间：京考准考证打印开始日 */
const DEC_01_0800_CST = Date.UTC(2026, 11, 1, 0, 0, 0)
/** 2026-12-05 08:00 北京时间：京考公安专业科目笔试日（首考日） */
const DEC_05_0800_CST = Date.UTC(2026, 11, 5, 0, 0, 0)
/** 2026-12-06 08:00 北京时间：省考公共科目笔试日（U-30） */
const DEC_06_0800_CST = Date.UTC(2026, 11, 6, 0, 0, 0)
/** 2026-12-07 08:00 北京时间：省考全部结束次日（U-30） */
const DEC_07_0800_CST = Date.UTC(2026, 11, 7, 0, 0, 0)
/** 2026-11-30 08:00 北京时间：国考已过 */
const NOV_30_0800_CST = Date.UTC(2026, 10, 30, 0, 0, 0)
/** 2026-12-19 08:00 北京时间：考研第一天，已开考 */
const DEC_19_0800_CST = Date.UTC(2026, 11, 19, 0, 0, 0)
/** 2026-12-20 08:00 北京时间：考研末日，仍算未结束 */
const DEC_20_0800_CST = Date.UTC(2026, 11, 20, 0, 0, 0)
/** 2026-12-13 08:00 北京时间：军队文职笔试日 */
const DEC_13_0800_CST = Date.UTC(2026, 11, 13, 0, 0, 0)
/** 2026-12-14 08:00 北京时间：军队文职笔试次日 */
const DEC_14_0800_CST = Date.UTC(2026, 11, 14, 0, 0, 0)
/** 2026-12-21 08:00 北京时间：十一场全过 */
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
    const on = toggleFollow(empty, 'guokao', NOV_13_0800_CST)
    expect(on.followed).toEqual(['guokao'])
    expect(isFollowed(on, 'guokao')).toBe(true)
    const off = toggleFollow(on, 'guokao', NOV_13_0800_CST)
    expect(off.followed).toEqual([])
  })

  it('未知考试 id 是 no-op', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(toggleFollow(empty, 'economist', NOV_13_0800_CST)).toBe(empty)
  })

  it('取消关注保留勾选（再关注回来还在）', () => {
    const state: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印'] },
    }
    const off = toggleFollow(state, 'guokao', NOV_13_0800_CST)
    expect(off.checked).toEqual({ guokao: ['准考证打印'] })
  })

  it('已结束且无可办节点的考试不再接受新关注（纵深防御：岛层按钮已禁用，纯函数层也写不进；U-106：仍有可办节点时放行，见下）', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    // 国考 11-29 已过（11-30 时），考研十一场全过（12-21 时）
    expect(toggleFollow(empty, 'guokao', NOV_30_0800_CST)).toBe(empty)
    expect(toggleFollow(empty, 'kaoyan', DEC_21_0800_CST)).toBe(empty)
  })

  it('已结束的考试仍可取消关注（保留清理出口，不删用户数据）', () => {
    const state: MyExamsState = { followed: ['guokao'], checked: {} }
    const off = toggleFollow(state, 'guokao', NOV_30_0800_CST)
    expect(off.followed).toEqual([])
  })

  it('末日当天仍算未结束：考研 12-20 仍可关注', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    const on = toggleFollow(empty, 'kaoyan', DEC_20_0800_CST)
    expect(on.followed).toEqual(['kaoyan'])
  })
})

describe('toggleNodeCheck', () => {
  const followed: MyExamsState = { followed: ['guokao'], checked: {} }

  it('勾选与取消勾选来回切换，勾空后 key 消失', () => {
    const on = toggleNodeCheck(followed, 'guokao', '准考证打印', NOV_13_0800_CST)
    expect(on.checked).toEqual({ guokao: ['准考证打印'] })
    const off = toggleNodeCheck(on, 'guokao', '准考证打印', NOV_13_0800_CST)
    expect(off.checked).toEqual({})
  })

  it('未关注的考试勾选是 no-op', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(toggleNodeCheck(empty, 'guokao', '准考证打印', NOV_13_0800_CST)).toBe(empty)
  })

  it('未知考试与不属于该考试的节点是 no-op', () => {
    expect(toggleNodeCheck(followed, 'economist', '笔试', NOV_13_0800_CST)).toBe(followed)
    expect(toggleNodeCheck(followed, 'guokao', '不存在的节点', NOV_13_0800_CST)).toBe(followed)
  })

  it('已结束且无可办节点的考试勾选与取消勾选都是 no-op（考前清单只在考前有意义；U-106：仍有可办节点时放行，见下）', () => {
    const ended: MyExamsState = { followed: ['guokao'], checked: {} }
    expect(toggleNodeCheck(ended, 'guokao', '准考证打印', NOV_30_0800_CST)).toBe(ended)
    const checkedEnded: MyExamsState = {
      followed: ['guokao'],
      checked: { guokao: ['准考证打印'] },
    }
    expect(toggleNodeCheck(checkedEnded, 'guokao', '准考证打印', NOV_30_0800_CST)).toBe(
      checkedEnded,
    )
  })
})

describe('U-106：已结束但仍有可办节点时可关注、可勾选', () => {
  it('11-18 未关注成考可关注：统考已结束但三省查分节点当天仍可办', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(examStatus(chengkao, NOV_18_0800_CST)).toBe('ended')
    expect(hasActionableNodes(chengkao, NOV_18_0800_CST)).toBe(true)
    const on = toggleFollow(empty, 'chengkao', NOV_18_0800_CST)
    expect(on.followed).toEqual(['chengkao'])
  })

  it('关注后江西/广东查分节点可勾选，取消勾选也放行', () => {
    const followed: MyExamsState = { followed: ['chengkao'], checked: {} }
    const jiangxi = toggleNodeCheck(followed, 'chengkao', '江西成绩查询', NOV_18_0800_CST)
    expect(jiangxi.checked).toEqual({ chengkao: ['江西成绩查询'] })
    const guangdong = toggleNodeCheck(jiangxi, 'chengkao', '广东成绩查询', NOV_18_0800_CST)
    expect(guangdong.checked).toEqual({ chengkao: ['江西成绩查询', '广东成绩查询'] })
    const uncheck = toggleNodeCheck(guangdong, 'chengkao', '江西成绩查询', NOV_18_0800_CST)
    expect(uncheck.checked).toEqual({ chengkao: ['广东成绩查询'] })
  })

  it('11-30 仍有可办节点（U-279 天津结果查询末日）；12-01 恢复禁用：节点全过后新关注与勾选都是 no-op', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    // U-279：天津成绩复核结果查询 11-25→11-30，11-30 当天仍可办，下一步即该节点
    expect(hasActionableNodes(chengkao, NOV_30_0800_CST)).toBe(true)
    expect(nextTodoNode({ followed: ['chengkao'], checked: {} }, chengkao, NOV_30_0800_CST)?.label).toBe('天津成绩复核结果查询')
    expect(toggleFollow(empty, 'chengkao', NOV_30_0800_CST).followed).toEqual(['chengkao'])
    // 12-01：全部节点已过，无可办节点，恢复禁用
    expect(hasActionableNodes(chengkao, DEC_01_0800_CST)).toBe(false)
    expect(toggleFollow(empty, 'chengkao', DEC_01_0800_CST)).toBe(empty)
    const followed: MyExamsState = { followed: ['chengkao'], checked: {} }
    expect(toggleNodeCheck(followed, 'chengkao', '江西成绩查询', DEC_01_0800_CST)).toBe(followed)
  })

  it('11-30 已关注仍可取消关注（清理出口不受恢复禁用影响），勾选随状态保留', () => {
    const state: MyExamsState = {
      followed: ['chengkao'],
      checked: { chengkao: ['江西成绩查询'] },
    }
    const off = toggleFollow(state, 'chengkao', NOV_30_0800_CST)
    expect(off.followed).toEqual([])
    expect(off.checked).toEqual({ chengkao: ['江西成绩查询'] })
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

  it('十一场全过、关注场全部已结束返回 undefined', () => {
    const state: MyExamsState = { followed: ['guokao', 'cet', 'kaoyan'], checked: {} }
    expect(nearestFollowedExam(state, DEC_21_0800_CST)).toBeUndefined()
  })

  it('未知 id 不匹配任何考试', () => {
    expect(
      nearestFollowedExam({ followed: ['economist'], checked: {} }, NOV_13_0800_CST),
    ).toBeUndefined()
  })

  it('排序按首考日：加试考试（首考日早、公共科目首日晚）排在无加试考试之前', () => {
    // 2026-11-16 0922 C 线：与 nearestExam 同口径的合成数据——A 公共科目
    // 首日 12-01 但有加试、首考日 11-20；B 无加试、首日 11-25。按 startISO
    // 排会先挑 B，按首考日排应先挑 A。真实数据里国考与京考首考日
    // ≠ startISO（京考首考日 12-05 早于省考 12-06；11-30 起最近场现为
    // 教资面试，与京考同日首考、数组在前）。
    const examA: ExamInfo = {
      id: 'exam-a',
      name: '合成考试 A',
      shortName: 'A',
      tagline: '',
      examDateLabel: '12 月 1 日',
      startISO: '2026-12-01',
      endISO: '2026-12-01',
      firstExamDayISO: '2026-11-20',
      nodes: [],
    }
    const examB: ExamInfo = {
      id: 'exam-b',
      name: '合成考试 B',
      shortName: 'B',
      tagline: '',
      examDateLabel: '11 月 25 日',
      startISO: '2026-11-25',
      endISO: '2026-11-25',
      nodes: [],
    }
    const state: MyExamsState = { followed: ['exam-a', 'exam-b'], checked: {} }
    expect(nearestFollowedExam(state, NOV_13_0800_CST, [examB, examA])?.id).toBe(
      'exam-a',
    )
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
    // 11-25 时四六级：口试（11-21–22）与口试准考证（11-17–22）已过未勾，跳到 12-01 笔试准考证
    const cetState: MyExamsState = { followed: ['cet'], checked: {} }
    expect(nextTodoNode(cetState, cet, NOV_25_0800_CST)?.label).toBe('笔试准考证打印')
  })

  it('U-19 回归：准考证节点 endISO 为考试日而非开放日，开放次日仍是待办', () => {
    // 曾误写 endISO = 开放日：口试准考证 11-18、笔试准考证 12-02 即误标「已结束」。
    // 修后口试准考证 11-17–22、笔试准考证 12-01–12，开放次日仍 active；
    // 开放日当天节点由单日「今天」变为多日「进行中」，文案可接受。
    const cetState: MyExamsState = { followed: ['cet'], checked: {} }
    expect(nextTodoNode(cetState, cet, NOV_18_0800_CST)?.label).toBe('口试准考证打印')
    expect(nextTodoNode(cetState, cet, DEC_02_0800_CST)?.label).toBe('笔试准考证打印')
  })

  it('预计节点也算待办，不因 estimated 被跳过', () => {
    const state: MyExamsState = { followed: ['kaoyan'], checked: {} }
    expect(nextTodoNode(state, kaoyan, NOV_13_0800_CST)?.label).toBe('准考证下载')
  })

  it('考研开考后预计节点不再算待办：12-19 与 12-20 都是「初试」', () => {
    const state: MyExamsState = { followed: ['kaoyan'], checked: {} }
    expect(nextTodoNode(state, kaoyan, DEC_19_0800_CST)?.label).toBe('初试')
    expect(nextTodoNode(state, kaoyan, DEC_20_0800_CST)?.label).toBe('初试')
  })
})

describe('四六级准考证打印直达入口（U-31）', () => {
  it('官方报名网地址固定为 cet-bm.neea.edu.cn（live 浏览器 2026-11-17 核实可达）', () => {
    expect(CET_ADMISSION_URL).toBe('https://cet-bm.neea.edu.cn')
  })

  it('准考证打印节点挂的官方入口与核实一致：国考、四六级、省考七省', () => {
    // 口试与笔试准考证共用 CET 报名网打印（首页「快速打印准考证」），
    // 节点 label 本身区分口试/笔试，链接不另写区分文案。
    expect(guokao.nodes.find((n) => n.label === '准考证打印')?.url).toBe(
      GUOKAO_ADMISSION_URL,
    )
    const printNodes = cet.nodes.filter((n) => n.label.endsWith('准考证打印'))
    expect(printNodes.map((n) => n.label)).toEqual(['口试准考证打印', '笔试准考证打印'])
    for (const node of printNodes) {
      expect(node.url).toBe(CET_ADMISSION_URL)
    }
    expect(cet.nodes.filter((n) => n.url !== undefined)).toHaveLength(2)
    // 省考七省各挂本省官方报名系统（U-30，2026-11-17 按公告原文逐项核实）。
    const expectedShengkaoUrl: Record<string, string> = {
      '天津准考证打印': TIANJIN_SHENGKAO_ADMISSION_URL,
      '山东准考证打印': SHANDONG_SHENGKAO_ADMISSION_URL,
      '四川准考证打印': SICHUAN_SHENGKAO_ADMISSION_URL,
      '浙江准考证打印': ZHEJIANG_SHENGKAO_ADMISSION_URL,
      '江苏准考证打印': JIANGSU_SHENGKAO_ADMISSION_URL,
      '广东准考证打印': GUANGDONG_SHENGKAO_ADMISSION_URL,
      '上海准考证打印': SHANGHAI_SHENGKAO_ADMISSION_URL,
    }
    const shengkaoPrintNodes = shengkao.nodes.filter((n) => n.label.endsWith('准考证打印'))
    expect(shengkaoPrintNodes).toHaveLength(7)
    for (const node of shengkaoPrintNodes) {
      expect(node.url).toBe(expectedShengkaoUrl[node.label])
    }
    expect(shengkao.nodes.filter((n) => n.url !== undefined)).toHaveLength(7)
    // 考研与成考查分节点不挂链接：考研准考证官方只说「考前 10 天左右」（无入口可挂），
    // 成考五省查分走小程序/官网栏目（无网页 URL 可挂，不编链接）；例外是江西成绩复核，
    // 挂江西省成人高考网上报名系统直链（江西省教育考试院 2026-11-13 公告原文，U-87）。
    expect(
      EXAMS.filter((e) => e.id === 'kaoyan')
        .flatMap((e) => e.nodes)
        .every((n) => n.url === undefined),
    ).toBe(true)
    expect(
      chengkao.nodes
        .filter((n) => n.label !== '江西成绩复核')
        .every((n) => n.url === undefined),
    ).toBe(true)
    // 复核 URL 本身即 verbatim（公告原文，2026-11-18 核实，含末尾斜杠）。
    expect(JIANGXI_CHENGKAO_REVIEW_URL).toBe('https://jdyw.jxeea.cn/')
    expect(chengkao.nodes.find((n) => n.label === '江西成绩复核')?.url).toBe(
      JIANGXI_CHENGKAO_REVIEW_URL,
    )
  })
})

describe('省考七省准考证节点（U-30）', () => {
  it('七省分省建节点，按开始日排序，窗口与公告原文一致', () => {
    const nodes = shengkao.nodes.filter((n) => n.label.endsWith('准考证打印'))
    expect(nodes.map((n) => n.label)).toEqual([
      '天津准考证打印',
      '山东准考证打印',
      '四川准考证打印',
      '浙江准考证打印',
      '江苏准考证打印',
      '广东准考证打印',
      '上海准考证打印',
    ])
    const byLabel = new Map(nodes.map((n) => [n.label, n]))
    expect(byLabel.get('天津准考证打印')).toMatchObject({
      startISO: '2026-11-28',
      endISO: '2026-12-06',
      estimated: true,
    })
    expect(byLabel.get('山东准考证打印')).toMatchObject({
      startISO: '2026-12-01',
      endISO: '2026-12-06',
    })
    expect(byLabel.get('四川准考证打印')).toMatchObject({
      startISO: '2026-12-01',
      endISO: '2026-12-06',
      estimated: true,
    })
    expect(byLabel.get('浙江准考证打印')).toMatchObject({
      startISO: '2026-12-01',
      endISO: '2026-12-06',
    })
    expect(byLabel.get('江苏准考证打印')).toMatchObject({
      startISO: '2026-12-02',
      endISO: '2026-12-06',
    })
    expect(byLabel.get('广东准考证打印')).toMatchObject({
      startISO: '2026-12-02',
      endISO: '2026-12-06',
      estimated: true,
    })
    expect(byLabel.get('上海准考证打印')).toMatchObject({
      startISO: '2026-12-02',
      endISO: '2026-12-05',
    })
    // 窗口明确的四省不挂 estimated；广东/天津/四川挂 estimated。
    for (const label of ['山东准考证打印', '浙江准考证打印', '江苏准考证打印', '上海准考证打印']) {
      expect(byLabel.get(label)?.estimated).toBeUndefined()
    }
  })

  it('窗口明确的四省按日期翻转，无截止/无时刻的三省恒为 estimated', () => {
    const byLabel = new Map(
      shengkao.nodes.map((n) => [n.label, n]),
    )
    const jiangsu = byLabel.get('江苏准考证打印')!
    const shanghai = byLabel.get('上海准考证打印')!
    const zhejiang = byLabel.get('浙江准考证打印')!
    // 自然日口径：12-06 当天仍进行中（15:00 截止是时刻，不按自然日翻），12-07 才翻已结束。
    expect(examNodeStatus(jiangsu, DEC_02_0800_CST)).toBe('active')
    expect(examNodeStatus(jiangsu, DEC_06_0800_CST)).toBe('active')
    expect(examNodeStatus(jiangsu, DEC_07_0800_CST)).toBe('done')
    expect(examNodeStatus(zhejiang, DEC_06_0800_CST)).toBe('active')
    expect(examNodeStatus(zhejiang, DEC_07_0800_CST)).toBe('done')
    expect(examNodeStatus(shanghai, DEC_06_0800_CST)).toBe('done')
    // 广东/天津/四川：12-07 仍为 estimated 而非 done（U-19 教训：不编造截止）。
    for (const label of ['广东准考证打印', '天津准考证打印', '四川准考证打印']) {
      const node = byLabel.get(label)!
      expect(examNodeStatus(node, DEC_02_0800_CST)).toBe('estimated')
      expect(examNodeStatus(node, DEC_07_0800_CST)).toBe('estimated')
    }
    // 天津 11-28 开放当天即为 estimated（不因开放日翻 active）。
    expect(examNodeStatus(byLabel.get('天津准考证打印')!, NOV_28_0800_CST)).toBe('estimated')
  })

  it('无截止/无时刻的 detail 如实写明，不编造截止时刻', () => {
    const byLabel = new Map(shengkao.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('天津准考证打印')?.detail).toContain('公告未写截止')
    expect(byLabel.get('广东准考证打印')?.detail).toContain('公告未写截止')
    expect(byLabel.get('四川准考证打印')?.detail).toContain('公告未写时刻')
    expect(byLabel.get('江苏准考证打印')?.detail).toBe('12 月 2 日 9:00 至 12 月 6 日 15:00')
    expect(byLabel.get('山东准考证打印')?.detail).toBe('12 月 1 日 9:00 至 12 月 6 日 14:15')
    expect(byLabel.get('浙江准考证打印')?.detail).toBe('12 月 1 日 9:00 至 12 月 6 日 17:00')
    expect(byLabel.get('上海准考证打印')?.detail).toBe('12 月 2 日 10:00 至 12 月 5 日 18:00')
  })

  it('省考 note 补一句七省窗口各异、分省见节点', () => {
    expect(shengkao.note).toContain('分省见节点')
  })

  it('下一步待办：11-28 天津最早开放，12-07 全部节点结束返回 undefined', () => {
    const state: MyExamsState = { followed: ['shengkao'], checked: {} }
    expect(nextTodoNode(state, shengkao, NOV_28_0800_CST)?.label).toBe('天津准考证打印')
    expect(nextTodoNode(state, shengkao, DEC_07_0800_CST)).toBeUndefined()
  })
})

describe('成考成绩分省节点', () => {
  it('只列八省十三节点（云南与天津结果查询为转载级），不写全国单节点', () => {
    expect(chengkao.nodes.map((n) => n.label)).toEqual(['江西成绩查询', '江西成绩复核', '广东成绩查询', '广东成绩复核', '新疆成绩查询', '新疆成绩复核', '山西成绩复核', '海南成绩查询', '天津成绩复核', '浙江成绩查询', '云南成绩查询', '浙江志愿确认', '天津成绩复核结果查询'])
    expect(chengkao.nodes.map((n) => [n.startISO, n.endISO])).toEqual([
      ['2026-11-18', '2026-11-18'],
      ['2026-11-19', '2026-11-20'],
      ['2026-11-18', '2026-11-18'],
      ['2026-11-20', '2026-11-20'],
      ['2026-11-18', '2026-11-18'],
      ['2026-11-18', '2026-11-20'],
      ['2026-11-19', '2026-11-20'],
      ['2026-11-19', '2026-11-19'],
      ['2026-11-19', '2026-11-19'],
      ['2026-11-20', '2026-11-20'],
      ['2026-11-20', '2026-11-20'],
      ['2026-11-25', '2026-11-29'],
      ['2026-11-25', '2026-11-30'],
    ])
    for (const node of chengkao.nodes) {
      if (node.label === '江西成绩复核') {
        // 唯一例外：复核节点挂报名系统直链（公告原文所载，U-87）。
        expect(node.url).toBe(JIANGXI_CHENGKAO_REVIEW_URL)
        continue
      }
      // 其余节点均无网页查分 URL 可挂（广东走小程序；江西、浙江、新疆、云南查分 URL 未核实；海南查询入口 URL 已核实但仍不挂，见 exam-calendar 注释，U-102 口径；山西复核线下办理、sxkszx.cn 未证实可达，不挂；天津复核网上申请缴费、招考资讯网本轮未直读到官方原文，不挂，U-162），不编链接。
      expect(node.url).toBeUndefined()
    }
  })

  it('浙江节点（U-109）：成绩挂 estimated 恒显示「预计」、不翻已结束；志愿确认 11-25–11-29 窗口内进行中、11-30 已结束', () => {
    const byLabel = new Map(chengkao.nodes.map((n) => [n.label, n]))
    const zhejiangScore = byLabel.get('浙江成绩查询')!
    const zhejiangConfirm = byLabel.get('浙江志愿确认')!
    // U-109：11-20 只是「左右」的预计日，状态恒为 estimated（11-20 当天与
    // 11-25 之后都不翻 today/done）；isNodeActionable 的 estimated 开考后
    // 排除口径不动，不重构谓词。
    expect(zhejiangScore.estimated).toBe(true)
    expect(examNodeStatus(zhejiangScore, NOV_20_0800_CST)).toBe('estimated')
    expect(examNodeStatus(zhejiangScore, NOV_25_0800_CST)).toBe('estimated')
    expect(examNodeStatus(zhejiangConfirm, NOV_25_0800_CST)).toBe('active')
    expect(examNodeStatus(zhejiangConfirm, NOV_30_0800_CST)).toBe('done')
  })

  it('浙江节点 detail 写明考试历口径与查询渠道：成绩「左右」、志愿确认起止时刻', () => {
    const byLabel = new Map(chengkao.nodes.map((n) => [n.label, n]))
    const zhejiangScore = byLabel.get('浙江成绩查询')!
    const zhejiangConfirm = byLabel.get('浙江志愿确认')!
    expect(zhejiangScore.detail).toContain('11 月 20 日左右')
    expect(zhejiangScore.detail).toContain('浙江省教育考试院')
    expect(zhejiangConfirm.detail).toContain('11 月 25 日 8:30')
    expect(zhejiangConfirm.detail).toContain('11 月 29 日 17:00')
  })

  it('11-18 当天三省查询节点为今天，11-19 公布完成翻已结束（单日公布事件）', () => {
    // 按 label 取，不按下标：复核节点插在查询节点之间，下标会错位。
    const jiangxi = chengkao.nodes.find((n) => n.label === '江西成绩查询')!
    const guangdong = chengkao.nodes.find((n) => n.label === '广东成绩查询')!
    const xinjiang = chengkao.nodes.find((n) => n.label === '新疆成绩查询')!
    expect(examNodeStatus(jiangxi, NOV_18_0800_CST)).toBe('today')
    expect(examNodeStatus(guangdong, NOV_18_0800_CST)).toBe('today')
    expect(examNodeStatus(xinjiang, NOV_18_0800_CST)).toBe('today')
    expect(examNodeStatus(jiangxi, NOV_19_0800_CST)).toBe('done')
    expect(examNodeStatus(guangdong, NOV_19_0800_CST)).toBe('done')
    expect(examNodeStatus(xinjiang, NOV_19_0800_CST)).toBe('done')
  })

  it('新疆成绩查询与复核（U-91）：查询 11-18 12:00 起、复核 11-18 12:00–11-20 12:00 走邮箱', () => {
    // 新疆教育考试院 2026-11-16 公告原文，2026-11-18 核实（W3 复核：原文未变）。
    const score = chengkao.nodes.find((n) => n.label === '新疆成绩查询')!
    const review = chengkao.nodes.find((n) => n.label === '新疆成绩复核')!
    expect(score.detail).toContain('11 月 18 日 12:00')
    expect(score.detail).toContain('新疆招生网')
    expect(score.detail).toContain('短信验证码')
    expect(review.detail).toContain('11 月 18 日 12:00 至 11 月 20 日 12:00')
    expect(review.detail).toContain('复核成绩申请表')
    expect(review.detail).toContain('指定邮箱')
    expect(review.detail).toContain('逾期不再受理')
    expect(examNodeStatus(review, NOV_18_0800_CST)).toBe('active')
    expect(examNodeStatus(review, NOV_20_0800_CST)).toBe('active')
    expect(examNodeStatus(review, NOV_25_0800_CST)).toBe('done')
    // 11-19/11-20 下一步先指新疆复核（11-18 开启，早于江西复核 11-19）。
    const state: MyExamsState = { followed: ['chengkao'], checked: {} }
    expect(nextTodoNode(state, chengkao, NOV_19_0800_CST)?.label).toBe('新疆成绩复核')
    expect(nextTodoNode(state, chengkao, NOV_20_0800_CST)?.label).toBe('新疆成绩复核')
  })

  it('广东 note 只留证书渠道（U-99/U-110）：复查渠道已上广东成绩复核节点，不再两处重复', () => {
    // U-110：复查句（15:00 截止 + 线下书面申请）已成广东成绩复核节点 detail，
    // note 只留无节点的证书下载渠道；时间值不动。
    const note = chengkao.note ?? ''
    expect(note).not.toContain('复查须在 11 月 20 日 15:00 前')
    expect(note).toContain('成绩证书 11 月 28 日 16:00 起可通过官微/支付宝/百度小程序下载打印')
  })

  it('detail 写明各省查询渠道：江西栏目名、广东小程序渠道与时刻', () => {
    const jiangxi = chengkao.nodes.find((n) => n.label === '江西成绩查询')!
    const guangdong = chengkao.nodes.find((n) => n.label === '广东成绩查询')!
    expect(jiangxi.detail).toContain('9:00')
    expect(jiangxi.detail).toContain('江西省教育考试院网服务大厅')
    expect(guangdong.detail).toContain('16:00')
    expect(guangdong.detail).toContain('16:20')
    expect(guangdong.detail).toContain('小程序')
  })

  it('成考统考已结束，但成绩节点 11-18 当天仍算下一步待办', () => {
    // nextTodoNode 只看节点本身是否可行动，不看考试是否结束——成绩节点
    // 11-18 当天仍是待办；统考 10-17–18 已过，examStatus 当天已是 ended。
    const state: MyExamsState = { followed: ['chengkao'], checked: {} }
    expect(nextTodoNode(state, chengkao, NOV_18_0800_CST)?.label).toBe('江西成绩查询')
  })

  it('江西成绩复核（U-87）：11-19–11-20 窗口内进行中，11-19 起下一步待办即复核', () => {
    // 江西省教育考试院 2026-11-13 公告原文，2026-11-18 核实：
    // 申请 11-19 9:00–11-20 17:00、结果 11-24 通过报名系统反馈。
    const review = chengkao.nodes.find((n) => n.label === '江西成绩复核')!
    expect(review.detail).toContain('11 月 19 日 9:00 至 11 月 20 日 17:00')
    expect(review.detail).toContain('江西省成人高考网上报名系统')
    expect(review.detail).toContain('11 月 24 日')
    expect(examNodeStatus(review, NOV_19_0800_CST)).toBe('active')
    expect(examNodeStatus(review, NOV_20_0800_CST)).toBe('active')
    expect(examNodeStatus(review, NOV_25_0800_CST)).toBe('done')
    // 11-18 当天先指江西成绩查询（单日 today），随后才是复核；11-19 起下一步
    // 是新疆成绩复核（U-91：11-18 开启，早于江西复核，开始日排序在前）。
    const state: MyExamsState = { followed: ['chengkao'], checked: {} }
    expect(nextTodoNode(state, chengkao, NOV_18_0800_CST)?.label).toBe('江西成绩查询')
    expect(nextTodoNode(state, chengkao, NOV_19_0800_CST)?.label).toBe('新疆成绩复核')
    expect(nextTodoNode(state, chengkao, NOV_20_0800_CST)?.label).toBe('新疆成绩复核')
    // 11-19/11-20 仍有可办节点，成考卡片不渲染裸「已结束」（R1 谓词已覆盖）。
    expect(hasActionableNodes(chengkao, NOV_19_0800_CST)).toBe(true)
    expect(hasActionableNodes(chengkao, NOV_20_0800_CST)).toBe(true)
  })
})

describe('京考节点（U-76）', () => {
  it('只列已核实的四节点，不写成绩/缴费节点；报名与准考证挂报名平台、公共科目挂官方公告', () => {
    expect(jingkao.nodes.map((n) => n.label)).toEqual(['报名', '准考证打印', '公安专业科目笔试', '公共科目笔试'])
    expect(jingkao.nodes.map((n) => [n.startISO, n.endISO])).toEqual([
      ['2026-11-12', '2026-11-18'],
      ['2026-12-01', '2026-12-06'],
      ['2026-12-05', '2026-12-05'],
      ['2026-12-06', '2026-12-06'],
    ])
    // 官方入口常量本身即 verbatim（首都之窗公告原文，2026-11-17 核实）。
    expect(JINGKAO_APPLY_URL).toBe('http://rsj.beijing.gov.cn/bm/ztzl/gwy/')
    expect(JINGKAO_NOTICE_URL).toBe(
      'https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html',
    )
    const byLabel = new Map(jingkao.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('报名')?.url).toBe(JINGKAO_APPLY_URL)
    expect(byLabel.get('准考证打印')?.url).toBe(JINGKAO_APPLY_URL)
    expect(byLabel.get('公安专业科目笔试')?.url).toBeUndefined()
    expect(byLabel.get('公共科目笔试')?.url).toBe(JINGKAO_NOTICE_URL)
  })

  it('报名窗口内进行中、11-19 已结束；准考证 12-01 进行中、12-07 已结束；公安 12-05 当天为今天、公共 12-06 当天为今天', () => {
    const byLabel = new Map(jingkao.nodes.map((n) => [n.label, n]))
    const apply = byLabel.get('报名')!
    const admit = byLabel.get('准考证打印')!
    const police = byLabel.get('公安专业科目笔试')!
    const pub = byLabel.get('公共科目笔试')!
    expect(examNodeStatus(apply, NOV_12_0800_CST)).toBe('active')
    expect(examNodeStatus(apply, NOV_17_0800_CST)).toBe('active')
    expect(examNodeStatus(apply, NOV_19_0800_CST)).toBe('done')
    expect(examNodeStatus(admit, DEC_01_0800_CST)).toBe('active')
    expect(examNodeStatus(admit, DEC_06_0800_CST)).toBe('active')
    expect(examNodeStatus(admit, DEC_07_0800_CST)).toBe('done')
    expect(examNodeStatus(police, DEC_05_0800_CST)).toBe('today')
    expect(examNodeStatus(police, DEC_06_0800_CST)).toBe('done')
    expect(examNodeStatus(pub, DEC_06_0800_CST)).toBe('today')
    expect(examNodeStatus(pub, DEC_07_0800_CST)).toBe('done')
  })

  it('detail 写明时刻与渠道：报名 18:00 截止、准考证窗口时刻、公安科目时刻与面向人群、公共科目行测/申论时刻', () => {
    const byLabel = new Map(jingkao.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('报名')?.detail).toContain('11 月 18 日 18:00')
    expect(byLabel.get('报名')?.detail).toContain('北京市人事考试通用平台')
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 1 日 9:00')
    expect(byLabel.get('准考证打印')?.detail).toContain('12 月 6 日 16:30')
    expect(byLabel.get('公安专业科目笔试')?.detail).toContain('14:00–16:00')
    expect(byLabel.get('公安专业科目笔试')?.detail).toContain('仅公安机关人民警察职位')
    expect(byLabel.get('公共科目笔试')?.detail).toContain('9:00–11:00')
    expect(byLabel.get('公共科目笔试')?.detail).toContain('14:00–16:30')
  })

  it('下一步待办：11-17 指报名，11-19 指准考证打印，12-07 全部节点结束返回 undefined', () => {
    const state: MyExamsState = { followed: ['jingkao'], checked: {} }
    expect(nextTodoNode(state, jingkao, NOV_17_0800_CST)?.label).toBe('报名')
    expect(nextTodoNode(state, jingkao, NOV_19_0800_CST)?.label).toBe('准考证打印')
    expect(nextTodoNode(state, jingkao, DEC_07_0800_CST)).toBeUndefined()
  })
})

describe('教资面试节点（2026-11-18 01:22 轮）', () => {
  const jiaoshi = EXAMS.find((e) => e.id === 'jiaoshi-mianshi')!

  it('只列已核实的两节点，准考证挂统一入口、面试节点不挂链接', () => {
    expect(jiaoshi.nodes.map((n) => n.label)).toEqual(['准考证打印', '面试'])
    expect(JIAOSHI_MIANSHI_URL).toBe('https://ntce.neea.edu.cn')
    const byLabel = new Map(jiaoshi.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('准考证打印')?.url).toBe(JIAOSHI_MIANSHI_URL)
    expect(byLabel.get('面试')?.url).toBeUndefined()
  })

  it('下一步待办：11-30 与 12-05 都是准考证打印，12-07 全部节点结束返回 undefined', () => {
    const state: MyExamsState = { followed: ['jiaoshi-mianshi'], checked: {} }
    expect(nextTodoNode(state, jiaoshi, NOV_30_0800_CST)?.label).toBe('准考证打印')
    expect(nextTodoNode(state, jiaoshi, DEC_05_0800_CST)?.label).toBe('准考证打印')
    expect(nextTodoNode(state, jiaoshi, DEC_07_0800_CST)).toBeUndefined()
  })

  it('已关注优先：同日首考的教资面试与京考，数组在前的教资面试胜出', () => {
    const state: MyExamsState = { followed: ['jingkao', 'jiaoshi-mianshi'], checked: {} }
    expect(nearestFollowedExam(state, NOV_30_0800_CST)?.id).toBe('jiaoshi-mianshi')
  })

  it('已结束不再接受新关注：12-07 教资面试已过', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(toggleFollow(empty, 'jiaoshi-mianshi', DEC_07_0800_CST)).toBe(empty)
  })
})

describe('军队文职节点（2026-11-18 01:22 轮）', () => {
  const jundui = EXAMS.find((e) => e.id === 'jundui-wenzhi')!

  it('只列已核实的三节点，准考证挂报名系统直达、缴费与笔试节点不挂链接', () => {
    expect(jundui.nodes.map((n) => n.label)).toEqual(['准考证打印', '缴费', '全军统一笔试'])
    expect(JUNDUANWENZHI_ADMISSION_URL).toBe('https://wzryzk.81rc.mil.cn/qjwzwb')
    const byLabel = new Map(jundui.nodes.map((n) => [n.label, n]))
    expect(byLabel.get('准考证打印')?.url).toBe(JUNDUANWENZHI_ADMISSION_URL)
    expect(byLabel.get('缴费')?.url).toBeUndefined()
    expect(byLabel.get('全军统一笔试')?.url).toBeUndefined()
  })

  it('下一步待办：12-07 指准考证打印，12-13 当天仍是准考证打印（窗口未关），12-14 全部节点结束返回 undefined', () => {
    const state: MyExamsState = { followed: ['jundui-wenzhi'], checked: {} }
    expect(nextTodoNode(state, jundui, DEC_07_0800_CST)?.label).toBe('准考证打印')
    // 准考证窗口 12-07–12-13：12-13 当天窗口仍 active，按开始日排在笔试之前
    expect(nextTodoNode(state, jundui, DEC_13_0800_CST)?.label).toBe('准考证打印')
    expect(nextTodoNode(state, jundui, DEC_14_0800_CST)).toBeUndefined()
  })

  it('已结束不再接受新关注：12-14 军队文职已过', () => {
    const empty: MyExamsState = { followed: [], checked: {} }
    expect(toggleFollow(empty, 'jundui-wenzhi', DEC_14_0800_CST)).toBe(empty)
  })
})

describe('R1：已结束考试仍有可办节点时卡片不渲染裸「已结束」', () => {
  it('成考 11-17/11-18 统考已结束但仍有可办节点，11-19 起仍有复核与浙江节点，12-01 起无可办节点', () => {
    // 触发条件：examStatus 已是 ended，但成绩节点未过。
    expect(examStatus(chengkao, NOV_17_0800_CST)).toBe('ended')
    expect(examStatus(chengkao, NOV_18_0800_CST)).toBe('ended')
    expect(hasActionableNodes(chengkao, NOV_17_0800_CST)).toBe(true)
    expect(hasActionableNodes(chengkao, NOV_18_0800_CST)).toBe(true)
    // 11-19：江西/广东/新疆查询已 done，但新疆复核（11-18–11-20）、江西复核
    // （11-19–11-20）、浙江成绩（11-20）与志愿确认（11-25–11-29）未过；
    // 下一步先指新疆复核（开始日最早）。
    expect(hasActionableNodes(chengkao, NOV_19_0800_CST)).toBe(true)
    expect(nextTodoNode({ followed: ['chengkao'], checked: {} }, chengkao, NOV_19_0800_CST)?.label).toBe('新疆成绩复核')
    // 11-30：U-279 天津成绩复核结果查询末日，仍有可办节点；下一步即该节点。
    expect(hasActionableNodes(chengkao, NOV_30_0800_CST)).toBe(true)
    expect(nextTodoNode({ followed: ['chengkao'], checked: {} }, chengkao, NOV_30_0800_CST)?.label).toBe('天津成绩复核结果查询')
    // 12-01：全部节点已过，无可办节点，卡片回到裸「已结束」。
    expect(hasActionableNodes(chengkao, DEC_01_0800_CST)).toBe(false)
    expect(nextTodoNode({ followed: ['chengkao'], checked: {} }, chengkao, DEC_01_0800_CST)).toBeUndefined()
  })

  it('其他考试不受影响：11-18 当天除成考外均未结束；已结束的国考/考研无可办节点', () => {
    for (const exam of [guokao, cet, shengkao, jingkao, kaoyan]) {
      expect(examStatus(exam, NOV_18_0800_CST)).not.toBe('ended')
    }
    expect(examStatus(guokao, NOV_30_0800_CST)).toBe('ended')
    expect(hasActionableNodes(guokao, NOV_30_0800_CST)).toBe(false)
    expect(examStatus(kaoyan, DEC_21_0800_CST)).toBe('ended')
    expect(hasActionableNodes(kaoyan, DEC_21_0800_CST)).toBe(false)
  })

  it('倒计时岛：有可办节点渲染「统考已结束」，否则裸「已结束」，锚点不动', () => {
    const countdown = read('src/app/exam/exam-countdown.tsx')
    expect(countdown).toContain('hasActionableNodes(exam, now)')
    expect(countdown).toContain("? '统考已结束' : '已结束'")
    // 倒计时锚点仍是首考日，紧迫度逻辑未动；不硬编码成考 id/日期。
    expect(countdown).toContain('countdownParts(shanghaiMidnightMs(firstExamDay(exam)), now)')
    expect(countdown).not.toContain("'chengkao'")
    expect(countdown).not.toContain('2026-11-18')
  })

  it('跟踪岛：行文与按钮按有无可办节点切换 scoped 文案，禁用口径与纯规则层一致（U-106）', () => {
    const island = read('src/app/exam/my-exam-tracker.tsx')
    // U-235：可办判断按 tick 的 now 重算（与倒计时岛同款显式传 now）。
    expect(island).toContain('hasActionableNodes(exam, now)')
    expect(island).toContain('统考已结束，下方节点仍可办理')
    expect(island).toContain('本场考试已结束')
    // U-106（R1「禁用逻辑不动」已推翻）：统考已过但节点仍可办时按钮
    // 与复选框都不禁用；启用态文案必须是「关注…」口径，不可出现可点
    // 却写着「统考已结束」；不硬编码成考 id/日期。
    expect(island).toContain(
      'disabled={storageBlocked !== null || (ended && !hasPendingNodes && !followed)}',
    )
    expect(island).toContain('disabled={ended && !hasPendingNodes}')
    expect(island).toContain("ended && !hasPendingNodes ? '已结束' : '关注这场考试'")
    expect(island).toContain(
      "ended && !hasPendingNodes ? `${exam.shortName}已结束` : `关注${exam.shortName}`",
    )
    expect(island).not.toContain("hasPendingNodes ? '统考已结束' : '已结束'")
    expect(island).not.toContain("'chengkao'")
    expect(island).not.toContain('2026-11-18')
  })

  it('U-106：存储不可用时关注按钮仍禁用（storageBlocked 优先于可办节点）', () => {
    const island = read('src/app/exam/my-exam-tracker.tsx')
    expect(island).toContain('storageBlocked !== null || (ended && !hasPendingNodes && !followed)')
    expect(island).toContain('role="alert"')
  })
})

describe('U-111：复选框 aria-label 按勾选态区分，不把未完成说成已完成', () => {
  it('未勾选标签不含「已完成」断言：文案是「将××标记为已完成」的动作描述', () => {
    const island = read('src/app/exam/my-exam-tracker.tsx')
    // 未勾选分支是动作（将…标记为…），不是状态断言；旧的无条件
    // aria-label={`${node.label}已完成`} 已删除。
    expect(island).toContain('`将${node.label}标记为已完成`')
    expect(island).not.toContain('aria-label={`${node.label}已完成`}')
  })

  it('已勾选标签与完成态一致：已完成分支与删除线同用 checked 判定', () => {
    const island = read('src/app/exam/my-exam-tracker.tsx')
    expect(island).toContain(
      'aria-label={checked ? `${node.label}已完成` : `将${node.label}标记为已完成`}',
    )
    expect(island).toContain("checked ? 'text-muted-foreground line-through' : 'text-foreground'")
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

  it('已结束场次的关注按钮禁用、复选框禁用，状态由 examStatus 派生（U-106：仍有可办节点时不禁用）', () => {
    // U-235：状态按 tick 的 now 重算（与倒计时岛同款显式传 now）。
    expect(island).toContain('examStatus(exam, now)')
    expect(island).toContain("=== 'ended'")
    expect(island).toContain(
      'disabled={storageBlocked !== null || (ended && !hasPendingNodes && !followed)}',
    )
    expect(island).toContain("ended && !hasPendingNodes ? '已结束' : '关注这场考试'")
    expect(island).toContain('disabled={ended && !hasPendingNodes}')
    expect(island).toContain('已结束')
    expect(island).toContain('本场考试已结束')
  })

  it('岛接共享 hook，岛内无直接 localStorage 调用、不写死存储键', () => {
    expect(island).toContain('useMyExams')
    expect(island).toContain("from '@/hooks/useMyExams'")
    expect(island).toContain('storageBlocked')
    expect(island).not.toMatch(/localStorage\./)
    expect(island).not.toContain("'navhub.my-exams.v1'")
  })

  it('用真 checkbox 勾选，aria-label 按勾选态区分（U-111）；关注按钮带 aria-pressed', () => {
    expect(island).toContain('type="checkbox"')
    expect(island).toContain(
      'aria-label={checked ? `${node.label}已完成` : `将${node.label}标记为已完成`}',
    )
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

  it('带官方入口的节点渲染直达链接：过 safeHref、新窗口、官方文案，岛内不写死域名', () => {
    expect(island).toContain('safeHref(node.url)')
    // U-124：「去官网打印准考证」只是默认分支（13 处准考证类节点保留），
    // 报名/笔试公告/成绩复核三类按节点类型映射（渲染级断言见
    // exam-node-link-label-u124.test.ts T1–T5）。
    expect(island).toContain('去官网打印准考证')
    expect(island).toContain('function nodeLinkCopy')
    expect(island).toContain('去官网报名')
    expect(island).toContain('查看官方公告')
    expect(island).toContain('去报名系统申请复核')
    expect(island).toContain('target="_blank"')
    expect(island).toContain('rel="noopener noreferrer"')
    expect(island).not.toContain('cet-bm.neea.edu.cn')
    expect(island).not.toContain('cet.neea.edu.cn')
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
