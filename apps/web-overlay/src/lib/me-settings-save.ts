'use client'

/**
 * 设置保存的「Save-then-Verify」内核（T1 抽取）。
 *
 * 此前同一套「PATCH 云端 → 本地回写 → verifySettingsConsistency → 修复回写」
 * 在 use-me-settings.patch 与 me-view.togglePersonalization 各维护一份；
 * 抽到这里后两条路径共用同一实现，notice 文案也只留一份。
 */
import {
  normalizeUserSettings,
  verifySettingsConsistency,
  writeLocalUserSettings,
  type UserSettingsModel,
  type UserSettingsPatch,
} from '@/lib/user-settings'
import { trackSettingsHandoffEvent } from '@/lib/navhub-api'

export interface SettingsSaveResult {
  finalSettings: UserSettingsModel
  /** 保存后的自检结论（成功路径必有） */
  notice: string
}

/**
 * 登录后首次读取时，是否先把本机这一份交上去。
 *
 * `updatedAt === 0` 是服务端既有契约（user_settings 无行时 getUserSettings 返回 0，
 * 见 packages/store/src/repository/settings.ts:149-156），代表「云端还没有你的设置」；
 * 此时若本机在匿名期存过设置，就必须先上云，
 * 否则云端默认值会把本机设置静默冲掉，界面上「登录后同步到云端」的承诺也落空。
 */
export function shouldUploadLocalSettingsFirst(
  cloud: Pick<UserSettingsModel, 'updatedAt'>,
  local: Pick<UserSettingsModel, 'updatedAt'>,
): boolean {
  return cloud.updatedAt === 0 && local.updatedAt > 0
}

export const SETTINGS_HANDOFF_NOTICE = '已把你在本机保存的偏好同步到云端，换设备登录后会跟随。'
export const SETTINGS_HANDOFF_ERROR = '云端还没有你的设置，本机这一份没能同步上去，暂时只在这台设备生效。'

export type SettingsHandoff = 'none' | 'uploaded' | 'upload_failed'

export interface SettingsHydration {
  /** 交接成功＝云端回读值；失败＝本机快照（原样保留）；无交接＝云端值（已落本机） */
  settings: UserSettingsModel
  handoff: SettingsHandoff
  notice: string | null
  error: string | null
}

/**
 * 把「云端读回来的设置」落到本机之前的唯一口径。
 *
 * 之前这段判定只在 /me/settings 的 load 里，而 /me、/me/account、/me/plugins
 * 共用的概览钩子无条件 `writeLocalUserSettings(云端值)`：`user_settings` 无行时
 * 云端返回的是默认值，于是「登录后第一次打开概览页」就把匿名期攒下的偏好冲掉，
 * 并且 writeLocalUserSettings 顺手打上 updatedAt=now（user-settings.ts:271），
 * 连「本机存过真实偏好」这个判断依据一起抹掉 —— 设置页那句修复也就跟着失效了。
 * 判定、文案与埋点只留这一份，任何消费云端设置的入口都走它。
 */
export async function hydrateSettingsFromCloud(
  cloud: UserSettingsModel,
  localSnapshot: UserSettingsModel,
): Promise<SettingsHydration> {
  if (!shouldUploadLocalSettingsFirst(cloud, localSnapshot)) {
    return { settings: writeLocalUserSettings(cloud), handoff: 'none', notice: null, error: null }
  }
  try {
    const migrated = await saveSettingsPatchToCloud(localSnapshot)
    trackSettingsHandoffEvent('success')
    return { settings: migrated.finalSettings, handoff: 'uploaded', notice: SETTINGS_HANDOFF_NOTICE, error: null }
  } catch (err) {
    // 失败绝不用云端默认值覆盖本机：这一份还是用户唯一的副本
    trackSettingsHandoffEvent('failed', err instanceof TypeError ? 'network_unavailable' : 'hub_error')
    return { settings: localSnapshot, handoff: 'upload_failed', notice: null, error: SETTINGS_HANDOFF_ERROR }
  }
}

/** 云端路径：PATCH /api/me/settings → 回读校验。失败抛错（网络 / 非 2xx）。 */
export async function saveSettingsPatchToCloud(patch: UserSettingsPatch): Promise<SettingsSaveResult> {
  const res = await fetch('/api/me/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('设置保存失败')
  const data = (await res.json()) as { settings?: unknown }
  const cloudSettings = (data.settings ?? {}) as Partial<UserSettingsModel>
  const localWritten = writeLocalUserSettings(normalizeUserSettings(cloudSettings))
  const check = verifySettingsConsistency(patch, cloudSettings, localWritten)
  const finalSettings = check.verified ? localWritten : writeLocalUserSettings(check.repairedSettings)
  return {
    finalSettings,
    notice: check.verified
      ? '已保存并通过云端与本机一致性自检'
      : `已自动修复 ${check.mismatchedKeys.length} 项缓存偏差并完成同步`,
  }
}

/** 本机路径（匿名身份）：写入 + 完整性自检，不发请求。 */
export function saveSettingsPatchLocal(patch: UserSettingsPatch): SettingsSaveResult {
  const localWritten = writeLocalUserSettings(patch)
  const check = verifySettingsConsistency(patch, localWritten, localWritten)
  const finalSettings = check.verified ? localWritten : writeLocalUserSettings(check.repairedSettings)
  return { finalSettings, notice: '已保存至本机并通过完整性自检' }
}
