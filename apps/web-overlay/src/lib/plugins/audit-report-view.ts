import type { HubPluginAuditReport } from '@/lib/navhub-api'

/**
 * AI 严审弹窗的视图模型：把审计报告翻译成“能说什么、不能说什么”。
 *
 * 旧弹窗写死“安全等级：优良 (Verified)”与四项全绿文案，不读报告——
 * 中/高风险插件弹出的仍是同一套全绿文案（F-3）。这里只做一件事：
 * 等级标签、分维分数、检查项全部取自报告原文；没测的维度是 null，
 * 不是 0 分也不是满分；只有 level === 'safe' 才能叫“优良 (Verified)”。
 */

export type AuditLevel = 'safe' | 'low_risk' | 'medium_risk' | 'high_risk'
export type AuditLevelTone = 'good' | 'ok' | 'warn' | 'bad'

export const AUDIT_LEVEL_LABELS: Record<AuditLevel, { label: string; tone: AuditLevelTone }> = {
  safe: { label: '优良 (Verified)', tone: 'good' },
  low_risk: { label: '低风险', tone: 'ok' },
  medium_risk: { label: '中风险', tone: 'warn' },
  high_risk: { label: '高风险', tone: 'bad' },
}

export function auditLevelLabel(level: string): { label: string; tone: AuditLevelTone } {
  return (
    (AUDIT_LEVEL_LABELS as Record<string, { label: string; tone: AuditLevelTone }>)[level] ?? {
      label: '未评级',
      tone: 'warn',
    }
  )
}

/**
 * 风险等级 → Tailwind 颜色类（R2A-6 共享映射）。
 *
 * 卡片徽章、详情 hero 按钮、详情审计弹窗此前各写死一套颜色：高风险插件
 * 也顶着翠绿徽章写「AI 严审 · 42 分」。三处统一从这里取色，按真实等级渲染；
 * Tailwind 类名必须写全（拼类名会在构建时被裁剪）。
 */
export const AUDIT_LEVEL_TONE_CLASSES: Record<
  AuditLevelTone,
  { chip: string; icon: string; score: string }
> = {
  good: {
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    icon: 'text-emerald-500',
    score: 'text-emerald-700 dark:text-emerald-400',
  },
  ok: {
    chip: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    icon: 'text-blue-500',
    score: 'text-blue-600 dark:text-blue-400',
  },
  warn: {
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    icon: 'text-amber-500',
    score: 'text-amber-700 dark:text-amber-400',
  },
  bad: {
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
    icon: 'text-rose-500',
    score: 'text-rose-600 dark:text-rose-400',
  },
}

export function auditLevelToneClasses(level: string): {
  label: string
  tone: AuditLevelTone
  chip: string
  icon: string
  score: string
} {
  const { label, tone } = auditLevelLabel(level)
  return { label, tone, ...AUDIT_LEVEL_TONE_CLASSES[tone] }
}

export type AuditDimensionKey = 'security' | 'availability' | 'compliance' | 'relevance'

export const AUDIT_DIMENSION_LABELS: Record<AuditDimensionKey, string> = {
  security: '静态安全沙箱',
  availability: '外链可用性',
  compliance: 'AI 合规审查',
  relevance: '语义相关性',
}

export const AUDIT_DIMENSION_KEYS: AuditDimensionKey[] = [
  'security',
  'availability',
  'compliance',
  'relevance',
]

export interface AuditDimensionView {
  key: AuditDimensionKey
  label: string
  /** null = 该维度本次未测量（不是 0 分，更不是满分） */
  score: number | null
}

export interface AuditCheckView {
  name: string
  passed: boolean
  /** 本次没跑这一项：既不是通过也不是不通过 */
  skipped: boolean
  detail: string
}

export interface AuditReportView {
  score: number
  level: string
  levelLabel: string
  levelTone: AuditLevelTone
  dimensions: AuditDimensionView[]
  checks: AuditCheckView[]
  /** 是否拿到了完整分维报告；false = 只有摘要，维度与检查项一律“未测量/未知” */
  hasFullReport: boolean
  llmReviewed: boolean
  reviewSkipped: HubPluginAuditReport['reviewSkipped']
  scoreBasis?: HubPluginAuditReport['scoreBasis']
  aiRationale?: string
  auditedAt: number
  verifiedAuthor: boolean
}

function dimensionsFrom(
  scores: HubPluginAuditReport['dimensionScores'] | undefined,
): AuditDimensionView[] {
  return AUDIT_DIMENSION_KEYS.map((key) => ({
    key,
    label: AUDIT_DIMENSION_LABELS[key],
    score: scores ? (scores[key] ?? null) : null,
  }))
}

/** 完整报告 → 视图：等级、分维、检查项全部取自报告原文。 */
export function buildAuditView(report: HubPluginAuditReport): AuditReportView {
  const { label, tone } = auditLevelLabel(report.level)
  return {
    score: report.score,
    level: report.level,
    levelLabel: label,
    levelTone: tone,
    dimensions: dimensionsFrom(report.dimensionScores),
    checks: (report.checks ?? []).map((c) => ({
      name: c.name,
      passed: c.passed,
      skipped: c.skipped === true,
      detail: c.detail,
    })),
    hasFullReport: true,
    llmReviewed: report.llmReviewed === true,
    reviewSkipped: report.reviewSkipped ?? null,
    scoreBasis: report.scoreBasis,
    aiRationale: report.aiRationale,
    auditedAt: report.auditedAt,
    verifiedAuthor: report.verifiedAuthor,
  }
}

/**
 * 只有摘要（分维报告拉取失败）时的降级视图：分数与等级仍取自摘要，
 * 但维度一律未测量、检查项一律未知——绝不拿写死的四项全绿结论补位。
 */
export function buildAuditViewFromSummary(
  score: number,
  level: string,
  auditedAt: number,
): AuditReportView {
  const { label, tone } = auditLevelLabel(level)
  return {
    score,
    level,
    levelLabel: label,
    levelTone: tone,
    dimensions: dimensionsFrom(undefined),
    checks: [],
    hasFullReport: false,
    llmReviewed: false,
    reviewSkipped: null,
    scoreBasis: undefined,
    aiRationale: undefined,
    auditedAt,
    verifiedAuthor: false,
  }
}

/** 模型缺席的原因 → 给用户的一句真话；null = 模型参与了审理，无需解释。 */
export function auditReviewSkippedLabel(
  skipped: HubPluginAuditReport['reviewSkipped'],
): string | null {
  switch (skipped) {
    case 'quota':
      return '模型额度已用完，本次未做模型合规研判。'
    case 'unconfigured':
      return '未配置模型，本次未做模型合规研判。'
    case 'error':
      return '模型调用失败，本次未做模型合规研判。'
    case 'not_audited':
      return '本次仅完成静态清单检查，未做模型合规研判与外链探活。'
    default:
      return null
  }
}
