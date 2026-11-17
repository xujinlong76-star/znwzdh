/**
 * 考试日历数据（/exam）。
 *
 * 日期来源：2026-11-13 按官方公告逐项核实（中国教育考试网、研招网、
 * 国家公务员局专题、各省人事考试公告）。新增考试只收已核实的官方日期，
 * 不按往年惯例推测、不写死未公布的确切日：
 *  - 考研准考证官方只说「考前 10 天左右」，这里只写预计、不写死；
 *  - 省考七省（四川、江苏、广东、上海、天津、浙江、山东）都是单独招考，不是联考，文案不写「联考」；
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
  /** 考试首日（YYYY-MM-DD）：公共科目首日 */
  startISO: string
  /** 考试末日（YYYY-MM-DD） */
  endISO: string
  /**
   * 考生视角的首考日（YYYY-MM-DD）：有专业科目加试的考试早于公共科目
   * 首日（国考 11-28 专业科目先考，公共科目 11-29）；缺省等于 startISO。
   * 倒计时、紧迫度与提醒档位都按首考日算，避免加试考生被「明天考试」误导。
   */
  firstExamDayISO?: string
  /** 首考日当天的时钟卡文案（缺省为「今天${shortName}」） */
  firstDayLabel?: string
  /** 首考日前一天的时钟卡文案（缺省为「明天${shortName}」） */
  eveLabel?: string
  nodes: ExamNode[]
  note?: string
}

export const EXAMS: ExamInfo[] = [
  {
    id: 'guokao',
    name: '2027 年国家公务员考试',
    shortName: '国考',
    tagline: '专业科目 11 月 28 日 · 公共科目 11 月 29 日',
    examDateLabel: '11 月 28–29 日',
    startISO: '2026-11-29',
    endISO: '2026-11-29',
    // 首考日 11-28：部分岗位专业科目 14:00–16:00 先考（国家公务员局
    // 2027 年度招考公告；2026-11-16 多源复核一致）。倒计时按首考日说事。
    firstExamDayISO: '2026-11-28',
    firstDayLabel: '今天国考 · 专业科目 14:00 开考',
    eveLabel: '明天国考（专业科目先考 11 月 28 日）',
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
        endISO: '2026-11-22',
      },
      {
        label: '笔试准考证打印',
        detail: '12 月 1 日 9:00 起',
        startISO: '2026-12-01',
        endISO: '2026-12-12',
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
        detail: '12 月 6 日：四川、江苏、广东、上海、天津、浙江、山东',
        startISO: '2026-12-06',
        endISO: '2026-12-06',
      },
    ],
    note: '七省均为单独招考，报名均已截止（山东 11 月 6–9 日；四川 11 月 4 日、广东 11 月 6 日、上海 11 月 7 日、江苏/天津 11 月 9 日、浙江 11 月 11 日）。',
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
 *
 * 过期哨兵（2026-11-17 R-1）：每条带 validUntilISO（北京时间自然日，
 * 含当日有效），所涉日期一过即过期；activeExamReminders() 在数据层
 * 单点过滤，所有消费点（/exam 页、首页条带等）只读派生结果，不直接
 * 读 EXAM_REMINDERS 原数组，避免提醒在撞期过后仍展示到 12-20。
 */
export interface ExamReminder {
  title: string
  body: string
  /** 提醒有效期至该日（含当日）：省考撞期到 12-06，考研衔接到 12-19 */
  validUntilISO: string
}

export const EXAM_REMINDERS: ExamReminder[] = [
  {
    title: '12 月 5–6 日撞期：省考与教资面试',
    body: '2027 省考公共科目（12 月 6 日）与中小学教师资格面试（12 月 5–6 日）是同一个周末，同时报考请先对一下两场的具体考场与时间，必要时提前取舍。',
    validUntilISO: '2026-12-06',
  },
  {
    title: '国考之后一周就是省考',
    body: '11 月 29 日国考公共科目考完，12 月 6 日多省省考公共科目接着来，两场题型相近，适合以考代练、衔接复习。',
    validUntilISO: '2026-12-06',
  },
  {
    title: '四六级之后一周就是考研',
    body: '12 月 12 日四六级笔试后，12 月 19–20 日就是 2027 考研初试，英语听力与阅读的备考可以直接衔接。',
    validUntilISO: '2026-12-19',
  },
]

/**
 * 未过期的撞期提醒：validUntilISO 当天仍展示，次日 0 点（北京时间）
 * 起隐藏。提醒区只随 nearest 消失（12-20 才下线）兜不住过期提醒，
 * 故消费点一律读这里，不读 EXAM_REMINDERS 原数组。
 */
export function activeExamReminders(nowMs: number = Date.now()): ExamReminder[] {
  return EXAM_REMINDERS.filter((r) => daysUntil(r.validUntilISO, nowMs) >= 0)
}

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

/**
 * 考生视角的首考日：有加试的考试早于公共科目首日（国考 11-28），
 * 缺省等于 startISO。倒计时、紧迫度、提醒档位与倒计时岛都以它为锚。
 */
export function firstExamDay(
  exam: Pick<ExamInfo, 'startISO' | 'firstExamDayISO'>,
): string {
  return exam.firstExamDayISO ?? exam.startISO
}

export function examStatus(
  exam: Pick<ExamInfo, 'startISO' | 'endISO' | 'firstExamDayISO'>,
  nowMs: number = Date.now(),
): ExamStatus {
  const toStart = daysUntil(firstExamDay(exam), nowMs)
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

/** 最近一场：未结束的考试里首考日最早的；多日考试末日仍算未结束
 *（考研 12-19–20：12-20 当天条带仍在，与 /exam 倒计时岛「进行中 ·
 * 第 2 天」一致）；四场全结束则返回 undefined（调用方渲染空态条带）。
 * 排序按首考日（firstExamDay），不是公共科目首日 startISO：有加试的
 * 考试（国考首考日 11-28 < startISO 11-29）应按考生实际最早开考日排。
 * 现只有国考首考日 ≠ startISO 且仍为最早，真实数据行为不变；exams
 * 参数只为测试注入合成数据（2026-11-16 0922 C 线），调用方不传。 */
export function nearestExam(
  nowMs: number = Date.now(),
  exams: ExamInfo[] = EXAMS,
): ExamInfo | undefined {
  return [...exams]
    .sort((a, b) => firstExamDay(a).localeCompare(firstExamDay(b)))
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
 * 距首考日 1 天 → tomorrow；≤3 天 → urgent；≤7 天 → soon；其余 → relaxed。
 * 多日考试以首考日计紧迫度，进行中只显示「第 N 天」。
 */
export type ExamUrgencyTier = 'today' | 'tomorrow' | 'urgent' | 'soon' | 'relaxed'

export function urgencyTier(
  exam: Pick<ExamInfo, 'startISO' | 'endISO' | 'firstExamDayISO'>,
  nowMs: number = Date.now(),
): ExamUrgencyTier | null {
  const status = examStatus(exam, nowMs)
  if (status === 'ended') return null
  if (status === 'today' || status === 'ongoing') return 'today'
  const d = daysUntil(firstExamDay(exam), nowMs)
  if (d <= 1) return 'tomorrow'
  if (d <= 3) return 'urgent'
  if (d <= 7) return 'soon'
  return 'relaxed'
}

/**
 * 时钟卡倒计时行（纯派生）：最近一场未结束考试的一行文案 + 紧迫档位。
 * 四场全结束返回 undefined（调用方隐藏该行，不写未公布日期）。
 * 文案与 /exam 倒计时岛同口径：首考日当天「今天国考 · 专业科目 14:00
 * 开考」（国考首考日 11-28 设了 firstDayLabel）、进行中「考研进行中 ·
 * 第 2 天」、首考日前一天「明天国考（专业科目先考 11 月 28 日）」
 *（设了 eveLabel）、其余「距国考 N 天」；天数按北京时间自然日
 *（daysUntil 首考日），与考试条带数字一致。
 */
export interface ExamCountdownLine {
  exam: ExamInfo
  /** 距首考日的北京时间自然日数：今天 0，明天 1，进行中为负 */
  days: number
  tier: ExamUrgencyTier
  label: string
}

export function nearestExamCountdown(nowMs: number = Date.now()): ExamCountdownLine | undefined {
  const exam = nearestExam(nowMs)
  if (!exam) return undefined
  const tier = urgencyTier(exam, nowMs)
  if (!tier) return undefined
  const status = examStatus(exam, nowMs)
  const d = daysUntil(firstExamDay(exam), nowMs)
  let label: string
  if (status === 'today') {
    label = d === 0 && exam.firstDayLabel ? exam.firstDayLabel : `今天${exam.shortName}`
  } else if (status === 'ongoing') label = `${exam.shortName}进行中 · 第 ${1 - d} 天`
  else if (d === 1) label = exam.eveLabel ?? `明天${exam.shortName}`
  else label = `距${exam.shortName} ${d} 天`
  return { exam, days: d, tier, label }
}

/**
 * 提醒档位：只在考前 7 / 3 / 1 天与考试当天命中，其余为 null。
 * 同一考试同一天只命中一个档位，去重天然成立，无需存储去重表。
 */
export type ExamReminderTier = '7d' | '3d' | '1d' | 'today'

export function reminderTier(
  exam: Pick<ExamInfo, 'startISO' | 'endISO' | 'firstExamDayISO'>,
  nowMs: number = Date.now(),
): ExamReminderTier | null {
  const status = examStatus(exam, nowMs)
  if (status === 'ended') return null
  if (status === 'today' || status === 'ongoing') return 'today'
  const d = daysUntil(firstExamDay(exam), nowMs)
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

/**
 * 国考准考证打印提醒（只针对 guokao，首页条带 + /exam 国考卡片）。
 *
 * 事实来源（2026-11-14 按官方公告逐项核实 + curl）：
 *  - 打印窗口 11 月 23 日 0:00 至 11 月 29 日 15:00，逾期系统关闭、无法补打；
 *  - 退场句出自考场规则、不在公告正文；
 *  - 官方专题站 http://bm.scs.gov.cn/kl2027 经 curl 核实返回 200（JS 跳转页），
 *    是站内提醒唯一可点击入口；https 版为空回复，链接必须写 http://；
 *  - gwy.cpta.com.cn 根路径返回 405，不作站内可点击主入口。
 *
 * 门控（北京时间；15:00 截止用时刻算，不按自然日）：
 *  - 11-15–11-21 倒计时（countdown，距打印开启 X 天）；
 *  - 11-22 预热（warmup，开放前一天）；
 *  - 11-23–11-26 已开放（open）；
 *  - 11-27–11-29 15:00 末班（last-call）；
 *  - 11-15 之前与 11-29 15:00 之后一律不显示（null）。
 * 文案取自已核实的提醒准备稿 A 版（条带短句 / 卡片全句）。
 */
export const GUOKAO_ADMISSION_URL = 'http://bm.scs.gov.cn/kl2027'

export type GuokaoAdmissionPhase = 'countdown' | 'warmup' | 'open' | 'last-call'

export function guokaoAdmissionPhase(nowMs: number = Date.now()): GuokaoAdmissionPhase | null {
  const countdownStart = shanghaiMidnightMs('2026-11-15')
  const warmupStart = shanghaiMidnightMs('2026-11-22')
  const openStart = shanghaiMidnightMs('2026-11-23')
  const lastCallStart = shanghaiMidnightMs('2026-11-27')
  const deadline = shanghaiMidnightMs('2026-11-29') + 15 * 3600 * 1000
  if (nowMs >= countdownStart && nowMs < warmupStart) return 'countdown'
  if (nowMs < warmupStart || nowMs >= deadline) return null
  if (nowMs < openStart) return 'warmup'
  if (nowMs < lastCallStart) return 'open'
  return 'last-call'
}

export interface GuokaoAdmissionReminder {
  phase: GuokaoAdmissionPhase
  /** 条带一行文案（短句） */
  stripLine: string
  /** /exam 卡片文案（A 版全句） */
  cardLine: string
  url: string
}

const GUOKAO_ADMISSION_COPY: Record<
  Exclude<GuokaoAdmissionPhase, 'countdown'>,
  { strip: string; card: string }
> = {
  warmup: {
    strip: '国考准考证明天 0:00 开放打印，11 月 29 日 15:00 截止',
    card: '2027 国考准考证明天（11 月 23 日）0:00 开放打印，11 月 29 日 15:00 截止——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
  open: {
    strip: '国考准考证打印已开放，11 月 29 日 15:00 截止，逾期无法补打',
    card: '2027 国考准考证打印已开放，11 月 29 日 15:00 截止，逾期系统关闭、无法补打——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
  'last-call': {
    strip: '末班提醒：国考准考证 11 月 29 日 15:00 截止，逾期无法补打；今年新规：开考 15 分钟后不得入场，行测最晚 8:45、申论 13:45',
    card: '末班提醒：2027 国考准考证 11 月 29 日 15:00 截止，逾期系统关闭、无法补打——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。',
  },
}

/**
 * 某场考试的准考证打印提醒：只有国考在门控窗口内才返回内容，
 * 其余考试与窗口外一律返回 null（调用方渲染 nothing，不出空壳）。
 */
export function admissionReminderFor(
  exam: Pick<ExamInfo, 'id'>,
  nowMs: number = Date.now(),
): GuokaoAdmissionReminder | null {
  if (exam.id !== 'guokao') return null
  const phase = guokaoAdmissionPhase(nowMs)
  if (!phase) return null
  if (phase === 'countdown') {
    const days = daysUntil('2026-11-23', nowMs)
    const strip = `国考准考证距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止`
    const card = `2027 国考准考证距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止——报名确认成功的考生，带报名序号登录专题网站打印，多打两份备用。笔试 11 月 28–29 日：专业科目 11 月 28 日 14:00–16:00（部分职位），公共科目 11 月 29 日（行测 9:00–11:00、申论 14:00–17:00）。今年新规：开考 15 分钟后不得入场（去年为 30 分钟，据国家公务员局 2027 年度招考公告）——行测最晚 8:45 入场，申论、专业科目最晚 13:45 入场；考试期间不得提前退场（考场规则）。`
    return { phase, stripLine: strip, cardLine: card, url: GUOKAO_ADMISSION_URL }
  }
  const copy = GUOKAO_ADMISSION_COPY[phase]
  return { phase, stripLine: copy.strip, cardLine: copy.card, url: GUOKAO_ADMISSION_URL }
}
