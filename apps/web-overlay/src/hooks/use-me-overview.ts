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
 */
import { useCallback, useEffect, useState } from 'react'
import type { MeOverview } from '@/lib/me-types'
import { isNetworkSessionFailure, probeClientSession } from '@/lib/client-session'
import { getAnonId } from '@/lib/identity'
import { normalizeUserSettings, writeLocalUserSettings, type UserSettingsModel } from '@/lib/user-settings'

export type MeOverviewState = 'loading' | 'anonymous' | 'ready' | 'error'

export interface MeOverviewController {
  state: MeOverviewState
  overview: MeOverview | null
  error: string | null
  /** anonymous 态下展示用的匿名 id（其余态为空串） */
  anonId: string
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

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
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
      setOverview(data)
      // 云端设置是权威：取到概览就回写本地缓存（Save-then-Verify 的「Verify」半边）
      writeLocalUserSettings(normalizeUserSettings(data.settings))
      setState('ready')
    } catch {
      setError('网络不可用，未能加载用户中心')
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (initialOverview) {
      // 服务端已注入：只回写本地设置缓存，不重复请求；identity 事件仍可触发 reload
      writeLocalUserSettings(normalizeUserSettings(initialOverview.settings))
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

  return { state, overview, error, anonId, reload: load, updateSettings }
}
