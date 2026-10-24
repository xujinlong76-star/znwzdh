'use client'

/**
 * 终端用户身份（匿名优先）。
 *
 * 设计：收藏夹 / 搜索历史 / 个性化画像都绑定一个稳定身份。
 * 未登录时用 localStorage 里的 anonId（uuid），登录后由 Web 端把
 * GitHub 身份同步到中枢（POST /api/users/sync）拿到 canonical userId，
 * 两端数据按 userId 合并（见 useFavorites）。
 */

import { ANON_ID_STORAGE_KEY, USER_ID_STORAGE_KEY } from './identity-keys'

const ANON_KEY = ANON_ID_STORAGE_KEY

/** 取匿名 id；没有则生成并持久化。SSR 阶段返回空串（不读 window）。 */
export function getAnonId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem(ANON_KEY)
    if (!id) {
      id = 'anon-' + randomId()
      window.localStorage.setItem(ANON_KEY, id)
    }
    return id
  } catch {
    // 隐私模式 / 存储被禁：退化为进程内 id（刷新丢失，但功能可用）
    return 'anon-' + randomId()
  }
}

/** 当前身份：登录用户 id 优先，否则匿名 id。登录态由 Web 端 session 提供。 */
export function getIdentity(): string {
  if (typeof window === 'undefined') return ''
  try {
    const user = window.localStorage.getItem(USER_ID_STORAGE_KEY)
    if (user) return user
  } catch {
    // ignore
  }
  return getAnonId()
}

export function setIdentity(userId: string): void {
  const value = userId.trim()
  // 匿名 id 绝不能写进 userId 键：那会让 getIdentity() 把匿名身份误当登录身份，
  // 云端同步/作者中心/合并全部按错误归属读写。
  if (!value || value.startsWith('anon-')) return
  try {
    window.localStorage.setItem(USER_ID_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

/** 退出登录时清掉登录身份，回落到匿名 id（匿名数据仍然保留） */
export function clearIdentity(): void {
  try {
    window.localStorage.removeItem(USER_ID_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
