/**
 * 「我的考试」关注 + 考前清单的纯规则层（/exam 第二轮）。
 *
 * 产品口径（与追剧清单同款诚实纪律）：
 *  - 关注 = 「在备考」：把一场考试放进「我的考试」，只为这场考试逐项
 *    勾选考前清单；不关注的考试只看时间轴，不开放勾选。
 *  - 清单的每一项就是事实源 exam-calendar.ts 里该考试的节点（准考证
 *    打印、笔试等），不另编任务、不编日期；勾选状态只由用户手动改。
 *  - 只保存在本机 localStorage（navhub.my-exams.v1），不登录、不上传、
 *    不跨设备同步；页面上写明这一点。云同步是后续工作，不在本轮承诺。
 */

import {
  EXAMS,
  examNodeStatus,
  examStatus,
  type ExamInfo,
  type ExamNode,
} from './exam-calendar'

/** 本地存储键。改键 = 老用户的关注与勾选凭空消失，不许改。 */
export const MY_EXAMS_STORAGE_KEY = 'navhub.my-exams.v1'

export interface MyExamsState {
  /** 已关注的考试 id（EXAMS 的子集，按关注顺序） */
  followed: string[]
  /** 每场考试已勾选的节点 label（只记已关注考试的） */
  checked: Record<string, string[]>
}

export const EMPTY_MY_EXAMS: MyExamsState = { followed: [], checked: {} }

/**
 * 把一个不可信对象收敛成合法状态；形状不对就丢弃对应部分，不猜、不崩。
 * 未知的考试 id 与不属于该考试的节点 label 一律丢掉（事实源改了也不留脏数据）。
 */
export function parseMyExams(raw: unknown): MyExamsState {
  if (!raw || typeof raw !== 'object') return { followed: [], checked: {} }
  const r = raw as Record<string, unknown>
  const knownIds = new Set(EXAMS.map((e) => e.id))
  const followedRaw = Array.isArray(r.followed) ? r.followed : []
  const followed = [
    ...new Set(
      followedRaw.filter((id): id is string => typeof id === 'string' && knownIds.has(id)),
    ),
  ]
  const checkedRaw =
    r.checked && typeof r.checked === 'object' ? (r.checked as Record<string, unknown>) : {}
  const checked: Record<string, string[]> = {}
  for (const exam of EXAMS) {
    const labels = checkedRaw[exam.id]
    if (!Array.isArray(labels)) continue
    const knownLabels = new Set(exam.nodes.map((n) => n.label))
    const kept = [
      ...new Set(
        labels.filter((l): l is string => typeof l === 'string' && knownLabels.has(l)),
      ),
    ]
    if (kept.length > 0) checked[exam.id] = kept
  }
  return { followed, checked }
}

export function isFollowed(state: MyExamsState, examId: string): boolean {
  return state.followed.includes(examId)
}

/** 关注 / 取消关注。未知考试 id 是 no-op；取消关注保留勾选（再关注回来还在）。 */
export function toggleFollow(state: MyExamsState, examId: string): MyExamsState {
  if (!EXAMS.some((e) => e.id === examId)) return state
  return {
    ...state,
    followed: isFollowed(state, examId)
      ? state.followed.filter((id) => id !== examId)
      : [...state.followed, examId],
  }
}

/**
 * 勾选 / 取消勾选一个节点。只对已关注的考试生效，未关注、未知考试、
 * 不属于该考试的节点一律 no-op（调用方不需先判，状态层兜底）。
 */
export function toggleNodeCheck(
  state: MyExamsState,
  examId: string,
  nodeLabel: string,
): MyExamsState {
  const exam = EXAMS.find((e) => e.id === examId)
  if (!exam || !isFollowed(state, examId)) return state
  if (!exam.nodes.some((n) => n.label === nodeLabel)) return state
  const current = state.checked[examId] ?? []
  const next = current.includes(nodeLabel)
    ? current.filter((l) => l !== nodeLabel)
    : [...current, nodeLabel]
  const checked = { ...state.checked }
  if (next.length === 0) delete checked[examId]
  else checked[examId] = next
  return { ...state, checked }
}

/** 某场考试已勾选的节点数（进度「已完成 x / y」的分子）。 */
export function checkedCount(state: MyExamsState, exam: ExamInfo): number {
  return (state.checked[exam.id] ?? []).length
}

/** 某场考试按开始日排序的第一个未勾选节点；全部勾完则 undefined。 */
export function nextUncheckedNode(state: MyExamsState, exam: ExamInfo): ExamNode | undefined {
  const done = new Set(state.checked[exam.id] ?? [])
  return [...exam.nodes]
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .find((n) => !done.has(n.label))
}

/**
 * 已关注考试里首日最早且未结束的一场；没有符合的返回 undefined。
 *
 * 供首页考试季条带挂载后优先显示：关注了考研的用户打开首页应先看到考研，
 * 而不是全局最近的国考。只在「未结束」的集合内重排——已结束的关注场
 * 绝不顶上来（调用方回退全局最近场；四场全过时条带整条不渲染）。
 * 结束与否按 endISO 判（examStatus）：考研 12-19–20 在 12-20 当天仍算有效。
 */
export function nearestFollowedExam(
  state: MyExamsState,
  nowMs: number = Date.now(),
): ExamInfo | undefined {
  const followed = new Set(state.followed)
  return [...EXAMS]
    .filter((exam) => followed.has(exam.id) && examStatus(exam, nowMs) !== 'ended')
    .sort((a, b) => a.startISO.localeCompare(b.startISO))[0]
}

/**
 * 某场考试的「下一步待办」：按开始日排序，第一个未勾选且未结束的节点。
 *
 * 与 nextUncheckedNode 的区别：已结束但未勾的节点不再算待办（例如四六级
 * 口试已过、用户没勾，条带不应再把它当「下一步」）；预计节点（estimated）
 * 永不算 done，照常可作下一步。全部未结束节点都已勾选则返回 undefined，
 * 调用方直接不渲染「下一步」行，不编假待办。
 */
export function nextTodoNode(
  state: MyExamsState,
  exam: ExamInfo,
  nowMs: number = Date.now(),
): ExamNode | undefined {
  const done = new Set(state.checked[exam.id] ?? [])
  return [...exam.nodes]
    .sort((a, b) => a.startISO.localeCompare(b.startISO))
    .find((n) => !done.has(n.label) && examNodeStatus(n, nowMs) !== 'done')
}
