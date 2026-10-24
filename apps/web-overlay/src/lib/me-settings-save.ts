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

export interface SettingsSaveResult {
  finalSettings: UserSettingsModel
  /** 保存后的自检结论（成功路径必有） */
  notice: string
}

/**
 * 登录后首次读取时，是否先把本机这一份交上去。
 *
 * `updatedAt === 0` 是服务端既有契约（user_settings 无行时 getUserSettings 返回 0），
 * 代表「云端还没有你的设置」；此时若本机在匿名期存过设置，就必须先上云，
 * 否则云端默认值会把本机设置静默冲掉，界面上「登录后同步到云端」的承诺也落空。
 */
export function shouldUploadLocalSettingsFirst(
  cloud: Pick<UserSettingsModel, 'updatedAt'>,
  local: Pick<UserSettingsModel, 'updatedAt'>,
): boolean {
  return cloud.updatedAt === 0 && local.updatedAt > 0
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
