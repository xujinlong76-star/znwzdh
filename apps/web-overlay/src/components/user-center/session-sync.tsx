'use client'

/**
 * 会话 → 用户中心身份同步。
 *
 * 流程：
 *  1. 读取 NextAuth 会话；
 *  2. 已登录则 POST /api/me/sync（服务端 upsert users 表并返回 canonical userId）；
 *  3. 把 canonical userId 写入 localStorage（getIdentity 全局生效）；
 *  4. 若本机还有 anonId，调用 /api/me/merge 把匿名数据并入登录身份（幂等）。
 *
 * 只做一次（每个 identity+anon 组合），失败不阻塞页面；合并失败会在
 * /me 页面显示待处理状态。未登录时清掉陈旧 userId，回落到匿名身份。
 */
import { useEffect } from 'react'
import { clearIdentity, getAnonId, getIdentity, setIdentity } from '@/lib/identity'
import { canonicalUserId } from '@/lib/me-identity'

export function SessionSync() {
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      // 「会话同步完成」只广播一次：登录与匿名都要发，页面才能区分
      // 「确实是匿名」和「还没同步完」（见 hooks/useIdentityReady.ts）
      let announced = false
      const announceReady = (identity?: string | null) => {
        if (announced || cancelled) return
        announced = true
        window.dispatchEvent(
          new CustomEvent('navhub_identity_ready', {
            detail: { identity: identity === undefined ? getIdentity() : identity },
          }),
        )
      }

      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' })
        if (!res.ok) return
        const session = (await res.json()) as { user?: { id?: string } }
        if (!session?.user?.id) {
          clearIdentity()
          return
        }

        const expected = canonicalUserId(session.user)
        if (!expected) return

        // 已经同步过的普通页面访问不再打一次 /api/me/sync（省掉每页一个写请求）；
        // 首次登录或 userId 被清理时仍走服务端 upsert。
        let identity = expected
        let storedUserId: string | null = null
        try {
          storedUserId = window.localStorage.getItem('navhub.userId')
        } catch {
          storedUserId = null
        }
        if (storedUserId !== expected) {
          const sync = await fetch('/api/me/sync', { method: 'POST', cache: 'no-store' })
          if (!sync.ok) return
          const data = (await sync.json()) as { identity?: string }
          if (cancelled || !data.identity) return
          identity = data.identity
        }

        setIdentity(identity)
        window.dispatchEvent(new CustomEvent('navhub_identity_changed', { detail: { identity } }))

        const anon = getAnonId()
        if (!anon) return
        const flag = `navhub.merge.${identity}.${anon}`
        try {
          if (window.localStorage.getItem(flag)) return
        } catch {
          return
        }

        const merge = await fetch('/api/me/merge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ anonId: anon }),
          cache: 'no-store',
        })
        if (!cancelled && merge.ok) {
          try {
            window.localStorage.setItem(flag, '1')
          } catch {
            // 存储不可用：下次仍会重试，合并本身幂等
          }
          window.dispatchEvent(new CustomEvent('navhub_identity_merged', { detail: { identity } }))
        }
      } catch {
        // 会话/中枢不可用：保持现状，不覆盖本地身份
      } finally {
        // 任何路径（登录 / 匿名 / 请求失败）都要解锁页面：失败时按当前身份继续，
        // 页面自身的降级态再处理「取数失败」，不让身份同步成为新的无限等待点
        announceReady()
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
