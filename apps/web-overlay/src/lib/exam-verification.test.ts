/**
 * 核验工作流单测（01-verification-workflow §10）：
 *  - §2.1 校验表逐条（validateExamNodeVerification）
 *  - §2.3 推导表逐条（deriveConfidence）
 *  - §7 准入闸逐条（isPeakEligible / isIcsFeedEligible / isIcsDownloadEligible）
 *  - A10：30 天过期降档（deriveConfidence / isVerificationExpired）
 *  - A4：43 节点 5 字段齐全且 confidence 等于推导值（方案称 46 是误数：
 *    46 行 `label:` 中 3 行非节点，见 exam-calendar.ts 接口注释与本文件 A4 注释）
 *  - A5：official 双全 + 域名在白名单内
 *  - A7：unverified 节点调 peakDayDeadlineMs / todayNodeDeadlineMs 返回 undefined
 *
 * 先写失败测试再实现（TDD）：本文件先于 exam-verification.ts 落地。
 */
import { describe, expect, it } from 'vitest'
import {
  EXAMS,
  peakDayDeadlineMs,
  todayNodeDeadlineMs,
  type ExamInfo,
  type ExamNode,
} from './exam-calendar'
import {
  deriveConfidence,
  isIcsDownloadEligible,
  isIcsFeedEligible,
  isPeakEligible,
  isVerificationExpired,
  validateExamNodeVerification,
  verificationBadgeProps,
  type ExamNodeVerificationInput,
} from './exam-verification'

/** 固定“现在”：2026-11-19 12:00（北京时间），PoC 核查日。 */
const NOW_MS = Date.parse('2026-11-19T12:00:00+08:00')
/** A4 全量校验的评估时刻：8 个 reprint 节点实测核查于 2026-11-19 23:30，
 * 须取该时刻之后，否则“checked_at 不得晚于当前时间”规则会把真实核查判为未来值。
 * NOW_MS（12:00）仍用于其他与“当天”相关的断言，不动。 */
const VALIDATION_NOW_MS = Date.parse('2026-11-19T23:59:59+08:00')
/** 31 天前：2026-10-19 12:00（北京时间），已过期。 */
const EXPIRED_AT = '2026-10-19T12:00:00+08:00'
/** 新鲜核查时间：2026-11-19 10:00（北京时间）。 */
const FRESH_AT = '2026-11-19T10:00:00+08:00'

const OFFICIAL_SOURCE = 'https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html'
const OFFICIAL_ARCHIVED =
  'https://web.archive.org/web/20261119000000id_/https://www.beijing.gov.cn/gongkai/rsxx/gwyzk/202611/t20261109_4938196.html'
const REPRINT_SOURCE = 'https://www.hqwx.com/chengrengk-kaoshi/news/17859084897258.html'
const REPRINT_ARCHIVED =
  'https://web.archive.org/web/20261119000000id_/https://www.hqwx.com/chengrengk-kaoshi/news/17859084897258.html'

function officialNode(overrides: Partial<ExamNodeVerificationInput> = {}): ExamNodeVerificationInput {
  return {
    verification_level: 'official',
    source_url: OFFICIAL_SOURCE,
    archived_url: OFFICIAL_ARCHIVED,
    checked_at: FRESH_AT,
    confidence: 'medium',
    ...overrides,
  }
}

function reprintNode(overrides: Partial<ExamNodeVerificationInput> = {}): ExamNodeVerificationInput {
  return {
    verification_level: 'reprint',
    source_url: REPRINT_SOURCE,
    archived_url: REPRINT_ARCHIVED,
    checked_at: FRESH_AT,
    confidence: 'medium',
    ...overrides,
  }
}

function unverifiedNode(): ExamNodeVerificationInput {
  return { verification_level: 'unverified', confidence: 'low' }
}

describe('§2.1 validateExamNodeVerification', () => {
  it('official 双全 + 白名单域名 + 推导一致 → ok', () => {
    const r = validateExamNodeVerification('jingkao', officialNode(), NOW_MS)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('official 缺 archived_url → 拒绝（强制降级 reprint，不是警告）', () => {
    const r = validateExamNodeVerification('jingkao', officialNode({ archived_url: '' }), NOW_MS)
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/archived_url/)
  })

  it('official 缺 source_url → 拒绝', () => {
    const r = validateExamNodeVerification('jingkao', officialNode({ source_url: '' }), NOW_MS)
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/source_url/)
  })

  it('official 域名不在白名单内 → 拒绝并写明“域名未登记，请先登记再定级”', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      officialNode({ source_url: 'https://www.example.com/notice.html' }),
      NOW_MS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/域名未登记，请先登记再定级/)
  })

  it('reprint 缺 archived_url → 允许（任务书 PoC 填值规则 + §12.3：缺存档降级为 reprint，archived_url 留空）', () => {
    const r = validateExamNodeVerification('chengkao', reprintNode({ archived_url: '' }), NOW_MS)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('unverified 带 source_url → 拒绝（有来源就不能标未核实）', () => {
    const r = validateExamNodeVerification(
      'chengkao',
      { verification_level: 'unverified', source_url: REPRINT_SOURCE, confidence: 'low' },
      NOW_MS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/source_url/)
  })

  it('unverified 三空 + low → ok', () => {
    const r = validateExamNodeVerification('chengkao', unverifiedNode(), NOW_MS)
    expect(r.ok).toBe(true)
  })

  it('archived_url 非 Wayback 格式 → 拒绝', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      officialNode({ archived_url: 'https://example.com/archive/123' }),
      NOW_MS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/archived_url/)
  })

  it('checked_at 只有日期无时刻 → 拒绝', () => {
    const r = validateExamNodeVerification('jingkao', officialNode({ checked_at: '2026-11-19' }), NOW_MS)
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/checked_at/)
  })

  it('checked_at 在未来 → 拒绝', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      officialNode({ checked_at: '2026-11-20T10:00:00+08:00' }),
      NOW_MS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/checked_at/)
  })

  it('confidence 与推导值不一致 → 拒绝', () => {
    const r = validateExamNodeVerification('jingkao', officialNode({ confidence: 'high' }), NOW_MS)
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/confidence/)
  })

  it('estimated 节点 confidence 为 high → 拒绝（上限 medium）', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      officialNode({ estimated: true, confidence: 'high' }),
      NOW_MS,
    )
    expect(r.ok).toBe(false)
  })

  it('短链 source_url → 拒绝', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      officialNode({ source_url: 'https://t.cn/abc123' }),
      NOW_MS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/短链/)
  })

  it('本站自身 URL 作 source_url → 拒绝', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      officialNode({ source_url: 'https://shanyanghu.com/exam' }),
      NOW_MS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join('')).toMatch(/本站/)
  })

  it('level 非枚举值 → 拒绝', () => {
    const r = validateExamNodeVerification(
      'jingkao',
      { verification_level: 'trusted', confidence: 'low' } as unknown as ExamNodeVerificationInput,
      NOW_MS,
    )
    expect(r.ok).toBe(false)
  })
})

describe('§2.3 deriveConfidence', () => {
  it('official + 存档通过 + 30 天内 + reviewed_by 非空 → high', () => {
    expect(deriveConfidence(officialNode(), { reviewedBy: 'evolve-2026-11-19', nowMs: NOW_MS })).toBe('high')
  })

  it('official + reviewed_by 为空 → 上限 medium', () => {
    expect(deriveConfidence(officialNode(), { nowMs: NOW_MS })).toBe('medium')
  })

  it('official + 存档通过但 checked_at 超 30 天 → medium（A10）', () => {
    expect(
      deriveConfidence(officialNode({ checked_at: EXPIRED_AT }), {
        reviewedBy: 'evolve-2026-11-19',
        nowMs: NOW_MS,
      }),
    ).toBe('medium')
  })

  it('official 无存档 → 上限 medium（§12.3：存档失败不阻塞定级但上限 medium）', () => {
    expect(
      deriveConfidence(officialNode({ archived_url: '' }), { reviewedBy: 'evolve-2026-11-19', nowMs: NOW_MS }),
    ).toBe('medium')
  })

  it('reprint + 有存档 → medium', () => {
    expect(deriveConfidence(reprintNode(), { nowMs: NOW_MS })).toBe('medium')
  })

  it('reprint 无存档 → medium（§12.3：存档失败不阻塞定级，confidence 上限 medium）', () => {
    expect(deriveConfidence(reprintNode({ archived_url: '' }), { nowMs: NOW_MS })).toBe('medium')
  })

  it('unverified → low', () => {
    expect(deriveConfidence(unverifiedNode(), { nowMs: NOW_MS })).toBe('low')
  })

  it('estimated 节点上限 medium（即使 official + 复核 + 新鲜）', () => {
    expect(
      deriveConfidence(officialNode({ estimated: true }), { reviewedBy: 'evolve-2026-11-19', nowMs: NOW_MS }),
    ).toBe('medium')
  })
})

describe('A10 isVerificationExpired（30 天过期）', () => {
  it('31 天前的 official 节点 → 已过期', () => {
    expect(isVerificationExpired(officialNode({ checked_at: EXPIRED_AT }), NOW_MS)).toBe(true)
  })

  it('当天核查的节点 → 未过期', () => {
    expect(isVerificationExpired(officialNode(), NOW_MS)).toBe(false)
  })

  it('无 checked_at（unverified）→ 视为已过期', () => {
    expect(isVerificationExpired(unverifiedNode(), NOW_MS)).toBe(true)
  })
})

describe('§7 准入闸', () => {
  it('official + medium + 新鲜 → 进峰值日包', () => {
    expect(isPeakEligible(officialNode(), NOW_MS)).toBe(true)
  })

  it('reprint + medium + 新鲜 → 进峰值日包', () => {
    expect(isPeakEligible(reprintNode(), NOW_MS)).toBe(true)
  })

  it('unverified → 不进峰值日包', () => {
    expect(isPeakEligible(unverifiedNode(), NOW_MS)).toBe(false)
  })

  it('confidence 为 low → 不进峰值日包', () => {
    expect(isPeakEligible(reprintNode({ confidence: 'low' }), NOW_MS)).toBe(false)
  })

  it('过期 → 不进峰值日包', () => {
    expect(isPeakEligible(officialNode({ checked_at: EXPIRED_AT }), NOW_MS)).toBe(false)
  })

  it('.ics 订阅 feed：仅 official 进，reprint 不进', () => {
    expect(isIcsFeedEligible(officialNode(), NOW_MS)).toBe(true)
    expect(isIcsFeedEligible(reprintNode(), NOW_MS)).toBe(false)
    expect(isIcsFeedEligible(unverifiedNode(), NOW_MS)).toBe(false)
  })

  it('.ics 单文件下载：official / reprint 可下载，unverified 不提供', () => {
    expect(isIcsDownloadEligible(officialNode(), NOW_MS)).toBe(true)
    expect(isIcsDownloadEligible(reprintNode(), NOW_MS)).toBe(true)
    expect(isIcsDownloadEligible(unverifiedNode(), NOW_MS)).toBe(false)
  })
})

describe('§7.1 verificationBadgeProps', () => {
  it('official：实底文案含“官方原文已核实”与核查日期', () => {
    const props = verificationBadgeProps(officialNode())
    expect(props.tone).toBe('solid')
    expect(props.text).toMatch(/官方原文已核实/)
    expect(props.text).toMatch(/2026-11-19/)
  })

  it('reprint：描边文案带“转载级”字样', () => {
    const props = verificationBadgeProps(reprintNode())
    expect(props.tone).toBe('outline')
    expect(props.text).toMatch(/转载级/)
  })

  it('unverified：灰态“待核实”', () => {
    const props = verificationBadgeProps(unverifiedNode())
    expect(props.tone).toBe('muted')
    expect(props.text).toBe('待核实')
  })
})

describe('A4/A5：43 节点 5 字段齐全', () => {
  it('A4：全部 43 节点 verification_level 非空且 confidence 等于 deriveConfidence() 推导值', () => {
    const nodes: Array<{ examId: string; node: ExamNode }> = []
    for (const exam of EXAMS) {
      for (const node of exam.nodes) nodes.push({ examId: exam.id, node })
    }
    // 计数纠正（2026-11-19 实测）：细化方案称 46 节点，系 `label:` 行计数误含 3 行非节点
    //（ExamNode 接口字段 + ExamCountdownLine.label + nearestExamCountdown 内的 let label），
    // 11 场考试的真实节点数为 3+4+9+2+3+4+2+11+2+1+2 = 43。本断言以 43 为准。
    expect(nodes.length).toBe(43)
    for (const { examId, node } of nodes) {
      expect(node.verification_level, `${examId}:${node.label} verification_level 非空`).toBeTruthy()
      expect(
        node.confidence,
        `${examId}:${node.label} confidence 应等于推导值`,
      ).toBe(deriveConfidence(node))
    }
  })

  it('A5：全部 official 节点 source_url 与 archived_url 双全，且域名在白名单内', async () => {
    const { EXAM_OFFICIAL_DOMAINS } = await import('./exam-verification')
    for (const exam of EXAMS) {
      for (const node of exam.nodes) {
        if (node.verification_level !== 'official') continue
        expect(node.source_url, `${exam.id}:${node.label} source_url 非空`).toBeTruthy()
        expect(node.archived_url, `${exam.id}:${node.label} archived_url 非空`).toBeTruthy()
        const host = new URL(node.source_url as string).hostname
        expect(
          (EXAM_OFFICIAL_DOMAINS[exam.id] ?? []).includes(host),
          `${exam.id}:${node.label} 域名 ${host} 应在白名单内`,
        ).toBe(true)
      }
    }
  })

  it('全部节点通过 §2.1 校验（unverified 节点三空 + low 亦须通过）', () => {
    for (const exam of EXAMS) {
      for (const node of exam.nodes) {
        const r = validateExamNodeVerification(exam.id, node, VALIDATION_NOW_MS)
        expect(r.ok, `${exam.id}:${node.label} 应通过校验：${r.errors.join('；')}`).toBe(true)
      }
    }
  })
})

describe('A7：准入闸行为（unverified 节点）', () => {
  it('库内 unverified 节点（chengkao:江西成绩查询，PEAK 11-18 09:00）调 todayNodeDeadlineMs 返回 undefined', () => {
    const exam = EXAMS.find((e) => e.id === 'chengkao') as ExamInfo
    const node = exam.nodes.find((n) => n.label === '江西成绩查询') as ExamNode
    expect(node.verification_level).toBe('unverified')
    expect(todayNodeDeadlineMs({ exam, node, kind: 'today' }, NOW_MS)).toBeUndefined()
  })

  it('同一 PEAK 表项、换成已核实节点时返回目标时刻（对照：闸本身只拦未准入节点）', () => {
    const exam = EXAMS.find((e) => e.id === 'jingkao') as ExamInfo
    const verified: ExamNode = {
      ...(exam.nodes.find((n) => n.label === '报名') as ExamNode),
      verification_level: 'official',
      source_url: OFFICIAL_SOURCE,
      archived_url: OFFICIAL_ARCHIVED,
      checked_at: FRESH_AT,
      confidence: 'medium',
    }
    const ms = todayNodeDeadlineMs({ exam, node: verified, kind: 'endsToday' }, NOW_MS)
    expect(ms).toBe(Date.parse('2026-11-18T18:00:00+08:00'))
  })

  it('全部当前 unverified 的 PEAK 表项（11 项）调 peakDayDeadlineMs 均返回 undefined', () => {
    // PEAK 表 19 项中 8 项已核实（reprint，准入）；其余 11 项的节点均为
    // unverified，准入闸须把它们全部拦下（时刻倒计时不渲染、PEAK 表不收）。
    const unverifiedPeakKeys = [
      'chengkao:江西成绩查询',
      'chengkao:新疆成绩查询',
      'chengkao:天津成绩复核',
      'chengkao:新疆成绩复核',
      'chengkao:江西成绩复核',
      'guangdong-zikao:成绩查询',
      'chengkao:浙江志愿确认',
      'shengkao:上海准考证打印',
      'shengkao:山东准考证打印',
      'shengkao:浙江准考证打印',
      'shengkao:江苏准考证打印',
    ]
    expect(unverifiedPeakKeys).toHaveLength(11)
    for (const key of unverifiedPeakKeys) {
      const [examId, label] = key.split(':')
      const exam = EXAMS.find((e) => e.id === examId) as ExamInfo
      const node = exam.nodes.find((n) => n.label === label) as ExamNode
      expect(node.verification_level, `${key} 应为 unverified`).toBe('unverified')
      expect(peakDayDeadlineMs(exam, node, NOW_MS), `${key} 准入闸应返回 undefined`).toBeUndefined()
    }
  })
})
