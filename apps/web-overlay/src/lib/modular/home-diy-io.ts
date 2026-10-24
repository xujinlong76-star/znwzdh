'use client'

/**
 * 首页 DIY 的导入/导出与云端金库逻辑（从 use-home-diy.ts 拆出，2026-10-19 P1-1）。
 *
 * 这里只放不依赖 React 的纯逻辑：解析、校验、加密、云端请求。
 * 落盘/共享状态由调用方注入 persist，避免这个文件反过来依赖存储单例。
 */
import { getIdentity } from '@/lib/identity'
import {
  deleteCloudVault,
  fetchCloudVault,
  saveCloudVault,
  type VaultResultCode,
  type VaultTelemetryOutcome,
} from '@/lib/navhub-api'
import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { decryptGenericPayload, encryptGenericPayload } from '@/lib/vault'
import type { HomeDIYConfig } from './home-diy-storage'

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

export function importDIYConfig(
  jsonString: string,
  persist: HomeDiyPersist,
): HomeDiyImportResult {
  try {
    const parsed = JSON.parse(jsonString)
    const res = validateAndCleanDIYConfig(parsed)
    if (!res.valid || !res.config) {
      return { ok: false, message: res.error || '无效的配置格式', dropped: 0, notes: res.notes, code: 'validation_failed' }
    }
    persist(() => ({ ...(res.config as HomeDIYConfig), updatedAt: Date.now() }))
    const summary = describeDiyRestoreReport(res.config, res)
    return {
      ok: true,
      message: `配置已导入并生效：${summary}`,
      dropped: res.dropped,
      notes: res.notes,
      summary,
    }
  } catch (e: any) {
    return {
      ok: false,
      message: `JSON 解析失败: ${e.message || '格式错误'}`,
      dropped: 0,
      notes: [],
      code: 'invalid_json',
    }
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
  } catch (e: any) {
    return {
      ok: false,
      message: `JSON 解析失败: ${e.message || '格式错误'}`,
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
    const res = validateAndCleanDIYConfig(decrypted)
    if (!res.valid || !res.config) {
      return { ok: false, message: res.error || '解密数据校验失败', dropped: 0, notes: res.notes, code: 'validation_failed' }
    }
    persist(() => ({ ...(res.config as HomeDIYConfig), updatedAt: Date.now() }))
    const summary = describeDiyRestoreReport(res.config, res)
    return {
      ok: true,
      message: `零知识金库解密成功，配置已还原：${summary}`,
      dropped: res.dropped,
      notes: res.notes,
      summary,
    }
  } catch (e: any) {
    return {
      ok: false,
      message: e.message || '解密失败：主密码不匹配或密文已被篡改',
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
  expectedVersion?: number,
): Promise<CloudVaultSyncResult> {
  if (!passphrase || passphrase.length < 6) {
    return { success: false, error: '主密码长度至少需 6 位', code: 'passphrase_rejected' }
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
      suggestion:
        res.hint ||
        (kind === 'vault-cleared'
          ? '确认以本机当前排版重建云端金库即可，新版本会从 v0 开始计。'
          : '先点「从云端拉取解密」确认最新内容，再重新推送，避免覆盖别人的修改。'),
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
  const cloudRecord = await fetchCloudVault(identity)
  if (!cloudRecord || !cloudRecord.payload) {
    return { success: false, error: '云端暂未查询到该身份的备份金库', dropped: 0, notes: [], code: 'no_vault' }
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
 * 这里用降级回调把故障单独分成 check_failed，埋点才有可用的分母。
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
