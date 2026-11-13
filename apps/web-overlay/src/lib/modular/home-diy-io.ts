'use client'

/**
 * 首页 DIY 的导入/导出与云端金库逻辑（从 use-home-diy.ts 拆出，2026-10-19 P1-1）。
 *
 * 这里只放不依赖 React 的纯逻辑：解析、校验、加密、云端请求。
 * 落盘/共享状态由调用方注入 persist，避免这个文件反过来依赖存储单例。
 */
import { getIdentity } from '@/lib/identity'
import {
  createShortLinkForTarget,
  deleteCloudVault,
  fetchCloudVault,
  saveCloudVault,
  type VaultResultCode,
  type VaultTelemetryOutcome,
} from '@/lib/navhub-api'
import { diyShareUrlToShortlinkTarget } from '@/lib/diy-share-link'
import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { DIY_IMPORT_MAX_BYTES } from '@/lib/modular/diy-layout-schema'
import { VAULT_REBUILD_VERSION_COPY } from '@/lib/modular/vault-copy'
import { decryptGenericPayload, encryptGenericPayload } from '@/lib/vault'
import {
  backupHomeDiyShareConfig,
  computeHomeDiyShareDiff,
  mergeHomeDiyShareFields,
  safeLocalStorage,
  type HomeDiyShareField,
  type HomeDiyStorage,
  type HomeDIYConfig,
} from './home-diy-storage'

export type HomeDiyPersist = (updater: (prev: HomeDIYConfig) => HomeDIYConfig) => void

/** 还原结果：message 已经带上「还原了什么 / 丢掉了什么」，调用方直接展示即可 */
export interface HomeDiyImportResult {
  ok: boolean
  message: string
  /** 被白名单或上限吃掉的用户内容条数（0 且 notes 为空才谈得上全量） */
  dropped: number
  notes: string[]
  /** 「还原了什么」的小结，不含成功/失败语气，供其它入口复用 */
  summary?: string
  /** 失败原因码（成功时不带）；供埋点与分支判断，不替代 message */
  code?: VaultResultCode
  /** 应用前自动备份的键（`<STORAGE_KEY>.share-backup.<时间戳>`）；备份失败为 null */
  backupKey?: string | null
}

function summarizeDiyCounts(config: any): string {
  const cats = Array.isArray(config?.customCategories) ? config.customCategories : []
  const siteCount = cats.reduce(
    (n: number, c: any) => n + (Array.isArray(c?.items) ? c.items.length : 0),
    0,
  )
  const listCount = ['categoryOrder', 'pinnedCategoryIds', 'hiddenCategoryIds', 'collapsedCategoryIds'].reduce(
    (n: number, k: string) => n + (Array.isArray(config?.[k]) ? config[k].length : 0),
    0,
  )
  const widgetCount = Array.isArray(config?.heroDeckWidgets) ? config.heroDeckWidgets.length : 0
  return `自定义分类 ${cats.length} 个（站点 ${siteCount} 条）、分类排序/显隐 ${listCount} 项、首屏小组件 ${widgetCount} 个`
}

/**
 * 把清洗台账翻成给用户看的一句话。
 * 「全量还原」是无法验证的断言：清洗本身带白名单和上限，只有 dropped===0 且 notes 为空才谈得上全量。
 */
/**
 * 从 catch 的 unknown 里安全取出可读消息。
 *
 * 为什么需要：catch (e: any) 会让 e.message 绕过类型检查，而 any 是显式
 * 类型债务（本仓库有棘轮守卫盯着）。改成 unknown 后直接访问 .message 会编译失败，
 * 所以统一走这个收窄助手 —— 它同时兜住「抛出的是字符串」「抛出的是 null」这类真实情况。
 */
function errorMessageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === "string" && e) return e
  return fallback
}

/**
 * 中枢客户端抛出的 hubError 带 status（见 lib/navhub-api.ts 的 hubError）；
 * 其它错误（断网的 TypeError、超时、JSON 解析失败）没有——读不到就当未知失败。
 */
function hubErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null
  const status = (error as { status: unknown }).status
  return typeof status === 'number' ? status : null
}

export function describeDiyRestoreReport(config: any, report: { dropped: number; notes: string[] }): string {
  const counts = summarizeDiyCounts(config)
  if (!report.notes.length) return `${counts}，未发现被丢弃的内容`
  const shown = report.notes.slice(0, 3).join('；')
  const more = report.notes.length > 3 ? ` 等 ${report.notes.length} 项` : ''
  const head =
    report.dropped > 0
      ? `${report.dropped} 条内容因白名单或上限被丢弃/截断`
      : '部分设置值不在支持列表，已回退默认'
  return `${counts}；${head}：${shown}${more}`
}

export function exportDIYConfig(config: HomeDIYConfig): string {
  return JSON.stringify(config, null, 2)
}

/* ------------------------------------------------------------------ *
 * DIY 分享短链（M6）：完整 `#diy=` 链接之外，再给一个短链选项
 *
 * 今天的实话（中枢两层把关，见 apps/api/src/routes/plugins/
 * p5-shortlinks-and-taps.ts 与 packages/store/src/repository/plugins.ts
 * 的 createShortLink）：`POST /api/shortlinks` 只认 `/marketplace/` 内、
 * ≤500 字符的目标，首页 `#diy=` 目标一定被 400 拒掉——4KB 负载连长度
 * 关都过不了，`/` 路径连前缀关都过不了。所以这条路今天**一定**走
 * `unsupported-target` 回退：调用方复制完整链接，并如实告诉用户短链
 * 暂不支持首页分享。绝不替用户编一个短链，也不在客户端复刻服务端的
 * 目标策略（策略一变，复刻就是第二份会漂移的真相）。
 *
 * 中枢放开首页目标的那天（允许 `/` + `#diy=` 目标，或把负载存服务端、
 * 短链只存 code），这里不用改：同一段调用开始返回真短链。
 * ------------------------------------------------------------------ */

/** 短链创建函数：默认是中枢客户端，测试注入假实现（不发真请求） */
export type DiyShortLinkCreator = (target: string) => Promise<{
  success: boolean
  code: string
  path: string
  target: string
}>

export type DiyShortLinkResult =
  | { ok: true; url: string }
  | {
      ok: false
      /** 'invalid-share-url' = 传入的根本不是 #diy= 分享链接；'unsupported-target' = 中枢 400，目标口径不认；'request-failed' = 断网 / 5xx / 其它 */
      reason: 'invalid-share-url' | 'unsupported-target' | 'request-failed'
    }

/**
 * 给一条完整 `#diy=` 分享链接要短链：目标派生（纯函数）+ 中枢创建。
 * 成功返回 `<origin>/s/<code>`；失败返回原因，调用方按原因回退完整链接。
 */
export async function requestDiyShareShortLink(
  longUrl: string,
  createShortLink: DiyShortLinkCreator = createShortLinkForTarget,
): Promise<DiyShortLinkResult> {
  const derived = diyShareUrlToShortlinkTarget(longUrl)
  if (!derived.ok) return { ok: false, reason: 'invalid-share-url' }
  let created: { success: boolean; code: string; path: string; target: string }
  try {
    created = await createShortLink(derived.target)
  } catch (error: unknown) {
    // 中枢 400 = 目标口径不认（今天的 #diy= 目标一定走到这里）：不是网络
    // 问题，是服务能力边界，调用方据此回退完整链接并说清原因；其余失败
    // （断网 / 5xx / 限流）一律是 request-failed，不猜。
    return { ok: false, reason: hubErrorStatus(error) === 400 ? 'unsupported-target' : 'request-failed' }
  }
  if (!created || created.success !== true || typeof created.path !== 'string' || !created.path) {
    return { ok: false, reason: 'request-failed' }
  }
  let origin: string
  try {
    origin = new URL(longUrl).origin
  } catch {
    return { ok: false, reason: 'invalid-share-url' }
  }
  return { ok: true, url: `${origin}${created.path}` }
}

/* ------------------------------------------------------------------ *
 * 导入改走分享确认管线（P0-5）
 *
 * 旧的 importDIYConfig 是整表替换：清洗后的全量配置一把盖掉本地，
 * 没带 diff 预览、没确认、没备份。新的分两步，与 #diy= 分享同一套
 * 形状（PendingHomeDiyShare）：
 *   1. prepareHomeDiyImport：只校验 + 清洗 + 算 diff，不写任何东西。
 *      返回的 pending 可以直接挂进共享状态的 pendingShare，
 *      由 HomeDiyShareConfirmDialog 消费（确认/忽略同一套按钮）；
 *   2. applyPreparedHomeDiyImport：先把导入前那份配置自动备份到
 *      时间戳备份键，再按字段级合并应用，一次 persist = 一次可撤销提交。
 *
 * 接线（coordinator 在合并时做，见本任务报告）：
 *   - home-diy-storage.ts：加一个 stageHomeDiyPendingShare(pending)，
 *     把 prepare 的结果写进共享状态（commitSharedState 是模块私有的，
 *     这里调不到）；
 *   - use-home-diy.ts：把 importDIYConfig 改成「prepare + 挂起」，
 *     确认走现成的 confirmPendingShare；
 *   - home-diy-backup-dialog.tsx：提交时调新的 stageImportForConfirm
 *     prop（本文件里已接好，没传时回退到直接导入）。
 * 在接线完成前，importDIYConfig 仍是「直接应用」，但已经是
 * 备份 + 字段级合并，不再是整表替换。
 * ------------------------------------------------------------------ */

/** 导入能携带的字段：分享只有 11 个，导入是全量配置都能带 */
export type HomeDiyImportField = keyof HomeDIYConfig

/** 待确认的导入：与 PendingHomeDiyShare 同形，只多一个 source 标记 */
export interface PendingHomeDiyImport {
  imported: HomeDIYConfig
  diff: string[]
  warning: string | null
  carriedFields: HomeDiyImportField[]
  /** 确认对话框据此换文案；分享的 pending 没有这个字段，默认按 'share' 读 */
  source: 'import'
}

export type PreparedHomeDiyImport = Extract<PrepareHomeDiyImportResult, { ok: true }>

export type PrepareHomeDiyImportResult =
  | {
      ok: true
      pending: PendingHomeDiyImport
      dropped: number
      notes: string[]
      summary: string
    }
  | { ok: false; message: string; dropped: 0; notes: string[]; code?: VaultResultCode }

/**
 * 导入的字段级合并只写 carriedFields 列出的字段；分享的
 * HomeDiyShareField 联合类型只有 11 个分享字段，导入的携带集可以更宽
 * （自建分类、速览坞、折叠状态……），运行时 computeHomeDiyShareDiff /
 * mergeHomeDiyShareFields 本来就是按字段名驱动的，这层转换只是过类型。
 */
export function asShareFields(fields: readonly HomeDiyImportField[]): readonly HomeDiyShareField[] {
  return fields as unknown as readonly HomeDiyShareField[]
}

/**
 * 导入第一步：校验 → 清洗 → diff 预览。不碰存储、不写配置。
 *
 * current 不传时 diff 为空（调用方只想要「能不能导、丢了什么」）；
 * 传了就按当前配置算差异预览，供确认对话框逐条列出。
 */
export async function prepareHomeDiyImportFromValue(
  parsed: unknown,
  current?: HomeDIYConfig,
): Promise<PrepareHomeDiyImportResult> {
  // zod 约 103 KB，静态 import 会进首页首屏：结构校验只在用户点「导入」时
  // 才跑，这里 dynamic import（见 diy-layout-schema-zod.ts 文件头）。
  const { sanitizeDiyLayoutInput } = await import('@/lib/modular/diy-layout-schema-zod')
  const sanitized = sanitizeDiyLayoutInput(parsed)
  if (!sanitized.ok || !sanitized.config) {
    return {
      ok: false,
      message: sanitized.error || '无效的配置格式',
      dropped: 0,
      notes: [],
      code: 'validation_failed',
    }
  }
  const res = validateAndCleanDIYConfig(sanitized.config)
  if (!res.valid || !res.config) {
    return {
      ok: false,
      message: res.error || '无效的配置格式',
      dropped: 0,
      notes: [...sanitized.notes, ...res.notes],
      code: 'validation_failed',
    }
  }
  const dropped = sanitized.dropped + res.dropped
  const notes = [...sanitized.notes, ...res.notes]
  const imported = res.config as HomeDIYConfig
  // 只写输入实际携带的字段：没带的字段在 imported 里是清洗默认值，
  // 合并时绝不能拿默认值压掉本地值（这就是旧整表替换的 bug）。
  const knownFields = new Set(Object.keys(imported))
  const carriedFields = sanitized.carriedFields.filter((f) => knownFields.has(f)) as HomeDiyImportField[]
  const diff = current ? computeHomeDiyShareDiff(current, imported, asShareFields(carriedFields)) : []
  let warning: string | null = null
  if (notes.length > 0) {
    const head = dropped > 0 ? `${dropped} 项内容被丢弃或截断` : '部分设置值不在支持列表，已回退默认'
    const shown = notes.slice(0, 3).join('；')
    const more = notes.length > 3 ? ` 等 ${notes.length} 项` : ''
    warning = `导入的配置里${head}：${shown}${more}`
  }
  const summary = describeDiyRestoreReport(imported, { dropped, notes })
  return {
    ok: true,
    pending: { imported, diff, warning, carriedFields, source: 'import' },
    dropped,
    notes,
    summary,
  }
}

/** 明文导入第一步：JSON 解析 + 5MB 硬上限，再走 prepareHomeDiyImportFromValue */
export async function prepareHomeDiyImport(
  jsonString: string,
  current?: HomeDIYConfig,
): Promise<PrepareHomeDiyImportResult> {
  if (typeof jsonString !== 'string' || jsonString.length > DIY_IMPORT_MAX_BYTES) {
    return {
      ok: false,
      message: `导入文件超过 ${DIY_IMPORT_MAX_BYTES / 1024 / 1024}MB 上限`,
      dropped: 0,
      notes: [],
      code: 'validation_failed',
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (e: unknown) {
    return {
      ok: false,
      message: `JSON 解析失败: ${errorMessageOf(e, '格式错误')}`,
      dropped: 0,
      notes: [],
      code: 'invalid_json',
    }
  }
  return prepareHomeDiyImportFromValue(parsed, current)
}

export interface AppliedHomeDiyImport {
  applied: boolean
  /** 应用前自动备份的键；存储不可用或写不进去为 null（不拦导入） */
  backupKey: string | null
  summary: string
}

/**
 * 导入第二步：自动备份 → 字段级合并 → 一次可撤销提交。
 *
 * 备份在 persist 的 updater 里取 prev 做 —— commitHomeDiyConfig 只调一次
 * updater（同步），这里拿到的恰好是导入前那一份；备份写不进去也不拦导入，
 * 撤销栈里还留着旧配置。storage 不传时取 safeLocalStorage()（SSR/隐私模式为 null）。
 */
export function applyPreparedHomeDiyImport(
  prepared: PreparedHomeDiyImport,
  persist: HomeDiyPersist,
  storage?: HomeDiyStorage | null,
): AppliedHomeDiyImport {
  const store = storage === undefined ? safeLocalStorage() : storage
  let backupKey: string | null = null
  let backupAttempted = false
  persist((prev) => {
    if (!backupAttempted) {
      backupAttempted = true
      backupKey = store ? backupHomeDiyShareConfig(store, prev) : null
    }
    return mergeHomeDiyShareFields(prev, prepared.pending.imported, asShareFields(prepared.pending.carriedFields))
  })
  return { applied: true, backupKey, summary: prepared.summary }
}

export async function importDIYConfig(
  jsonString: string,
  persist: HomeDiyPersist,
  current?: HomeDIYConfig,
): Promise<HomeDiyImportResult> {
  const prepared = await prepareHomeDiyImport(jsonString, current)
  if (!prepared.ok) {
    return { ok: false, message: prepared.message, dropped: 0, notes: prepared.notes, code: prepared.code }
  }
  const applied = applyPreparedHomeDiyImport(prepared, persist)
  return {
    ok: true,
    message: `配置已导入并生效：${prepared.summary}`,
    dropped: prepared.dropped,
    notes: prepared.notes,
    summary: prepared.summary,
    backupKey: applied.backupKey,
  }
}

export async function exportEncryptedDIYConfig(
  config: HomeDIYConfig,
  passphrase: string,
): Promise<string> {
  const payload = await encryptGenericPayload(config, passphrase, 'navhub_home_diy_config_v3')
  return JSON.stringify(payload, null, 2)
}

export async function importEncryptedDIYConfig(
  encryptedJsonStr: string,
  passphrase: string,
  persist: HomeDiyPersist,
): Promise<HomeDiyImportResult> {
  let parsed: any
  try {
    parsed = JSON.parse(encryptedJsonStr)
  } catch (e: unknown) {
    return {
      ok: false,
      message: `JSON 解析失败: ${errorMessageOf(e, '格式错误')}`,
      dropped: 0,
      notes: [],
      code: 'invalid_json',
    }
  }
  if (!parsed.cipherTextBase64 || !parsed.ivHex || !parsed.saltHex) {
    return { ok: false, message: '无效的零知识金库密文包格式', dropped: 0, notes: [], code: 'invalid_cipher_package' }
  }
  try {
    const decrypted = await decryptGenericPayload<HomeDIYConfig>(parsed, passphrase)
    // 与明文导入同一条管线：先 prepare（校验 + 清洗 + 携带字段），再
    // apply（自动备份 + 字段级合并），不再拿解密出的全量配置整表替换。
    const prepared = await prepareHomeDiyImportFromValue(decrypted)
    if (!prepared.ok) {
      return { ok: false, message: prepared.message, dropped: 0, notes: prepared.notes, code: prepared.code ?? 'validation_failed' }
    }
    const applied = applyPreparedHomeDiyImport(prepared, persist)
    return {
      ok: true,
      message: `零知识金库解密成功，配置已还原：${prepared.summary}`,
      dropped: prepared.dropped,
      notes: prepared.notes,
      summary: prepared.summary,
      backupKey: applied.backupKey,
    }
  } catch (e: unknown) {
    return {
      ok: false,
      message: errorMessageOf(e, '解密失败：主密码不匹配或密文已被篡改'),
      dropped: 0,
      notes: [],
      code: 'decrypt_failed',
    }
  }
}

/**
 * 409 的两种成因 —— 服务端用 code 区分，客户端不得再折叠。
 *
 * 旧实现把两者压成同一句「云端金库已被其它设备更新，请先从云端拉取」，
 * 而「云端已被清除」时拉取根本拿不到东西（服务端确实没有），用户会在
 * 推送失败 → 拉取为空 → 再推送失败的环里空转（WCAG 3.3.1 / 3.3.3）。
 */
export type CloudVaultConflictKind = 'vault-cleared' | 'version-conflict'

export interface CloudVaultSyncResult {
  success: boolean
  version?: number
  conflict?: boolean
  conflictKind?: CloudVaultConflictKind
  /** 冲突时云端当前版本；vault-cleared 为 null（真的没有内容可拉） */
  currentVersion?: number | null
  error?: string
  /** 下一步做法：优先用服务端 hint，缺失时按 kind 生成本地引导 */
  suggestion?: string
  /** 失败原因码（成功时不带）—— 与 conflictKind 并存：kind 决定引导文案，code 供埋点/分支 */
  code?: VaultResultCode
}

export async function syncToCloudVault(
  config: HomeDIYConfig,
  passphrase: string,
  expectedVersion: number,
): Promise<CloudVaultSyncResult> {
  if (!passphrase || passphrase.length < 6) {
    return { success: false, error: '主密码长度至少需 6 位', code: 'passphrase_rejected' }
  }
  // 前置条件缺失时 PUT /api/vault/sync 的契约是「无条件覆盖」（兼容旧客户端），
  // 所以这里的参数只能是明确的非负整数：0 表示「已确认云端没有备份」。
  // 一旦放行为 undefined，多端场景就是静默丢掉别人那一版。
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return { success: false, error: '推送前需先与云端对表并取得版本号，本轮未发起写入', code: 'version_unknown' }
  }
  const encrypted = await exportEncryptedDIYConfig(config, passphrase)
  if (!encrypted) {
    return { success: false, error: '本地配置加密失败', code: 'encrypt_failed' }
  }
  const identity = getIdentity()
  if (!identity) {
    return { success: false, error: '无法获取用户身份标识', code: 'no_identity' }
  }
  const res = await saveCloudVault(identity, encrypted, expectedVersion)
  if (res.conflict) {
    // 无 code 的旧中枢按 current 回退：current 为空即「云端没有这份备份」
    const kind: CloudVaultConflictKind =
      res.code === 'VAULT_CLEARED'
        ? 'vault-cleared'
        : res.code === 'VERSION_CONFLICT'
          ? 'version-conflict'
          : res.current
            ? 'version-conflict'
            : 'vault-cleared'
    return {
      success: false,
      conflict: true,
      conflictKind: kind,
      currentVersion: res.current?.version ?? null,
      code: kind === 'vault-cleared' ? 'vault_cleared' : 'version_conflict',
      error:
        res.error ||
        (kind === 'vault-cleared'
          ? '云端金库已被清除：本机版本号对应的云端备份已不存在'
          : '版本冲突：云端金库已被其它设备更新'),
      // 服务端 hint 面向 API 调用方（教它传 version=0），不原样当用户文案：
      // 用户需要知道的是「重建后是第几版」，而不是内部哨兵值。
      suggestion:
        kind === 'vault-cleared'
          ? `确认以本机当前排版重建云端金库即可：${VAULT_REBUILD_VERSION_COPY}。`
          : res.hint ||
            '先点「从云端拉取解密」确认最新内容，再重新推送，避免覆盖别人的修改。',
    }
  }
  if (!res.ok) {
    return {
      success: false,
      error: res.error || '中枢云端金库同步失败，请检查网络或后端服务',
      code: 'hub_error',
    }
  }
  return { success: true, version: res.version }
}

export async function syncFromCloudVault(
  passphrase: string,
  persist: HomeDiyPersist,
): Promise<{
  success: boolean
  error?: string
  updatedAt?: number
  dropped: number
  notes: string[]
  /** 还原内容小结（条数 + 丢弃申报），界面直接展示 */
  summary?: string
  /** 失败原因码；网络/无备份/解密三类在旧实现里共用一句文案，数据上无法分辨 */
  code?: VaultResultCode
}> {
  if (!passphrase) {
    return { success: false, error: '请输入解密主密码', dropped: 0, notes: [], code: 'passphrase_rejected' }
  }
  const identity = getIdentity()
  if (!identity) {
    return { success: false, error: '无法获取用户身份标识', dropped: 0, notes: [], code: 'no_identity' }
  }
  // fetchCloudVault 的降级兜底把网络/5xx 也返回 null；不传回调就分不清
  // 「云端确实没有」和「这次没查到」，界面会把中枢故障说成备份不存在。
  let degraded = false
  const cloudRecord = await fetchCloudVault(identity, () => {
    degraded = true
  })
  if (!cloudRecord || !cloudRecord.payload) {
    return degraded
      ? {
          success: false,
          error: '这次没查到云端状态（网络或中枢异常），云端是否仍有备份未知',
          dropped: 0,
          notes: [],
          code: 'check_failed',
        }
      : {
          success: false,
          error: '云端确实没有该身份的备份金库',
          dropped: 0,
          notes: [],
          code: 'no_vault',
        }
  }
  const res = await importEncryptedDIYConfig(cloudRecord.payload, passphrase, persist)
  if (!res.ok) {
    return {
      success: false,
      error: res.message || '云端金库解密校验失败',
      dropped: res.dropped,
      notes: res.notes,
      code: res.code ?? 'decrypt_failed',
    }
  }
  return {
    success: true,
    updatedAt: cloudRecord.updatedAt,
    dropped: res.dropped,
    notes: res.notes,
    summary: res.summary,
  }
}

/**
 * 与云端对表。
 *
 * 「没有备份」和「没查到」是两件事：fetchCloudVault 走的是中枢客户端的降级兜底，
 * 网络故障与中枢 5xx 同样返回 null。旧实现把两者都报成 hasCloudVault:false，
 * 于是 UI 会在中枢挂掉时宣称「云端还没有你的备份」，用户据此重复推送。
 * 这里用降级回调把故障单独分成 check_failed，埋点才有可用的分母；
 * 界面侧（徽章、删除区、推送引导块）自 run46 起同样按 code 分支，不再只看 hasCloudVault。
 */
export async function checkCloudVaultStatus(): Promise<{
  hasCloudVault: boolean
  updatedAt?: number
  version?: number
  code: VaultResultCode
}> {
  const identity = getIdentity()
  if (!identity) return { hasCloudVault: false, code: 'no_identity' }
  let degraded = false
  const cloudRecord = await fetchCloudVault(identity, () => {
    degraded = true
  })
  if (!cloudRecord || !cloudRecord.payload) {
    return { hasCloudVault: false, code: degraded ? 'check_failed' : 'no_vault' }
  }
  return { hasCloudVault: true, updatedAt: cloudRecord.updatedAt, version: cloudRecord.version, code: 'has_vault' }
}

/**
 * 删除云端金库的结果 —— 四种事实必须可分辨。
 *
 * 旧实现返回 boolean：无身份、请求失败、云端本来就没有备份全都塌成 false，
 * 而任意 2xx 又塌成 true，于是 UI 既可能谎报「已删除」，也可能让真删除与网络故障
 * 共用同一句失败文案。调用方据此只能说实话，不能猜。
 */
export type CloudVaultClearResult =
  | { kind: 'deleted' }
  | { kind: 'absent' }
  | { kind: 'no-identity' }
  | { kind: 'failed'; status?: number; error: string }

export async function clearCloudVault(): Promise<CloudVaultClearResult> {
  const identity = getIdentity()
  if (!identity) return { kind: 'no-identity' }
  const res = await deleteCloudVault(identity)
  if (!res.ok) return { kind: 'failed', status: res.status, error: res.error }
  return res.deleted ? { kind: 'deleted' } : { kind: 'absent' }
}

/**
 * 推送前置条件：只有「查到有备份」和「查到确实没有」两种事实可以据此写入。
 *
 * 三种事实各自的做法不能混：
 *  - has_vault + 有限版本号 → expectedVersion=version，服务端只在云端仍是这一版时才覆盖（等价 If-Match）；
 *  - no_vault（真的没有）→ expectedVersion=0，第一份备份从 v1 起计；
 *  - check_failed / no_identity（没查到）→ 拒绝本轮写入。
 *
 * 「没查到」为什么不能照旧折成 0：服务端版本从 1 起计，0 会被 409 挡下，所以不会静默覆盖，
 * 但它换来的是假的「云端金库已被其它设备更新」冲突提示与假的 conflict 埋点，
 * 用户据此反复推送、运营侧把中枢故障读成多端竞争。
 *
 * 真正能毁数据的是 hasCloudVault:true 配缺失的 version：三元表达式会算出 undefined，
 * saveCloudVault 的 `if (typeof expectedVersion === 'number')` 因此不写 body.version，
 * 而 PUT /api/vault/sync 对「不带前置条件」的契约就是无条件覆盖（routes/vault.ts 原文）。
 * 所以版本号不可信同样拒绝，绝不放行成 undefined。
 */
export type VaultPushRefusalReason = 'status_check_failed' | 'identity_missing' | 'cloud_version_unknown'

export type VaultPushPrecondition =
  | { kind: 'ready'; expectedVersion: number }
  | { kind: 'refused'; reason: VaultPushRefusalReason }

export function resolveVaultPushPrecondition(status: {
  hasCloudVault: boolean
  version?: number
  code: VaultResultCode
}): VaultPushPrecondition {
  if (status.code === 'no_identity') return { kind: 'refused', reason: 'identity_missing' }
  if (status.code === 'check_failed') return { kind: 'refused', reason: 'status_check_failed' }
  if (status.hasCloudVault) {
    const version = status.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      return { kind: 'refused', reason: 'cloud_version_unknown' }
    }
    return { kind: 'ready', expectedVersion: version }
  }
  if (status.code !== 'no_vault') return { kind: 'refused', reason: 'status_check_failed' }
  return { kind: 'ready', expectedVersion: 0 }
}

/** 拒绝原因 → 有界埋点码（词表两侧一致，服务端只认长度上限） */
export function vaultPushRefusalCode(reason: VaultPushRefusalReason): VaultResultCode {
  if (reason === 'identity_missing') return 'no_identity'
  if (reason === 'cloud_version_unknown') return 'version_unknown'
  return 'check_failed'
}

/**
 * 拒绝原因 → 界面文案（WCAG 3.3.1 说清哪一步出错 + 3.3.3 给出纠正做法）。
 *
 * 三条的纠正动作各不相同：故障是重试对表、身份是查本地存储、版本未知是先拉取，
 * 合成一句「同步失败」等于把三种人引向同一个死胡同。
 */
export function vaultPushRefusalNotice(reason: VaultPushRefusalReason): { title: string; description: string } {
  if (reason === 'identity_missing') {
    return {
      title: '没取到本机身份，本轮未写入云端',
      description:
        '中枢按身份定位金库，取不到身份时不能确定要覆盖谁的备份，因此本轮没有发起任何写入。隐私模式或禁用本地存储会导致身份丢失；恢复后点「重试对表」再同步。',
    }
  }
  if (reason === 'cloud_version_unknown') {
    return {
      title: '云端版本号缺失，本轮未写入云端',
      description:
        '对表查到云端有备份，但中枢没有回传版本号。缺版本号的写入请求等于「无条件覆盖」，会静默丢掉其它设备刚保存的那一版，因此本轮没有发起写入。先点「从云端拉取解密」确认内容，再重新对表同步。',
    }
  }
  return {
    title: '云端状态没查到，本轮未写入云端',
    description:
      '这次对表失败（中枢不可达或返回异常），因此无法确定云端是否已有备份。为避免覆盖别人的内容，本轮没有发起写入；本机排版未受影响。稍后点「重试对表」再同步。',
  }
}

/**
 * 对表结果 → 漏斗分母事件的结局。
 *
 * 「云端没有备份」与「这次没查到」必须分开：前者是真实漏斗的起点（用户还没同步过），
 * 后者是中枢故障，把它计入「没有备份」会让推送失败率看起来像用户需求。
 */
export function vaultStatusOutcome(code: VaultResultCode): VaultTelemetryOutcome {
  if (code === 'has_vault') return 'success'
  if (code === 'no_vault') return 'empty'
  if (code === 'no_identity') return 'no_identity'
  return 'failed'
}

/**
 * 拉取的失败结局：空结果单独成一级。
 *
 * 拉取回空是「云端没有备份」，与解密失败混在一起就分不清
 * 「没人同步过」和「同步过但拉不下来」，而这两件事的纠正动作相反。
 */
export function vaultPullOutcome(success: boolean, code?: VaultResultCode): VaultTelemetryOutcome {
  if (success) return 'success'
  if (code === 'no_vault') return 'empty'
  return 'failed'
}
