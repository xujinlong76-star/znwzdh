/**
 * 考试节点核验工作流（01-verification-workflow §2 / §7 / §8）。
 *
 * 本文件是核验级别的唯一事实源：`VerificationLevel` / `VerificationConfidence`
 * 只在这里定义，`exam-calendar.ts` 的 `ExamNode` 直接 import 复用，不另定义第二套。
 * 本文件不 import `exam-calendar.ts`（只用结构型输入类型），避免循环依赖。
 *
 * 诚实口径与裁决记录（2026-11-19 PoC 核查）：
 *  - CDX 反查（`web.archive.org/cdx`，2026-11-19 实测）：10 个 PoC 节点的公告原文页
 *    均无 Wayback 快照（京考首都之窗公告、海南 ea.hainan.gov.cn 公告、eol.cn
 *    军队文职全文、hqwx 天津复核页、东莞市政府转发的广东成考通知 PDF、常州网江苏
 *    自考转载均为 `[]`；CDX 本身可用，以 example.com 对照验证）。
 *  - 冲突裁决（任务书 PoC 填值规则 vs 方案 §2.1）：方案 §2.1 称 reprint 的
 *    archived_url 必填、无存档的转载只能标 unverified；任务书则写明“archived_url
 *    只有经 CDX 反查确认真实存在的 Wayback URL 才填，否则留空并按规则降级：
 *    official 要求 source+archived 双全，缺存档就只能是 reprint”，且 §12.3
 *    存档失败行亦称“archived_url 留空、confidence 上限 medium、不阻塞定级”。
 *    本批以任务书 + §12.3 为准：reprint 允许 archived_url 为空（有真实 source_url
 *    且已读、confidence 上限 medium）；official 仍要求 source+archived 双全。
 *    本轮结果：8 节点 reprint（PoC 6 + 同源相邻 2），其余 35 节点 unverified。
 *    待 SPN2 存档链路（W1 的 scripts/exam-verify.mjs，需 IA_S3 凭据）跑通并 CDX
 *    反查通过后，方可逐节点升级 official。
 *  - 域名白名单只登记两处来源：① exam-calendar.ts 文件头注释已载明的官方域名；
 *    ② 各考试公告原文页的实际域名（逐场在下方注释写明出处：公告标题 + 核查日期）。
 *    `*.gov.cn` 等只是候选，只有登记进表的域名才放行 official；转载域名永不进表。
 */

export type VerificationLevel = 'official' | 'reprint' | 'unverified'
export type VerificationConfidence = 'high' | 'medium' | 'low'

/** 核验 5 字段的结构型输入（ExamNode 的核验子集；exam-calendar.ts 直接复用本类型）。 */
export interface ExamNodeVerificationInput {
  verification_level: VerificationLevel
  source_url?: string
  archived_url?: string
  /** ISO 8601（北京时间，须含时刻，如 2026-11-19T10:00:00+08:00）；unverified 时为空。 */
  checked_at?: string
  confidence: VerificationConfidence
  /** 预计日期：官方未公布确切日时 confidence 上限 medium。 */
  estimated?: boolean
}

export const VERIFICATION_LEVELS: readonly VerificationLevel[] = ['official', 'reprint', 'unverified']
export const VERIFICATION_CONFIDENCES: readonly VerificationConfidence[] = ['high', 'medium', 'low']

/** 30 天过期窗口（§2.3 / §7.2：official 级节点超过 30 天未复核即过期）。 */
export const VERIFICATION_EXPIRY_MS = 30 * 24 * 3600 * 1000

/**
 * 官方域名白名单（§2.2）。键为 ExamInfo.id，11 场逐场登记。
 * 登记出处（公告标题 + 核查日期）逐场写在注释里；转载域名永不进表。
 */
export const EXAM_OFFICIAL_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  // 国考：国家公务员局 2027 年度招考专题站 bm.scs.gov.cn/kl2027（2026-11-18 直访证实为
  // 引导页，跳转至 www.scs.gov.cn/gkIndex.html）与报名确认及准考证打印系统 gwy.cpta.com.cn
  //（官方 2026-10-25 公告《报名确认及准考证打印网址》所载；exam-calendar.ts 文件头注释）。
  guokao: ['bm.scs.gov.cn', 'gwy.cpta.com.cn'],
  // 四六级：全国大学英语四、六级考试报名网 cet-bm.neea.edu.cn（教育部教育考试院；
  // exam-calendar.ts 文件头注释，2026-11-17 live 直访核实）。
  cet: ['cet-bm.neea.edu.cn'],
  // 省考七省准考证打印入口（exam-calendar.ts 文件头注释，2026-11-17 按各省公告原文逐项核实）：
  // 天津 gklx.hrss.tj.gov.cn、山东 gwy.sdrsks.org.cn、四川 www.scpta.com.cn、
  // 浙江 gwy.zjks.gov.cn、江苏 jshrss.jiangsu.gov.cn、广东 ggfw.hrss.gd.gov.cn、
  // 上海 www.shacs.gov.cn。
  shengkao: [
    'gklx.hrss.tj.gov.cn',
    'gwy.sdrsks.org.cn',
    'www.scpta.com.cn',
    'gwy.zjks.gov.cn',
    'jshrss.jiangsu.gov.cn',
    'ggfw.hrss.gd.gov.cn',
    'www.shacs.gov.cn',
  ],
  // 教资面试：中小学教师资格考试网 ntce.neea.edu.cn（exam-calendar.ts 文件头注释，
  // 2026-11-18 按北京/江西/黑龙江/吉林/山东公告核实）。
  'jiaoshi-mianshi': ['ntce.neea.edu.cn'],
  // 军队文职：报名系统 wzryzk.81rc.mil.cn 与军队人才网 www.81rc.mil.cn
  //（exam-calendar.ts 文件头注释，2026-11-18 按公告全文转载核实，公告原文所载系统入口）。
  'jundui-wenzhi': ['wzryzk.81rc.mil.cn', 'www.81rc.mil.cn'],
  // 京考：北京市人事考试通用平台 rsj.beijing.gov.cn（北京市公务员局《北京市各级机关
  // 2027 年度考试录用公务员公告》，首都之窗 2026-11-09 发布，2026-11-17 直访核实）与
  // 首都之窗 www.beijing.gov.cn（公告原文页域名，2026-11-19 CDX 反查时确认在位）。
  jingkao: ['rsj.beijing.gov.cn', 'www.beijing.gov.cn'],
  // 考研：研招网 yz.chsi.com.cn（exam-calendar.ts 文件头注释：日期来源研招网）。
  kaoyan: ['yz.chsi.com.cn'],
  // 成考：江西报名系统 jdyw.jxeea.cn（江西省教育考试院 2026-11-13 公告原文所载，
  // exam-calendar.ts 文件头注释）；海南 ea.hainan.gov.cn（《海南省2026年成人高校招生
  // 全国统一考试成绩发布公告》2026-11-18 发布，2026-11-19 live 直读核实）与查询入口
  // crgk.hnks.gov.cn（同公告所载）；新疆 www.xjzk.gov.cn（新疆教育考试院官网“新疆招生网”，
  // exam-calendar.ts 文件头注释，2026-11-18 按 2026-11-16 公告原文核实）；广东
  // www.eeagd.edu.cn（广东省自学考试管理系统，广东省教育考试院 2026-11-10 公告原文所载）
  // 与 eea.gd.gov.cn（广东省教育考试院官网，2026-11-19 实测索引页列有 2026-11-10 两则公告）。
  chengkao: [
    'jdyw.jxeea.cn',
    'ea.hainan.gov.cn',
    'crgk.hnks.gov.cn',
    'www.xjzk.gov.cn',
    'www.eeagd.edu.cn',
    'eea.gd.gov.cn',
  ],
  // 江苏自考：江苏省教育考试院门户网站 www.jseea.cn（exam-calendar.ts 文件头注释，
  // 2026-11-18 核实：成绩 11-18 10:00 发布，入口为该站“招考业务”栏目“自学考试”页面）。
  'jiangsu-zikao': ['www.jseea.cn'],
  // 广东自考：广东省自学考试管理系统 www.eeagd.edu.cn 与广东省教育考试院官网 eea.gd.gov.cn
  //（广东省教育考试院 2026-11-10 省自考委办公告原文，exam-calendar.ts 文件头注释）。
  'guangdong-zikao': ['www.eeagd.edu.cn', 'eea.gd.gov.cn'],
  // 上海自考：上海市教育考试院官网 www.shmeea.edu.cn 与考生服务平台 ste.shmeea.edu.cn
  //（exam-calendar.ts 文件头注释，2026-11-18 按 2026-11-13 公告原文核实）。
  'shanghai-zikao': ['www.shmeea.edu.cn', 'ste.shmeea.edu.cn'],
}

/** 短链域名（§2.1：禁止短链作 source_url）。 */
const SHORT_LINK_HOSTS: ReadonlySet<string> = new Set([
  'bit.ly',
  't.cn',
  'tinyurl.com',
  'goo.gl',
  'is.gd',
  'suo.im',
  'dwz.cn',
  'url.cn',
])

/** 本站自身域名（§2.1：禁止本站自身 URL 作 source_url）。 */
const OWN_HOSTS: ReadonlySet<string> = new Set(['shanyanghu.com', 'www.shanyanghu.com', 'localhost'])

/** Wayback 存档 URL 格式（§2.1）：`^https://web\.archive\.org/web/\d{14}id_/https?://`。 */
export const ARCHIVED_URL_RE = /^https:\/\/web\.archive\.org\/web\/\d{14}id_\/https?:\/\//

/** checked_at 格式：ISO 8601 且含时刻（`YYYY-MM-DDTHH:mm`，禁止只有日期）。 */
const CHECKED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export interface DeriveConfidenceOptions {
  /** 复核人（第二双眼睛）：为空时 confidence 上限 medium（§2.3 硬条件）。 */
  reviewedBy?: string | null
  /**
   * 存档 CDX 反查是否通过。缺省时以 archived_url 是否非空为准（写入时已做 CDX 反查，
   * 见 §12.3；运行期不重新打 CDX）。
   */
  archiveVerified?: boolean
  nowMs?: number
}

/**
 * confidence 推导（§2.3，非手填；按顺序取第一条命中者）。
 * reviewed_by 为空时上限 medium；estimated 上限 medium；与上表取低者。
 */
export function deriveConfidence(
  node: ExamNodeVerificationInput,
  opts: DeriveConfidenceOptions = {},
): VerificationConfidence {
  const nowMs = opts.nowMs ?? Date.now()
  if (node.verification_level === 'unverified') return 'low'
  if (node.verification_level !== 'official' && node.verification_level !== 'reprint') return 'low'
  const archiveOk = opts.archiveVerified ?? (node.archived_url !== undefined && node.archived_url !== '')
  const checkedMs = parseCheckedAt(node.checked_at)
  if (checkedMs === undefined) return 'low'
  const fresh = nowMs - checkedMs <= VERIFICATION_EXPIRY_MS
  let result: VerificationConfidence
  if (node.verification_level === 'official') {
    // official：存档通过 + 30 天内 + 复核人非空 → high；其余（无存档 / 过期 / 无复核）→ medium。
    result =
      archiveOk && fresh && opts.reviewedBy !== undefined && opts.reviewedBy !== null && opts.reviewedBy !== ''
        ? 'high'
        : 'medium'
  } else {
    // reprint：一律 medium（§2.3 reprint 行 + §12.3 存档失败行：存档失败不阻塞定级，
    // confidence 上限 medium；无存档的 reprint 不再降为 low，见文件头裁决记录）。
    result = 'medium'
  }
  if (node.estimated === true && result === 'high') return 'medium'
  return result
}

function parseCheckedAt(checkedAt: string | undefined): number | undefined {
  if (checkedAt === undefined || checkedAt === '') return undefined
  const ms = Date.parse(checkedAt)
  return Number.isNaN(ms) ? undefined : ms
}

/** 30 天过期判定（§2.3 / A10）：无 checked_at 或不可解析视为已过期。 */
export function isVerificationExpired(
  node: Pick<ExamNodeVerificationInput, 'checked_at'>,
  nowMs: number = Date.now(),
): boolean {
  const checkedMs = parseCheckedAt(node.checked_at)
  if (checkedMs === undefined) return true
  return nowMs - checkedMs > VERIFICATION_EXPIRY_MS
}

export interface ValidateExamNodeVerificationOptions {
  reviewedBy?: string | null
}

export interface ExamNodeVerificationValidation {
  ok: boolean
  errors: string[]
}

/**
 * §2.1 校验。返回 `{ ok, errors[] }`；official 时 source_url 与 archived_url 必须
 * 同时非空，否则拒绝（调用方须强制降级为 reprint，不是警告）。
 */
export function validateExamNodeVerification(
  examId: string,
  node: ExamNodeVerificationInput,
  nowMs: number = Date.now(),
  opts: ValidateExamNodeVerificationOptions = {},
): ExamNodeVerificationValidation {
  const errors: string[] = []
  const level = node.verification_level
  if (!VERIFICATION_LEVELS.includes(level)) {
    errors.push(`verification_level 非法：${String(level)}（只允许 official / reprint / unverified）`)
    return { ok: false, errors }
  }
  if (!VERIFICATION_CONFIDENCES.includes(node.confidence)) {
    errors.push(`confidence 非法：${String(node.confidence)}（只允许 high / medium / low）`)
  }
  // confidence 由规则推导、不是手填自由值：手填值与推导值不一致时以推导值为准，校验失败。
  const derived = deriveConfidence(node, { reviewedBy: opts.reviewedBy, nowMs })
  if (node.confidence !== derived) {
    errors.push(`confidence 应为推导值 ${derived}，手填 ${node.confidence} 与推导不一致`)
  }
  if (node.estimated === true && node.confidence === 'high') {
    errors.push('estimated 节点 confidence 上限为 medium，不得标 high')
  }

  const source = node.source_url ?? ''
  const archived = node.archived_url ?? ''
  const checkedAt = node.checked_at ?? ''

  if (level === 'unverified') {
    if (source !== '') errors.push('unverified 节点 source_url 必须为空（有来源就不能标未核实）')
    if (archived !== '') errors.push('unverified 节点 archived_url 必须为空')
    if (checkedAt !== '') errors.push('unverified 节点 checked_at 必须为空')
    return { ok: errors.length === 0, errors }
  }

  // official：source_url 与 archived_url 必须同时非空（缺一即强制降级 reprint）。
  // reprint：source_url 必须非空；archived_url 允许为空（任务书 PoC 填值规则 + §12.3
  // 存档失败行：缺存档降级为 reprint、archived_url 留空、confidence 上限 medium；
  // 覆盖方案 §2.1“reprint 存档必填”一行，见文件头裁决记录）。
  if (source === '') errors.push(`${level} 节点 source_url 必须非空`)
  if (level === 'official' && archived === '') {
    errors.push('official 节点 archived_url 必须非空（缺存档请降级为 reprint）')
  }
  if (checkedAt === '') errors.push(`${level} 节点 checked_at 必须非空`)

  if (source !== '') {
    let url: URL | undefined
    try {
      url = new URL(source)
    } catch {
      url = undefined
    }
    if (url === undefined || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      errors.push('source_url 须为 http(s):// URL')
    } else {
      if (SHORT_LINK_HOSTS.has(url.hostname)) errors.push('source_url 禁止短链')
      if (OWN_HOSTS.has(url.hostname)) errors.push('source_url 禁止本站自身 URL')
      if (level === 'official') {
        const allowed = EXAM_OFFICIAL_DOMAINS[examId]
        if (allowed === undefined) {
          errors.push(`考试 ${examId} 未登记官方域名，域名未登记，请先登记再定级`)
        } else if (!allowed.includes(url.hostname)) {
          errors.push(`source_url 域名 ${url.hostname} 未登记在 ${examId} 的白名单内，域名未登记，请先登记再定级`)
        }
      }
    }
  }

  if (archived !== '' && !ARCHIVED_URL_RE.test(archived)) {
    errors.push('archived_url 须匹配 ^https://web.archive.org/web/\\d{14}id_/https?://')
  }

  if (checkedAt !== '') {
    if (!CHECKED_AT_RE.test(checkedAt)) {
      errors.push('checked_at 禁止只有日期无时刻，须为 ISO 8601 含时刻（如 2026-11-19T09:00:00+08:00）')
    } else {
      const checkedMs = parseCheckedAt(checkedAt)
      if (checkedMs === undefined) errors.push('checked_at 无法解析为有效日期时间')
      else if (checkedMs > nowMs) errors.push('checked_at 不得晚于当前时间')
    }
  }

  return { ok: errors.length === 0, errors }
}

export type VerificationBadgeTone = 'solid' | 'outline' | 'muted'

export interface VerificationBadgeProps {
  level: VerificationLevel
  /** 徽标文案（真实文本，不得只用颜色区分，§9.4）。 */
  text: string
  tone: VerificationBadgeTone
  /** 展开详情用：核查时间（北京时间 YYYY-MM-DD HH:mm）或 null。 */
  checkedLabel: string | null
}

function formatCheckedLabel(checkedAt: string | undefined): string | null {
  if (checkedAt === undefined || checkedAt === '') return null
  const ms = Date.parse(checkedAt)
  if (Number.isNaN(ms)) return null
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** §7.1 徽标文案（写死）。 */
export function verificationBadgeProps(node: ExamNodeVerificationInput): VerificationBadgeProps {
  if (node.verification_level === 'official') {
    const date = formatCheckedLabel(node.checked_at)?.slice(0, 10) ?? ''
    return {
      level: 'official',
      text: date === '' ? '官方原文已核实' : `官方原文已核实 · ${date}`,
      tone: 'solid',
      checkedLabel: formatCheckedLabel(node.checked_at),
    }
  }
  if (node.verification_level === 'reprint') {
    return {
      level: 'reprint',
      text: '转载级 · 未直读官方原文',
      tone: 'outline',
      checkedLabel: formatCheckedLabel(node.checked_at),
    }
  }
  return { level: 'unverified', text: '待核实', tone: 'muted', checkedLabel: null }
}

/**
 * §7.2 峰值日包准入闸（库内可判定部分）：① 级别 official/reprint；② confidence high/medium；
 * ③ checked_at 在 30 天内。④ A1 断言 verdict === 'verified' 是 DB 侧条件（exam_verifications
 * 表），不在本函数内判定；调用方不得绕过本闸另设白名单。
 */
export function isPeakEligible(
  node: ExamNodeVerificationInput,
  nowMs: number = Date.now(),
): boolean {
  if (node.verification_level !== 'official' && node.verification_level !== 'reprint') return false
  if (node.confidence !== 'high' && node.confidence !== 'medium') return false
  return !isVerificationExpired(node, nowMs)
}

/** §7.1：.ics 订阅 feed 只收 official 级节点（另须满足峰值日包同款新鲜度与置信度）。 */
export function isIcsFeedEligible(
  node: ExamNodeVerificationInput,
  nowMs: number = Date.now(),
): boolean {
  return node.verification_level === 'official' && isPeakEligible(node, nowMs)
}

/** §7.1：.ics 单文件下载 official / reprint 均可，unverified 不提供。 */
export function isIcsDownloadEligible(
  node: ExamNodeVerificationInput,
  nowMs: number = Date.now(),
): boolean {
  return isPeakEligible(node, nowMs)
}

/**
 * 报错草稿输入（§9.3 / §2.6）：读者报错先以 how_discovered='reader_tip' 建草稿行，
 * corrected_text、original_published_at 与 correction_published_at 为空，核查确认后
 * 才补全发布；未确认的报错不直接改节点字段。originalPublishedAt 为 NULL 的原因
 * （R3）：节点数据无逐条发布时间，未知即 NULL，不得以举报时间占位冒充原文发布时间。
 */
export type ExamCorrectionErrorType = 'factual' | 'date' | 'url' | 'attribution' | 'context'

export interface ExamCorrectionDraftInput {
  examId: string
  nodeLabel: string
  /** 关联被更正的断言（exam_verifications.assertion_hash）；草稿态为节点文案的 SHA-256。 */
  assertionHash: string
  /** 原文逐字（被更正前的节点文案）。 */
  originalText: string
  correctedText: string
  errorType: ExamCorrectionErrorType
  /** 原因（读者描述原文）。 */
  reason: string
  howDiscovered: 'reader_tip' | 'internal_review' | 'source_complaint'
  /** 读者提供的来源链接（选填；W1 的 exam_corrections 表无此列，写入时由适配器以
   * 「来源链接：」行并入 reason，不丢信息）。 */
  sourceUrl?: string
  /** 联系方式（选填；同上，以「联系方式：」行并入 reason）。 */
  contact?: string
  /**
   * 原文首次发布时间（毫秒时间戳）。草稿态为 null：节点数据无逐条发布时间，未知
   * 即 NULL，不得以举报时间占位冒充（R3）；核查确认时由核查人以实际发布时间补正。
   * store 侧草稿分支允许两时间戳为 NULL，正式更正行仍强制必填。
   */
  originalPublishedAt: number | null
  correctionPublishedAt: number | null
  location: 'in_article' | 'corrections_page' | 'both'
  correctedBy: string
}
