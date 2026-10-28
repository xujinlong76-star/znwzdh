'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { shouldTrackUnread, type UnreadEligibility } from '@/lib/notification-badge'

type Listener = (unread: number) => void

const listeners = new Set<Listener>()
let unread = 0
let identityKey: string | null = null
let generation = 0
let inFlight = false
let timer: ReturnType<typeof setInterval> | null = null
let attached = 0

function publish(next: number): void {
  if (next === unread) return
  unread = next
  listeners.forEach((listener) => listener(unread))
}

async function loadUnread(): Promise<void> {
  if (inFlight) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  const gen = generation
  inFlight = true
  try {
    const res = await fetch('/api/me/notifications/unread-count', { cache: 'no-store' })
    if (gen !== generation) return
    if (res.status === 401) {
      publish(0)
      return
    }
    // 故障时保留上一次角标，不把「取不到」伪装成「没有未读」。
    if (!res.ok) return
    // 响应体不是合法 JSON 时按「拿不到」处理：下面 Number(undefined) 得到 NaN，
    // 会走「保留旧值」分支 —— 吞掉解析异常是安全的，它不该与网络失败区别对待。
    const data = (await res.json().catch(() => { /* 见上：解析失败即无数据 */ return null })) as { unread?: unknown } | null
    const next = Number(data?.unread)
    if (Number.isFinite(next) && next >= 0) publish(Math.trunc(next))
  } catch {
    // 网络抖动保留旧值，下次可见/轮询再对齐
  } finally {
    if (gen === generation) inFlight = false
  }
}

function handleVisibility(): void {
  if (document.visibilityState === 'visible') void loadUnread()
}

function attach(): () => void {
  attached += 1
  if (attached === 1) {
    document.addEventListener('visibilitychange', handleVisibility)
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadUnread()
    }, 60_000)
  }
  return () => {
    attached -= 1
    if (attached > 0) return
    document.removeEventListener('visibilitychange', handleVisibility)
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  const detach = attach()
  void loadUnread()
  const onChange = () => void loadUnread()
  window.addEventListener('navhub_notifications_changed', onChange)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('navhub_notifications_changed', onChange)
    detach()
  }
}

function noopSubscribe(): () => void {
  return () => undefined
}

function getSnapshot(): number {
  return unread
}

function getServerSnapshot(): number {
  return 0
}

/** 标记已读后调用：同一标签页内所有角标立即对齐服务端。 */
export function refreshUnreadNotifications(): void {
  void loadUnread()
}

export function useUnreadNotifications(state: UnreadEligibility): number {
  const active = shouldTrackUnread(state)
  const value = useSyncExternalStore(
    active ? subscribe : noopSubscribe,
    getSnapshot,
    getServerSnapshot,
  )
  const identity = state.identity

  useEffect(() => {
    if (!active) {
      // 退出/转匿名：作废旧身份的在途响应，避免下个身份首帧拿到上一个人的角标。
      if (identityKey !== null) {
        identityKey = null
        generation += 1
        inFlight = false
        publish(0)
      }
      return
    }
    if (identityKey === identity) return
    identityKey = identity
    generation += 1
    inFlight = false
    publish(0)
    void loadUnread()
  }, [active, identity])

  return active ? value : 0
}
