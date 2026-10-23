'use client'

/**
 * 用户中心概览 / 账号 / 插件页共用的取数钩子。
 *
 * 语义与 `/me` 四态一致：会话探测失败落 error（可重试），未登录落 anonymous，
 * `/api/me` 非 2xx（401 除外）落 error。失败绝不当成「空数据」。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Overview } from '@/app/me/me-view'

export type MeOverviewState = 'loading' | 'anonymous' | 'ready' | 'error'

export interface MeOverviewController {
  state: MeOverviewState
  overview: Overview | null
  error: string | null
  reload: () => Promise<void>
}

export function useMeOverview(): MeOverviewController {
  const [state, setState] = useState<MeOverviewState>('loading')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' })
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
        setState('anonymous')
        return
      }

      const res = await fetch('/api/me', { cache: 'no-store' })
      if (res.status === 401) {
        setState('anonymous')
        return
      }
      if (!res.ok) {
        setError('用户中心暂时不可用')
        setState('error')
        return
      }
      setOverview((await res.json()) as Overview)
      setState('ready')
    } catch {
      setError('网络不可用，未能加载用户中心')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { state, overview, error, reload: load }
}
