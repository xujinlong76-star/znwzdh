'use client'

/**
 * 用户中心「全局设置」的数据与保存逻辑。
 *
 * 从 `app/me/me-view.tsx` 等价搬运：登录态走 `PATCH /api/me/settings` 并回读校验，
 * 匿名态写本机 localStorage；两条路径都执行 `verifySettingsConsistency`，
 * 保证「显示的值」与「真正落盘的值」一致。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_USER_SETTINGS,
  normalizeUserSettings,
  readLocalUserSettings,
  verifySettingsConsistency,
  writeLocalUserSettings,
  type UserSettingsModel,
  type UserSettingsPatch,
} from '@/lib/user-settings'

export type MeSettingsState = 'loading' | 'ready' | 'anonymous' | 'error'

export interface MeSettingsController {
  state: MeSettingsState
  settings: UserSettingsModel
  busy: boolean
  /** 保存后的自检结论（成功才出现）；失败时为 null */
  notice: string | null
  error: string | null
  dismissNotice: () => void
  reload: () => Promise<void>
  patch: (patch: UserSettingsPatch) => Promise<boolean>
  restoreDefaults: () => Promise<boolean>
}

export function useMeSettings(): MeSettingsController {
  const [state, setState] = useState<MeSettingsState>('loading')
  const [settings, setSettings] = useState<UserSettingsModel>(() => readLocalUserSettings())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' })
      // 会话探测失败 ≠ 匿名：非 2xx / 解析失败都按「暂时无法确认」处理
      if (!sessionRes.ok) {
        setError('登录状态暂时无法确认，请稍后重试')
        setState('error')
        return
      }
      let parsed: unknown
      try {
        parsed = await sessionRes.json()
      } catch {
        parsed = undefined
      }
      if (parsed === undefined) {
        setError('登录状态暂时无法确认，请稍后重试')
        setState('error')
        return
      }
      const session = (parsed ?? {}) as { user?: { id?: string } }
      if (!session.user?.id) {
        setSettings(readLocalUserSettings())
        setState('anonymous')
        return
      }

      const res = await fetch('/api/me/settings', { cache: 'no-store' })
      if (res.status === 401) {
        setSettings(readLocalUserSettings())
        setState('anonymous')
        return
      }
      if (!res.ok) {
        setError('设置暂时取不到，请稍后重试')
        setState('error')
        return
      }
      const data = (await res.json()) as { settings?: unknown }
      setSettings(writeLocalUserSettings(normalizeUserSettings(data.settings)))
      setState('ready')
    } catch {
      setError('网络不可用，未能加载设置')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (patchValue: UserSettingsPatch): Promise<boolean> => {
      setBusy(true)
      setNotice(null)
      try {
        if (state === 'ready') {
          const res = await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchValue),
            cache: 'no-store',
          })
          if (!res.ok) throw new Error('设置保存失败')
          const data = (await res.json()) as { settings?: unknown }
          const localWritten = writeLocalUserSettings(normalizeUserSettings(data.settings))
          const check = verifySettingsConsistency(patchValue, data.settings, localWritten)
          const finalSettings = check.verified
            ? localWritten
            : writeLocalUserSettings(check.repairedSettings)
          setSettings(finalSettings)
          setNotice(
            check.verified
              ? '已保存并通过云端与本机一致性自检'
              : `已自动修复 ${check.mismatchedKeys.length} 项缓存偏差并完成同步`,
          )
          return true
        }

        const localWritten = writeLocalUserSettings(patchValue)
        const check = verifySettingsConsistency(patchValue, localWritten, localWritten)
        const finalSettings = check.verified
          ? localWritten
          : writeLocalUserSettings(check.repairedSettings)
        setSettings(finalSettings)
        setNotice('已保存至本机并通过完整性自检')
        return true
      } catch {
        return false
      } finally {
        setBusy(false)
      }
    },
    [state],
  )

  const restoreDefaults = useCallback(
    () =>
      patch({
        defaultSearchEngine: DEFAULT_USER_SETTINGS.defaultSearchEngine,
        openLinksInNewTab: DEFAULT_USER_SETTINGS.openLinksInNewTab,
        cardDensity: DEFAULT_USER_SETTINGS.cardDensity,
        speculativeZeroRttEnabled: DEFAULT_USER_SETTINGS.speculativeZeroRttEnabled,
        daypartSceneEnabled: DEFAULT_USER_SETTINGS.daypartSceneEnabled,
        spotlightShortcut: DEFAULT_USER_SETTINGS.spotlightShortcut,
        searchHistoryEnabled: DEFAULT_USER_SETTINGS.searchHistoryEnabled,
        telemetryEnabled: DEFAULT_USER_SETTINGS.telemetryEnabled,
        historyRetentionDays: DEFAULT_USER_SETTINGS.historyRetentionDays,
      }),
    [patch],
  )

  return {
    state,
    settings,
    busy,
    notice,
    error,
    dismissNotice: () => setNotice(null),
    reload: load,
    patch,
    restoreDefaults,
  }
}
