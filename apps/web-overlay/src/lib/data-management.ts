/**
 * 数据管理页（/admin/data）的纯逻辑：部署基线与灌入状态判定。
 *
 * 基线数字的出处（都不许凭空改）：
 *   - 站点 322：一级 14 / 二级 47 / 站点 322，实测自
 *     `apps/web-overlay/src/navsphere/content/navigation.json`
 *     （data-management.test.ts 每次跑测试都会重数一遍，漂移即红）。
 *   - 视频 6007：实测自 `apps/web-overlay/src/navsphere/content/videos.json`
 *    （带 bvid / durationSec+title 的条目数，测试每次重数，漂移即红）。
 *     该文件即 `kv:videos` 的灌入源。
 *
 * 判定只回答「灌了没有」，不回答「够不够用」：
 *   - 0 条 = 空（一定是漏了导入）；
 *   - (0, 基线) = 低于基线（可能漏了导入，也可能被删过——页面只提示核对，
 *     不擅自下结论）；
 *   - ≥ 基线 = 已灌入（之后管理员自己加站，超基线是正常的）。
 */

export const BASELINE_SITES = 322
export const BASELINE_VIDEOS = 6007

export type SeedStatus = 'seeded' | 'below-baseline' | 'empty'

export function seedStatus(actual: number, baseline: number): SeedStatus {
  if (!Number.isFinite(actual) || actual <= 0) return 'empty'
  if (actual < baseline) return 'below-baseline'
  return 'seeded'
}

/* ------------------------------------------------------------------ *
 * 冷启动基线导入标记（A1 的 baseline-import.json，A9 合并卡）
 *
 * 写入方是中枢 apps/api/src/baseline.ts：每次种子检查结束都把结论写成
 * 一份普通存储文档 `baseline-import.json`（经 GET /api/storage 读取）。
 * 文档形状（与 baseline.ts 的 BaselineImportResult 落库口径逐字对应，
 * 落库时去掉 markerWritten）：
 *   { version: 1, at: ISO 时间,
 *     navigation: { status, count, fileCount, categories, error? },
 *     videos:     { status, count, fileCount, error? } }
 * count / fileCount / categories 都可为 null（关闭或文件不可读时不适用）。
 *
 * 读取方的现实形状比 A1 初版页面假设的更多样，必须全兼容：
 *   - 文档从未写入：中枢 readKv 返回 null，GET 直接回 JSON null；
 *   - 早期假设的信封 { synced: false, document: null }（文档不存在）；
 *   - 信封 { document: {...} } / { document: "{...}" }（包了一层时拆开）；
 *   - 标记本体直接返回（当前中枢的实际行为）。
 * 前三种里「不存在」一律判 missing（页面显示「暂无基线导入记录」），
 * 结构对不上的判 invalid（页面只在该卡说「暂时读不到」，不拖累整页）。
 * ------------------------------------------------------------------ */

export type BaselineStatus =
  | 'imported'
  | 'skipped_existing'
  | 'missing_file'
  | 'failed'
  | 'disabled'

const BASELINE_STATUSES: ReadonlySet<string> = new Set([
  'imported',
  'skipped_existing',
  'missing_file',
  'failed',
  'disabled',
])

export interface BaselineSection {
  status: BaselineStatus
  /** 库内现有/导入后的条数；不适用为 null */
  count: number | null
  /** 基线文件里的条数；文件不可读为 null */
  fileCount: number | null
  /** 仅导航段有：类目数；不适用为 null */
  categories: number | null
  error?: string
}

export interface BaselineMarker {
  version: number
  /** 最近一次种子检查时间（ISO 字符串，原样透传） */
  at: string
  navigation: BaselineSection
  videos: BaselineSection
}

export type BaselineParseResult =
  | { kind: 'present'; marker: BaselineMarker }
  | { kind: 'missing' }
  | { kind: 'invalid' }

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseBaselineSection(raw: unknown): BaselineSection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.status !== 'string' || !BASELINE_STATUSES.has(obj.status)) return null
  const section: BaselineSection = {
    status: obj.status as BaselineStatus,
    count: finiteOrNull(obj.count),
    fileCount: finiteOrNull(obj.fileCount),
    categories: finiteOrNull(obj.categories),
  }
  if (typeof obj.error === 'string' && obj.error.trim()) section.error = obj.error
  return section
}

export function parseBaselineMarker(raw: unknown): BaselineParseResult {
  // 文档从未写入：中枢直接回 null
  if (raw === null || raw === undefined) return { kind: 'missing' }
  // 个别代理/缓存可能把 JSON 文本原样透传，先解一层字符串
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text || text === 'null') return { kind: 'missing' }
    try {
      return parseBaselineMarker(JSON.parse(text) as unknown)
    } catch {
      return { kind: 'invalid' }
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid' }
  const obj = raw as Record<string, unknown>
  // 信封形态：{ synced: false, document: null } = 明确不存在；
  // { document: X } 时拆开 X 继续判（X 本身可能是 null / 对象 / 字符串）
  if ('document' in obj) {
    if (obj.document === null || obj.document === undefined) return { kind: 'missing' }
    return parseBaselineMarker(obj.document)
  }
  if (obj.synced === false && !('navigation' in obj) && !('videos' in obj)) {
    return { kind: 'missing' }
  }
  const navigation = parseBaselineSection(obj.navigation)
  const videos = parseBaselineSection(obj.videos)
  if (!navigation || !videos) return { kind: 'invalid' }
  if (typeof obj.at !== 'string' || !obj.at) return { kind: 'invalid' }
  return {
    kind: 'present',
    marker: {
      version: typeof obj.version === 'number' && Number.isFinite(obj.version) ? obj.version : 1,
      at: obj.at,
      navigation,
      videos,
    },
  }
}
