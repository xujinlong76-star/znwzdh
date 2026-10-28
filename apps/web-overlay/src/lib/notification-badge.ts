export interface UnreadEligibility {
  ready: boolean
  identity: string | null
  isAnonymous: boolean
}

export function shouldTrackUnread(state: UnreadEligibility): boolean {
  return state.ready && Boolean(state.identity) && !state.isAnonymous
}

export function unreadBadgeText(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null
  return unread > 9 ? '9+' : String(Math.trunc(unread))
}
