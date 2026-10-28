import type { SiteSettings, SiteSettingsPatch } from '@/lib/site-settings'
import { normalizeSettings } from '@/lib/site-settings'

export interface SiteSettingsLoad {
  settings: SiteSettings
  /** 中枢连不上：读到的是构建期基线，**不能**据此保存 */
  degraded: boolean
  /** 中枢可达但还没有站点配置记录：保存即创建 */
  missing: boolean
  message?: string
}

export interface FieldIssue {
  path: string
  message: string
}

/** 服务端 400 会把逐字段原因带回来，页面要按 tab 显示而不是笼统一句「保存失败」 */
export class SiteSettingsError extends Error {
  issues: FieldIssue[]
  constructor(message: string, issues: FieldIssue[] = []) {
    super(message)
    this.name = 'SiteSettingsError'
    this.issues = issues
  }
}

/**
 * 站点设置的前端出口。
 *
 * 旧版是一个把异常咽掉、返回全空配置的类；空配置与真实配置对管理员长得一模一样，
 * 于是「中枢挂了」+「点一次保存」= 真实配置被空值覆盖。这里改成显式抛出 +
 * 把 degraded 标记送到页面，页面在降级时禁止保存。
 */

async function readResponse(res: Response): Promise<SiteSettingsLoad> {
  if (!res.ok) throw new SiteSettingsError(`读取站点配置失败 (HTTP ${res.status})`)
  const body = (await res.json()) as { settings?: unknown; degraded?: boolean; missing?: boolean; message?: string }
  return {
    settings: normalizeSettings(body?.settings),
    degraded: body?.degraded === true,
    missing: body?.missing === true,
    ...(typeof body?.message === 'string' ? { message: body.message } : {}),
  }
}

/** 读取本身已经绕过全部缓存（服务端要的是中枢此刻的真实值） */
export async function loadSiteSettings(input?: { signal?: AbortSignal }): Promise<SiteSettingsLoad> {
  const res = await fetch('/api/site', { signal: input?.signal, cache: 'no-store' })
  return readResponse(res)
}

/** 部分保存：只提交本次改动过的字段，服务端负责深合并 */
export async function saveSiteSettings(patch: SiteSettingsPatch, signal?: AbortSignal): Promise<SiteSettingsLoad> {
  const res = await fetch('/api/site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal,
  })
  if (!res.ok) {
    let message = `保存失败 (HTTP ${res.status})`
    let issues: FieldIssue[] = []
    try {
      const body = (await res.json()) as { error?: string; issues?: FieldIssue[] }
      if (body?.error) message = body.error
      if (Array.isArray(body?.issues)) issues = body.issues
    } catch {
      // 非 JSON 响应体（反代错误页等）保留状态码信息即可
    }
    throw new SiteSettingsError(message, issues)
  }
  const body = (await res.json()) as { settings?: unknown }
  return { settings: normalizeSettings(body?.settings), degraded: false, missing: false }
}

export type AssetKind = 'logo' | 'favicon' | 'ogImage' | 'appleTouchIcon' | 'pwaIcon192' | 'pwaIcon512' | 'pwaMaskable512'

export interface SiteAsset {
  path: string
  name: string
  bytes: number
  updatedAt: number
  createdAt: number
  kind: string
  mime: string | null
  sha256: string | null
  width: number | null
  height: number | null
  references: string[]
}

export async function listSiteAssets(signal?: AbortSignal): Promise<SiteAsset[]> {
  const res = await fetch('/api/hub/storage/list?limit=500', { cache: 'no-store', signal })
  if (!res.ok) throw new SiteSettingsError(`读取资产清单失败 (HTTP ${res.status})`)
  const body = (await res.json()) as { assets?: SiteAsset[] }
  if (!Array.isArray(body.assets) || body.assets.some((asset) =>
    typeof asset?.path !== 'string' || typeof asset?.name !== 'string' ||
    !Array.isArray(asset.references) || asset.references.some((reference) => typeof reference !== 'string'))) {
    throw new SiteSettingsError('资产清单缺少有效引用信息，请检查中枢版本；已禁止清理')
  }
  return body.assets
}

export async function deleteSiteAsset(path: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/hub/storage', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    signal,
  })
  if (!res.ok) {
    let message = `删除资产失败 (HTTP ${res.status})`
    try {
      const body = (await res.json()) as { error?: string; detail?: string }
      message = body.detail || body.error || message
    } catch {
      // 保留 HTTP 状态错误
    }
    throw new SiteSettingsError(message)
  }
}

export async function uploadSiteAsset(
  kind: AssetKind,
  file: File,
  signal?: AbortSignal,
): Promise<{ url: string; bytes: number; mime: string }> {
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', file)
  const res = await fetch('/api/site/asset', { method: 'POST', body: form, signal })
  if (!res.ok) {
    let message = '上传失败'
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // 同上
    }
    throw new SiteSettingsError(message)
  }
  return (await res.json()) as { url: string; bytes: number; mime: string }
}
