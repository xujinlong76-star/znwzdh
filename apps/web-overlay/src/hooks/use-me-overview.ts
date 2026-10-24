'use client'

/**
 * 用户中心概览 / 账号 / 插件页共用的取数钩子。
 *
 * 语义与 `/me` 四态一致：会话探测失败落 error（可重试），未登录落 anonymous，
 * `/api/me` 非 2xx（401 除外）落 error。失败绝不当成「空数据」。
 *
 * T1 起 `/me` 主视图也改用本钩子：`initialOverview` 用于服务端壳注入的首屏
 * 概览（注入时首帧即 ready，不再重复请求）；`reload` 供手动刷新与身份事件
 * （合并 / 切换）后重取。此前 me-view 内联维护过一份逐行等价的取数状态机。
 *
 * 概览带着云端设置（`/api/me` = overview + settings），所以「云端还没有这一行时
 * 先把本机偏好交上去」的口径也归本钩子：`/me`、`/me/account`、`/me/plugins`
 * 三个入口与 `/me/settings` 共用 lib/me-settings-save 那一份实现。
 */
import { useCallback, useEffect, useState } from 'react'
import type { MeOverview } from '@/lib/me-types'
import { isNetworkSessionFailure, probeClientSession } from '@/lib/client-session'
import { getAnonId } from '@/lib/identity'
import { hydrateSettingsFromCloud } from '@/lib/me-settings-save'
import { normalizeUserSettings, readLocalUserSettings, type UserSettingsModel } from '@/lib/user-settings'

export type MeOverviewState = 'loading' | 'anonymous' | 'ready' | 'error'

export interface MeOverviewController {
  state: MeOverviewState
  overview: MeOverview | null
  error: string | null
  /** anonymous 态下展示用的匿名 id（其余态为空串） */
  anonId: string
  /** 本机偏好成功交接上云的说明（没有交接时为空） */
  settingsNotice: string | null
  /** 本机偏好没能交接上云的原因（概览其余数据仍然可用） */
  settingsError: string | null
  dismissSettingsNotice: () => void
  reload: () => Promise<void>
  /** 把保存后的最终设置合并进当前概览（如个性化开关写回），不触发请求 */
  updateSettings: (settings: UserSettingsModel) => void
}

export function useMeOverview(options: { initialOverview?: MeOverview | null } = {}): MeOverviewController {
  const initialOverview = options.initialOverview ?? null
  const [state, setState] = useState<MeOverviewState>(initialOverview ? 'ready' : 'loading')
  const [overview, setOverview] = useState<MeOverview | null>(initialOverview)
  const [error, setError] = useState<string | null>(null)
  const [anonId, setAnonId] = useState('')
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  /**
   * 云端设置落到本机之前，一律走 lib/me-settings-save 的同一个口径。
   *
   * `user_settings` 无行时服务端按既有契约返回默认值 + updatedAt:0，
   * 直接 writeLocalUserSettings 会把匿名期攒下的偏好冲掉（并顺手打上 updatedAt=now，
   * 连判断依据一起抹掉）——所以「先上云、失败保留本机值」的判定必须在这里也在 /me/settings 生效。
   */
  const hydrate = useCallback(async (rawCloud: unknown, localSnapshot: UserSettingsModel) => {
    const hydrated = await hydrateSettingsFromCloud(normalizeUserSettings(rawCloud), localSnapshot)
    if (hydrated.handoff === 'uploaded') setSettingsNotice(hydrated.notice)
    if (hydrated.handoff === 'upload_failed') setSettingsError(hydrated.error)
    return hydrated
  }, [])

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    setSettingsNotice(null)
    setSettingsError(null)
    // 必须在任何「写本机」之前取快照：交接判定问的是「匿名期本机存过什么」
    const localBefore = readLocalUserSettings()
    try {
      // 会话探测失败 ≠ 匿名：网络 / 非 2xx / 正文解析失败都按「暂时无法确认」处理，
      // 否则已登录用户会被明确告知「你是匿名，登录后可同步」——把故障说成事实。
      // （NextAuth 未登录返回字面量 null 属于「没有会话」的正常回答，由探测器归为 ok）
      const probe = await probeClientSession()
      if (probe.kind !== 'ok') {
        setError(
          isNetworkSessionFailure(probe)
            ? '网络不可用，未能加载用户中心'
            : '登录状态暂时无法确认，请稍后重试',
        )
        setState('error')
        return
      }
      if (!probe.session.user?.id) {
        setAnonId(getAnonId())
        setState('anonymous')
        return
      }

      const res = await fetch('/api/me', { cache: 'no-store' })
      if (res.status === 401) {
        setAnonId(getAnonId())
        setState('anonymous')
        return
      }
      if (!res.ok) {
        setError('用户中心暂时不可用')
        setState('error')
        return
      }
      const data = (await res.json()) as MeOverview
      const hydrated = await hydrate(data.settings, localBefore)
      // 交接发生（成功或失败）时，展示用的设置必须是真正生效的那一份
      setOverview(hydrated.handoff === 'none' ? data : { ...data, settings: hydrated.settings })
      setState('ready')
    } catch {
      setError('网络不可用，未能加载用户中心')
      setState('error')
    }
  }, [hydrate])

  useEffect(() => {
    if (initialOverview) {
      // 服务端已注入：首帧不重复请求；设置仍走统一口径（判定只在 lib 那一处）
      void (async () => {
        const hydrated = await hydrate(initialOverview.settings, readLocalUserSettings())
        if (hydrated.handoff === 'none') return
        setOverview((prev) => (prev ? { ...prev, settings: hydrated.settings } : prev))
      })()
      return
    }
    void load()
    // initialOverview 为常量注入（服务端一次性），无需作为依赖触发重取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateSettings = useCallback((settings: UserSettingsModel) => {
    setOverview((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              ...settings,
              updatedAt: settings.updatedAt ?? prev.settings.updatedAt ?? Date.now(),
            },
          }
        : prev,
    )
  }, [])

  return {
    state,
    overview,
    error,
    anonId,
    settingsNotice,
    settingsError,
    dismissSettingsNotice: () => setSettingsNotice(null),
    reload: load,
    updateSettings,
  }
}
