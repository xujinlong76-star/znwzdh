'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useIdentityReady } from './useIdentityReady'
import { createNotificationUnreadStore, EMPTY_NOTIFICATION_UNREAD, notificationIdentity } from '@/lib/notifications-client'

const store = createNotificationUnreadStore()
const serverSnapshot = () => EMPTY_NOTIFICATION_UNREAD

export function useNotificationUnread(enabled = true) {
  const identityReady = useIdentityReady()
  const identity = enabled ? notificationIdentity(identityReady) : null
  const subscribe = useCallback((listener: () => void) => (
    identity ? store.subscribe(identity, listener) : () => {}
  ), [identity])
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, serverSnapshot)
  return identity && snapshot.identity === identity ? snapshot : EMPTY_NOTIFICATION_UNREAD
}
