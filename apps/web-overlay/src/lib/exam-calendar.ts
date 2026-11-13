/**
 * 考试日历数据（/exam）。
 *
 * 日期来源：2026-11-13 按官方公告逐项核实（中国教育考试网、研招网、
 * 国家公务员局专题、各省人事考试公告）。新增考试只收已核实的官方日期，
 * 不按往年惯例推测、不写死未公布的确切日：
 *  - 考研准考证官方只说「考前 10 天左右」，这里只写预计、不写死；
 *  - 省考五省 + 浙江都是单独招考，不是联考，文案不写「联考」；
 *  - 2026 下半年软考（10-24–27）与教资笔试（11-01）已考完，不列入倒计时。
 */

export interface ExamNode {
  label: string
  detail: string
  /** 节点开始日（YYYY-MM-DD，北京时间自然日） */
  startISO: string
  /** 节点结束日（单日节点与开始日相同） */
  endISO: string
  /** 预计日期：官方未公布确切日，状态不按日期自动翻转为「已结束」 */
  estimated?: boolean
}

export interface ExamInfo {
  id: string
  name: string
  shortName: string
  tagline: string
  examDateLabel: string
  /** 考试首日（YYYY-MM-DD） */
  startISO: string
  /** 考试末日（YYYY-MM-DD） */
  endISO: string
  nodes: ExamNode[]
  note?: string
}

export const EXAMS: ExamInfo[] = [
  {
    id: 'guokao',
    name: '2027 年国家公务员考试',
    shortName: '国考',
    tagline: '公共科目笔试',
    examDateLabel: '11 月 29 日',
    startISO: '2026-11-29',
    endISO: '2026-11-29',
    nodes: [
      {
        label: '准考证打印',
        detail: '11 月 23 日 0:00 至 11 月 29 日 15:00',
        startISO: '2026-11-23',
        endISO: '2026-11-29',
      },
      {
        label: '专业科目笔试',
        detail: '11 月 28 日 14:00–16:00（部分岗位）',
        startISO: '2026-11-28',
        endISO: '2026-11-28',
      },
      {
        label: '公共科目笔试',
        detail: '行测 9:00–11:00，申论 14:00–17:00',
        startISO: '2026-11-29',
        endISO: '2026-11-29',
      },
    ],
  },
  {
    id: 'cet',
    name: '2026 年下半年全国大学英语四、六级考试',
    shortName: '四六级',
    tagline: '笔试',
    examDateLabel: '12 月 12 日',
    startISO: '2026-12-12',
    endISO: '2026-12-12',
    nodes: [
      {
        label: '口试',
        detail: '四级 11 月 21 日，六级 11 月 22 日',
        startISO: '2026-11-21',
        endISO: '2026-11-22',
      },
      {
        label: '口试准考证打印',
        detail: '11 月 17 日 9:00 起',
        startISO: '2026-11-17',
        endISO: '2026-11-17',
      },
      {
        label: '笔试准考证打印',
        detail: '12 月 1 日 9:00 起',
        startISO: '2026-12-01',
        endISO: '2026-12-01',
      },
      {
        label: '笔试',
        detail: '四级 9:00–11:20，六级 15:00–17:25',
        startISO: '2026-12-12',
        endISO: '2026-12-12',
      },
    ],
  },
  {
    id: 'shengkao',
    name: '2027 年省考（多省同日笔试）',
    shortName: '省考',
    tagline: '公共科目笔试',
    examDateLabel: '12 月 6 日',
    startISO: '2026-12-06',
    endISO: '2026-12-06',
    nodes: [
      {
        label: '专业科目笔试',
        detail: '12 月 5 日（多省）',
        startISO: '2026-12-05',
        endISO: '2026-12-05',
      },
      {
        label: '公共科目笔试',
        detail: '12 月 6 日：四川、江苏、广东、上海、天津、浙江',
        startISO: '2026-12-06',
        endISO: '2026-12-06',
      },
    ],
    note: '六省均为单独招考，报名时间各省不一；浙江报名已于 11 月 11 日截止。',
  },
  {
    id: 'kaoyan',
    name: '2027 年全国硕士研究生招生考试',
    shortName: '考研',
    tagline: '初试',
    examDateLabel: '12 月 19–20 日',
    startISO: '2026-12-19',
    endISO: '2026-12-20',
    nodes: [
      {
        label: '准考证下载',
        detail: '考前 10 天左右开通（预计 12 月 9 日前后）',
        startISO: '2026-12-09',
        endISO: '2026-12-10',
        estimated: true,
      },
      {
        label: '初试',
        detail: '12 月 19–20 日',
        startISO: '2026-12-19',
        endISO: '2026-12-20',
      },
    ],
  },
]

/**
 * 撞期与双考提醒。日期均已核实：中小学教师资格面试 12-05–06
 *（准考证 11-30–12-06，报名 11-06–09 已截止）。
 */
export const EXAM_REMINDERS = [
  {
    title: '12 月 5–6 日撞期：省考与教资面试',
    body: '2027 省考公共科目（12 月 6 日）与中小学教师资格面试（12 月 5–6 日）是同一个周末，同时报考请先对一下两场的具体考场与时间，必要时提前取舍。',
  },
  {
    title: '国考之后一周就是省考',
    body: '11 月 29 日国考公共科目考完，12 月 6 日多省省考公共科目接着来，两场题型相近，适合以考代练、衔接复习。',
  },
  {
    title: '四六级之后一周就是考研',
    body: '12 月 12 日四六级笔试后，12 月 19–20 日就是 2027 考研初试，英语听力与阅读的备考可以直接衔接。',
  },
]

/** 备考站点区：读站内「学习成长 / 考试备考」分类，不硬编码链接 */
export const EXAM_PREP_CATEGORY_ID = 'reg-learning-growth'
export const EXAM_PREP_SUB_ID = 'reg-exam-prep'

export const EXAM_DATA_NOTE =
  '考试日期据官方公告核实于 2026 年 11 月 13 日，请以各考试官方最新公告为准。'

export const DAY_MS = 24 * 3600 * 1000
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000

/** 某日期在北京时间的零点对应的 UTC 毫秒数 */
export function shanghaiMidnightMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d) - SHANGHAI_OFFSET_MS
}

/** 给定时刻所在的北京时间自然日的零点（UTC 毫秒数） */
function shanghaiTodayStartMs(nowMs: number): number {
  return Math.floor((nowMs + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS
}

/** 到目标日期（北京时间自然日）还剩几天：今天 0，明天 1，已过为负数 */
export function daysUntil(targetISO: string, nowMs: number = Date.now()): number {
  return Math.round((shanghaiMidnightMs(targetISO) - shanghaiTodayStartMs(nowMs)) / DAY_MS)
}

export type ExamStatus = 'upcoming' | 'today' | 'ongoing' | 'ended'

export function examStatus(
  exam: Pick<ExamInfo, 'startISO' | 'endISO'>,
  nowMs: number = Date.now(),
): ExamStatus {
  const toStart = daysUntil(exam.startISO, nowMs)
  const toEnd = daysUntil(exam.endISO, nowMs)
  if (toEnd < 0) return 'ended'
  if (toStart > 0) return 'upcoming'
  if (exam.startISO === exam.endISO) return 'today'
  return 'ongoing'
}

export type ExamNodeStatus = 'done' | 'today' | 'active' | 'upcoming' | 'estimated'

export function examNodeStatus(node: ExamNode, nowMs: number = Date.now()): ExamNodeStatus {
  if (node.estimated) return 'estimated'
  const toStart = daysUntil(node.startISO, nowMs)
  const toEnd = daysUntil(node.endISO, nowMs)
  if (toEnd < 0) return 'done'
  if (toStart > 0) return 'upcoming'
  if (node.startISO === node.endISO) return 'today'
  return 'active'
}

/** 最近一场：未结束的考试里首日最早的；多日考试末日仍算未结束
 *（考研 12-19–20：12-20 当天条带仍在，与 /exam 倒计时岛「进行中 ·
 * 第 2 天」一致）；四场全结束则返回 undefined（调用方渲染空态条带） */
export function nearestExam(nowMs: number = Date.now()): ExamInfo | undefined {
  return [...EXAMS]
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .find((exam) => examStatus(exam, nowMs) !== 'ended')
}

/**
 * 「下一步」挑选谓词：预计节点（estimated）在所属考试开考后不再算待办
 * ——准考证下载开考后已无意义；其余节点按状态算。时间轴的
 * examNodeStatus 不动（预计节点仍显示「预计」，不按日期翻 done）。
 */
export function isNodeActionable(
  node: ExamNode,
  exam: ExamInfo,
  nowMs: number = Date.now(),
): boolean {
  if (node.estimated && daysUntil(exam.startISO, nowMs) <= 0) return false
  return examNodeStatus(node, nowMs) !== 'done'
}

/** 某场考试的「下一步」节点：按开始日排序，第一个未结束的节点；全过则 undefined */
export function nextExamNode(exam: ExamInfo, nowMs: number = Date.now()): ExamNode | undefined {
  return [...exam.nodes]
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .find((node) => isNodeActionable(node, exam, nowMs))
}

/** 倒计时拆分：天 / 时 / 分 / 秒（目标时刻已过则全 0） */
export function countdownParts(targetMs: number, nowMs: number) {
  const diff = Math.max(0, targetMs - nowMs)
  return {
    days: Math.floor(diff / DAY_MS),
    hours: Math.floor((diff % DAY_MS) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  }
}

export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  upcoming: '未开始',
  today: '今天考试',
  ongoing: '进行中',
  ended: '已结束',
}

export const EXAM_NODE_STATUS_LABEL: Record<ExamNodeStatus, string> = {
  done: '已结束',
  today: '今天',
  active: '进行中',
  upcoming: '未开始',
  estimated: '预计',
}

/**
 * 倒计时紧迫度分档（纯派生：考试 + 时刻，不存状态、不写存储）。
 * 档位互斥：ended → null（不参与任何档位）；today/ongoing → today；
 * 距首日 1 天 → tomorrow；≤3 天 → urgent；≤7 天 → soon；其余 → relaxed。
 * 多日考试以首日计紧迫度，进行中只显示「第 N 天」。
 */
export type ExamUrgencyTier = 'today' | 'tomorrow' | 'urgent' | 'soon' | 'relaxed'

export function urgencyTier(
  exam: Pick<ExamInfo, 'startISO' | 'endISO'>,
  nowMs: number = Date.now(),
): ExamUrgencyTier | null {
  const status = examStatus(exam, nowMs)
  if (status === 'ended') return null
  if (status === 'today' || status === 'ongoing') return 'today'
  const d = daysUntil(exam.startISO, nowMs)
  if (d <= 1) return 'tomorrow'
  if (d <= 3) return 'urgent'
  if (d <= 7) return 'soon'
  return 'relaxed'
}

/**
 * 提醒档位：只在考前 7 / 3 / 1 天与考试当天命中，其余为 null。
 * 同一考试同一天只命中一个档位，去重天然成立，无需存储去重表。
 */
export type ExamReminderTier = '7d' | '3d' | '1d' | 'today'

export function reminderTier(
  exam: Pick<ExamInfo, 'startISO' | 'endISO'>,
  nowMs: number = Date.now(),
): ExamReminderTier | null {
  const status = examStatus(exam, nowMs)
  if (status === 'ended') return null
  if (status === 'today' || status === 'ongoing') return 'today'
  const d = daysUntil(exam.startISO, nowMs)
  if (d === 7) return '7d'
  if (d === 3) return '3d'
  if (d === 1) return '1d'
  return null
}

export const EXAM_REMINDER_TIER_LABEL: Record<ExamReminderTier, string> = {
  '7d': '考前 7 天',
  '3d': '考前 3 天',
  '1d': '明天考试',
  today: '今天考试',
}
