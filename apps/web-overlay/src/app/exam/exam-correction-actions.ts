'use server'

import { createHash } from 'node:crypto'
import { EXAMS } from '@/lib/exam-calendar'
import { insertExamCorrectionDraft } from '@/lib/exam-correction-store'
import type {
  ExamCorrectionDraftInput,
  ExamCorrectionErrorType,
} from '@/lib/exam-verification'

export interface ExamCorrectionReportResult {
  ok: boolean
  /** 成功时为更正行 id；store 未合流时为空（客户端把草稿暂存本机）。 */
  id?: number
  reason?: 'store_not_merged' | 'store_error' | 'invalid_input'
  message: string
}

const ERROR_TYPES: readonly ExamCorrectionErrorType[] = [
  'factual',
  'date',
  'url',
  'attribution',
  'context',
]

function assertionHashFor(examId: string, nodeLabel: string, assertion: string): string {
  const normalized = `${examId}:${nodeLabel}:${assertion}`.trim().replace(/\s+/g, ' ')
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/**
 * 读者报错提交（§9.3）：先以 how_discovered='reader_tip' 写草稿行，
 * corrected_text 与 correction_published_at 为空；未确认的报错不直接改节点字段。
 * store 未合流时返回 store_not_merged，由客户端把草稿暂存本机 localStorage。
 */
export async function submitExamCorrectionReport(formData: FormData): Promise<ExamCorrectionReportResult> {
  const nodeKey = String(formData.get('nodeKey') ?? '')
  const [examId = '', nodeLabel = ''] = nodeKey.split('::')
  const description = String(formData.get('description') ?? '').trim()
  const errorType = String(formData.get('errorType') ?? '') as ExamCorrectionErrorType
  const sourceUrl = String(formData.get('sourceUrl') ?? '').trim()
  const contact = String(formData.get('contact') ?? '').trim()
  if (examId === '' || nodeLabel === '' || description === '' || !ERROR_TYPES.includes(errorType)) {
    return { ok: false, reason: 'invalid_input', message: '请选报错节点、错误类型并填写错误描述。' }
  }
  const exam = EXAMS.find((e) => e.id === examId)
  const node = exam?.nodes.find((n) => n.label === nodeLabel)
  if (exam === undefined || node === undefined) {
    return { ok: false, reason: 'invalid_input', message: '报错节点不存在，请重新选择。' }
  }
  if (sourceUrl !== '' && !/^https?:\/\//.test(sourceUrl)) {
    return { ok: false, reason: 'invalid_input', message: '来源链接须为 http(s):// 开头的完整地址。' }
  }
  const draft: ExamCorrectionDraftInput = {
    examId,
    nodeLabel,
    assertionHash: assertionHashFor(examId, nodeLabel, node.detail),
    originalText: node.detail,
    correctedText: '',
    errorType,
    reason: description,
    howDiscovered: 'reader_tip',
    ...(sourceUrl !== '' ? { sourceUrl } : {}),
    ...(contact !== '' ? { contact } : {}),
    // R3：originalPublishedAt 草稿态为 NULL——节点数据无逐条发布时间，未知即 NULL，
    // 不得以举报时间（Date.now()）占位冒充原文发布时间；核查确认时由核查人以实际
    // 发布时间补正。store 侧草稿分支允许两时间戳为 NULL，正式更正行仍强制必填。
    originalPublishedAt: null,
    correctionPublishedAt: null,
    location: 'both',
    correctedBy: 'reader_tip',
  }
  const res = await insertExamCorrectionDraft(draft)
  if (res.ok) {
    return { ok: true, id: res.id, message: '报错已收到，核查确认后会公开更正。谢谢指正。' }
  }
  return { ok: false, reason: res.reason, message: res.message }
}
