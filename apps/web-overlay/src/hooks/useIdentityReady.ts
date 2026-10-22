'use client'

/**
 * 「身份就绪」的统一入口（方案 v2 N1）。
 *
 * 背景：`getIdentity()` 只是一次 localStorage 读取，它无法区分两件事：
 *   1. 用户确实是匿名（SessionSync 已跑完，确认无会话）；
 *   2. 会话同步还没完成（刚打开页面，userId 尚未写入）。
 * 页面若在挂载时读一次就下结论，首次登录直接落在 `/favorites` 会整页按匿名渲染，
 * 且没有任何重试路径。
 *
 * 约定：
 * - `SessionSync` 每次完成都会广播一次 `navhub_identity_ready`（登录/匿名都发）；
 * - 身份变化（登录、合并、退出、跨标签页）广播 `navhub_identity_changed` /
 *   `navhub_identity_merged` / 原生 `storage`；
 * - 3 秒兜底：事件因异常缺失时按当前 `getIdentity()` 继续，绝不无限阻塞。
 *
 * 页面用法：只依赖 `identity` 触发取数/同步，不要自己在挂载时再读一次。
 */
import { useEffect, useState } from 'react'
import { getIdentity } from '@/lib/identity'

export interface IdentityReadyState {
  /** 当前身份（登录 userId 或 anon-*）；SSR/读取失败时为 null */
  identity: string | null
  /** 是否已经收到「会话同步完成」信号（或兜底超时） */
  ready: boolean
  isAnonymous: boolean
}

function readIdentity(): string | null {
  try {
    return getIdentity() || null
  } catch {
    return null
  }
}

function detailIdentity(event: Event): string | null | undefined {
  const detail = (event as CustomEvent<{ identity?: string | null }>).detail
  if (!detail || detail.identity === undefined) return undefined
  return detail.identity || null
}

export function useIdentityReady(timeoutMs = 3000): IdentityReadyState {
  const [identity, setIdentity] = useState<string | null>(() => readIdentity())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clear = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    const settle = (next?: string | null) => {
      setIdentity(next === undefined ? readIdentity() : next)
      setReady(true)
      clear()
    }

    const onReady = (event: Event) => settle(detailIdentity(event))
    const onChanged = (event: Event) => {
      const next = detailIdentity(event)
      setIdentity(next === undefined ? readIdentity() : next)
    }
    const onStorage = () => setIdentity(readIdentity())

    window.addEventListener('navhub_identity_ready', onReady)
    window.addEventListener('navhub_identity_changed', onChanged)
    window.addEventListener('navhub_identity_merged', onChanged)
    window.addEventListener('storage', onStorage)
    timer = setTimeout(() => settle(), timeoutMs)

    return () => {
      clear()
      window.removeEventListener('navhub_identity_ready', onReady)
      window.removeEventListener('navhub_identity_changed', onChanged)
      window.removeEventListener('navhub_identity_merged', onChanged)
      window.removeEventListener('storage', onStorage)
    }
  }, [timeoutMs])

  return {
    identity,
    ready,
    isAnonymous: Boolean(identity && identity.startsWith('anon-')),
  }
}
