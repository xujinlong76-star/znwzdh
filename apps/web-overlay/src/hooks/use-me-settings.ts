'use client'

/**
 * 用户中心「全局设置」的数据与保存逻辑。
 *
 * 从 `app/me/me-view.tsx` 等价搬运：登录态走 `PATCH /api/me/settings` 并回读校验，
 * 匿名态写本机 localStorage；两条路径都执行 `verifySettingsConsistency`，
 * 保证「显示的值」与「真正落盘的值」一致。
 *
 * 匿名期的本机偏好不会凭空上云：登录后的首次读取若发现云端还没有行
 * （`updatedAt === 0` 是服务端既有契约），就把本机这一份 PATCH 上去，
 * 兑现「登录后同步到云端」而不是用默认值冲掉本机设置。
 */
import { useCallback, useEffect, useState } from 'react'
import { isNetworkSessionFailure, probeClientSession } from '@/lib/client-session'
import { hydrateSettingsFromCloud } from '@/lib/me-settings-save'
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
  /** 云端保存失败的原因（本机路径不会失败到需要它）；成功后清空 */
  saveError: string | null
  dismissNotice: () => void
  reload: () => Promise<void>
  patch: (patch: UserSettingsPatch) => Promise<boolean>
  /** 重发上一次没保存上的改动；没有待重发项时返回 false */
  retrySave: () => Promise<boolean>
  restoreDefaults: () => Promise<boolean>
}

function describeSaveFailure(err: unknown): string {
  const reason =
    err instanceof TypeError ? '网络不可用' : err instanceof Error && err.message ? err.message : '保存请求未完成'
  return `${reason}：这次改动没有保存上，当前显示的仍是原值`
}

export function useMeSettings(): MeSettingsController {
  const [state, setState] = useState<MeSettingsState>('loading')
  const [settings, setSettings] = useState<UserSettingsModel>(() => readLocalUserSettings())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastFailedPatch, setLastFailedPatch] = useState<UserSettingsPatch | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      // 会话探测失败 ≠ 匿名：网络 / HTTP / 解析三类各自决定文案，未知一律按「暂时无法确认」
      const probe = await probeClientSession()
      if (probe.kind !== 'ok') {
        setError(
          isNetworkSessionFailure(probe)
            ? '网络不可用，未能加载设置'
            : '登录状态暂时无法确认，请稍后重试',
        )
        setState('error')
        return
      }
      if (!probe.session.user?.id) {
        setSettings(readLocalUserSettings())
        setState('anonymous')
        return
      }

      // 必须在任何「写本机」之前取快照：ready 路径会用云端结果覆盖 localStorage，
      // 覆盖之后再判断「匿名期攒下了什么」就太晚了。
      const localBefore = readLocalUserSettings()

      const res = await fetch('/api/me/settings', { cache: 'no-store' })
      if (res.status === 401) {
        // 会话里明确有 user.id，设置服务却拒绝 → 这不是匿名。压平成 anonymous
        // 会让后续改动静默只落本机，用户以为已经在云上。
        setSettings(localBefore)
        setError('已登录，但设置服务拒绝了这次请求（401）。请稍后重试或重新登录。')
        setState('error')
        return
      }
      if (!res.ok) {
        setError('设置暂时取不到，请稍后重试')
        setState('error')
        return
      }
      const data = (await res.json()) as { settings?: unknown }
      const cloud = normalizeUserSettings(data.settings)
      // 判定、上云、文案与埋点只有一份实现（lib/me-settings-save），
      // 概览钩子走的是同一个函数 —— 两个页面的口径不允许再各自漂移。
      const hydrated = await hydrateSettingsFromCloud(cloud, localBefore)
      setSettings(hydrated.settings)
      if (hydrated.error) {
        setError(hydrated.error)
        setState('error')
        return
      }
      setNotice(hydrated.notice)
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
      setSaveError(null)
      setLastFailedPatch(null)
      try {
        if (state === 'ready') {
          const res = await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchValue),
            cache: 'no-store',
          })
          if (!res.ok) {
            throw new Error(res.status === 401 ? '登录状态已失效' : `云端返回 ${res.status}`)
          }
          const data = (await res.json()) as { settings?: unknown }
          const cloudSettings = (data.settings ?? {}) as Partial<UserSettingsModel>
          const localWritten = writeLocalUserSettings(normalizeUserSettings(cloudSettings))
          const check = verifySettingsConsistency(patchValue, cloudSettings, localWritten)
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
      } catch (err) {
        // 不吞错：如实说明为什么没保存上，并留住这一次改动供「重试」重发
        setSaveError(describeSaveFailure(err))
        setLastFailedPatch(patchValue)
        return false
      } finally {
        setBusy(false)
      }
    },
    [state],
  )

  const retrySave = useCallback(async (): Promise<boolean> => {
    const pending = lastFailedPatch
    if (!pending) return false
    return patch(pending)
  }, [lastFailedPatch, patch])

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
    saveError,
    dismissNotice: () => setNotice(null),
    reload: load,
    patch,
    retrySave,
    restoreDefaults,
  }
}
