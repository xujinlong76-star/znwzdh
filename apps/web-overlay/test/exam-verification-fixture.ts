/**
 * 核验准入共享 fixture（01-verification-workflow §7.2 / A7 迁移用）。
 *
 * 旧测试里大量用合成 ExamNode 测 PEAK 表 mechanics（18:00 翻“已截止”、今日行排序、
 * chip 文案等）。真实节点自 2026-11-19 起按核验级别准入：unverified 节点不再进入
 * PEAK 表——这些 mechanics 测试若继续用真实节点，断言的是“节点未核实”而不是
 * 表机制本身。做法：PEAK mechanics 类测试用本 fixture 的 eligible 包装保持原断言
 * （PEAK 表逻辑未动）；断言“真实节点入表”类的测试改写为新行为（真实节点返回
 * undefined + eligible 包装返回时刻，证明表项仍在）。
 *
 * 包装口径（与真实 reprint 节点一致，不伪造 official）：verification_level='reprint'、
 * confidence='medium'、checked_at 新鲜（30 天内不过期）、source_url 为该场已登记
 * 的官方域名、archived_url 为该域名的 Wayback 格式（`^https://web\.archive\.org/web/\d{14}id_/https?://`
 * 校验通过）。注意 archived_url 只是格式合法的合成值，仅供 mechanics 测试；
 * 真实节点绝不这样填（见 exam-calendar.ts 填值铁律）。
 */
import { EXAMS, type ExamInfo, type ExamNode } from '@/lib/exam-calendar'
import { EXAM_OFFICIAL_DOMAINS } from '@/lib/exam-verification'

/** 固定新鲜核查时间：2026-11-19 10:00 +08:00，30 天内不过期。 */
export const ELIGIBLE_CHECKED_AT = '2026-11-19T10:00:00+08:00'

/** 以 examId 找该场已登记的首个官方域名，拼 Wayback 格式存档 URL（仅测试用）。 */
export function eligibleArchiveUrl(examId: string): string {
  const domain = EXAM_OFFICIAL_DOMAINS[examId]?.[0] ?? 'example.com'
  return `https://web.archive.org/web/20261119000000id_/https://${domain}/`
}

/** 以 examId 找该场已登记的首个官方域名拼 source_url（仅测试用）。 */
export function eligibleSourceUrl(examId: string): string {
  const domain = EXAM_OFFICIAL_DOMAINS[examId]?.[0] ?? 'example.com'
  return `https://${domain}/`
}

/** 把单个节点包装成准入的 reprint 节点（同场域名 + 新鲜 checked_at）。 */
export function withEligibleVerificationFor(examId: string, node: ExamNode): ExamNode {
  return {
    ...node,
    verification_level: 'reprint',
    source_url: eligibleSourceUrl(examId),
    archived_url: eligibleArchiveUrl(examId),
    checked_at: ELIGIBLE_CHECKED_AT,
    confidence: 'medium',
  }
}

/** 把一整场考试的全部节点包装成准入节点（供 todayNodes(now, exams) 注入）。 */
export function eligibleExam(exam: ExamInfo): ExamInfo {
  return {
    ...exam,
    nodes: exam.nodes.map((node) => withEligibleVerificationFor(exam.id, node)),
  }
}

/** 全部 11 场包装成准入考试（供 todayNodes(now, exams) 注入）。 */
export function eligibleExams(exams: readonly ExamInfo[] = EXAMS): ExamInfo[] {
  return exams.map(eligibleExam)
}
