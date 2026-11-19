/**
 * 数据管理页（/admin/data）的纯逻辑：部署基线与灌入状态判定。
 *
 * 基线数字的出处（都不许凭空改）：
 *   - 站点 377：一级 14 / 二级 48 / 站点 377，实测自
 *     `apps/web-overlay/src/navsphere/content/navigation.json`
 *     （data-management.test.ts 每次跑测试都会重数一遍，漂移即红）。
 *     2026-11-15 T5 元宝收录：新增「AI 搜索」二级与元宝搜索一站，基线 333→334、二级 47→48。
 *     2026-11-15 卸载合集：补 github.com/trending 一站，基线 334→335。
 *     2026-11-16 进化第 89 轮 B 线：补齐「AI 搜索知识」二级（Kimi 搜索/秘塔搜索/Perplexity/天工AI搜索/Miku 搜索），基线 335→340。
 *     2026-11-16 进化第 92 轮 D 线：补站「编程学习」二级（freeCodeCamp/廖雪峰教程），基线 340→342。
 *     2026-11-17 进化轮 A 线：下线死链「Miku 搜索」（证书过期），基线 342→341。
 *     2026-11-17 进化轮 15:22：补站 U-22（Todoist/Make/Descript/OpusClip/NotebookLM），基线 341→346。
 *     2026-11-18 进化轮 05:22：补站微博（消费生活 > 社交与婚恋），基线 346→347。
 *     2026-11-19 进化轮 16:22：补站 U-08（AI 短剧与漫剧创作：SkyReels/讯飞绘镜），基线 347→349。
 *     2026-11-19 进化轮 19:22：补站 U-08（配色与色板：Paletton/Color Hunt/Khroma；编程学习：The Odin Project；在线课程：edX），基线 349→354。
 *     2026-11-19 进化轮 21:22：补站 U-08（UI 资源素材 1 站、气象与环境 1 站、数字图书馆 2 站、免费短剧 3 站、学习路线 4 站），基线 354→365。
 *     2026-11-19 进化轮 22:22：补站 U-08（影视评分 2 站），基线 365→367。
 *     2026-11-19 进化轮 23:22：补站 U-08（官方文档 2 站），基线 367→369。
 *     2026-11-20 进化轮 00:22：补站 U-08（配色与色板 2 站），基线 369→371。
 *     2026-11-20 进化轮 01:22：补站 U-08（免费短剧：FlexTV/MoboReels 2 站），基线 371→373。
 *     2026-11-20 进化轮 02:22：补站 U-08（问答社区 2 站），基线 373→375。
 *     2026-11-20 进化轮 05:08：补站 U-252（免费短剧：Melolo 1 站），基线 375→376。
 *     2026-11-20 进化轮 05:22：补站 U-08（容器与编排：Rancher 1 站），基线 376→377。
 *   - 视频 2265：实测自 `apps/web-overlay/src/navsphere/content/videos.json`
 *    （导航分类 items + 子分类 items 的条目数，与 storage.ts
 *     countVideoDocItems 同口径，测试每次重数，漂移即红）。
 *     该文件即 `kv:videos` 的灌入源。
 *
 * 判定只回答「灌了没有」，不回答「够不够用」：
 *   - 0 条 = 空（一定是漏了导入）；
 *   - (0, 基线) = 低于基线（可能漏了导入，也可能被删过——页面只提示核对，
 *     不擅自下结论）；
 *   - ≥ 基线 = 已灌入（之后管理员自己加站，超基线是正常的）。
 */

export const BASELINE_SITES = 377
export const BASELINE_VIDEOS = 2265

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
