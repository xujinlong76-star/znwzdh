import { getIdentity } from './identity'
import type { IdentityReadyState } from '../hooks/useIdentityReady'

export const NOTIFICATIONS_READ_EVENT = 'navhub_notifications_read'
export const NOTIFICATIONS_POLL_MS = 60_000

export function notificationIdentity({ identity, ready, isAnonymous }: IdentityReadyState): string | null {
  return ready && identity && !isAnonymous && !identity.startsWith('anon-') ? identity : null
}

export interface NotificationUnreadSnapshot {
  identity: string | null
  unread: number | null
  error: boolean
}

export const EMPTY_NOTIFICATION_UNREAD: NotificationUnreadSnapshot = { identity: null, unread: null, error: false }

export function notifyNotificationsRead(identity: string) {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT, { detail: { identity } }))
}

export function createNotificationUnreadStore({
  fetcher = (...args: Parameters<typeof fetch>) => fetch(...args),
  readIdentity = getIdentity,
  getDocument = () => document,
  getWindow = () => window,
} = {}) {
  let snapshot = EMPTY_NOTIFICATION_UNREAD
  let generation = 0
  let flight: { controller: AbortController; promise: Promise<void> } | null = null
  const listeners = new Map<() => void, string>()
  let stop: (() => void) | null = null
  const emit = () => listeners.forEach((_, listener) => listener())
  const cancel = () => {
    generation++
    flight?.controller.abort()
    flight = null
  }

  const refresh = (): Promise<void> => {
    const identity = snapshot.identity
    if (!identity || !listeners.size || getDocument().visibilityState !== 'visible' || readIdentity() !== identity) {
      return Promise.resolve()
    }
    if (flight) return flight.promise
    const version = generation
    const controller = new AbortController()
    const current = () => generation === version && readIdentity() === identity && !controller.signal.aborted
    const promise = (async () => {
      try {
        const response = await fetcher('/api/me/notifications/unread-count', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('通知未读数暂不可用')
        const data = await response.json() as { ok?: boolean; unread?: number }
        if (data?.ok !== true || !Number.isSafeInteger(data.unread) || data.unread! < 0) throw new Error('通知未读数无效')
        if (!current()) return
        snapshot = { identity, unread: data.unread!, error: false }
        emit()
      } catch {
        if (!current()) return
        snapshot = { ...snapshot, error: true }
        emit()
      } finally {
        if (generation === version) flight = null
      }
    })()
    flight = { controller, promise }
    return promise
  }

  const invalidate = (identity: string) => {
    if (snapshot.identity !== identity) return
    cancel()
    void refresh()
  }

  const subscribe = (identity: string, listener: () => void) => {
    if (!identity || identity.startsWith('anon-')) return () => {}
    const first = listeners.size === 0
    const changed = snapshot.identity !== identity
    if (changed) {
      cancel()
      snapshot = { identity, unread: null, error: false }
    }
    listeners.set(listener, identity)
    if (changed) emit()
    if (first) {
      const doc = getDocument()
      const win = getWindow()
      const onVisible = () => { if (doc.visibilityState === 'visible') void refresh() }
      const onRead = (event: Event) => {
        const next = (event as CustomEvent<{ identity?: string }>).detail?.identity
        if (next) invalidate(next)
      }
      const onIdentity = (event: Event) => {
        const next = (event as CustomEvent<{ identity?: string | null }>).detail?.identity ?? readIdentity()
        if (next === snapshot.identity) return
        cancel()
        snapshot = next && [...listeners.values()].includes(next)
          ? { identity: next, unread: null, error: false }
          : EMPTY_NOTIFICATION_UNREAD
        emit()
        void refresh()
      }
      const timer = setInterval(() => void refresh(), NOTIFICATIONS_POLL_MS)
      doc.addEventListener('visibilitychange', onVisible)
      win.addEventListener(NOTIFICATIONS_READ_EVENT, onRead)
      const identityEvents = ['navhub_identity_ready', 'navhub_identity_changed', 'navhub_identity_merged', 'storage']
      identityEvents.forEach((event) => win.addEventListener(event, onIdentity))
      stop = () => {
        clearInterval(timer)
        doc.removeEventListener('visibilitychange', onVisible)
        win.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead)
        identityEvents.forEach((event) => win.removeEventListener(event, onIdentity))
      }
    }
    if (first || changed) void refresh()
    return () => {
      listeners.delete(listener)
      if (listeners.size) return
      stop?.()
      stop = null
      cancel()
      snapshot = EMPTY_NOTIFICATION_UNREAD
    }
  }

  return { subscribe, refresh, invalidate, getSnapshot: () => snapshot }
}

export function createNotificationSession(identity: string | null, readIdentity = getIdentity) {
  let active = false
  let generation = 0
  let controller = new AbortController()
  let pending = false
  const confirmed = new Set<string>()
  const isCurrent = () => active && Boolean(identity) && readIdentity() === identity
  return {
    activate() {
      active = true
      generation++
      pending = false
      controller = new AbortController()
    },
    dispose() {
      active = false
      generation++
      controller.abort()
    },
    begin(readId?: string) {
      if (!isCurrent() || pending || (readId && confirmed.has(readId))) return null
      pending = true
      const version = generation
      return {
        signal: controller.signal,
        isCurrent: () => isCurrent() && generation === version,
        confirmRead: () => { if (readId && isCurrent() && generation === version) confirmed.add(readId) },
        finish: () => { if (generation === version) pending = false },
      }
    },
  }
}
