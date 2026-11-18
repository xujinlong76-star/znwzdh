'use client'

/**
 * Service Worker 注册 + **更新提示**。
 *
 * 仅生产环境注册：开发期 SW 会缓存 next dev 的模块导致热更新错乱。
 * 更新策略：新 SW 安装时 `skipWaiting()`（见 sw.js）→ 立即接管；
 * 页面侧监听 `updatefound`，在「已有旧 SW 控制（`controller` 存在）」时才提示
 * 「有新版本」——首次访问注册时也会走 updatefound，但那不是"更新"，不打扰用户。
 * 用户点「刷新」时新 SW 已激活，`location.reload()` 拿到的即是新资源。
 *
 * BUG 教训：曾经把 register 挂在 window 的 'load' 事件里，而 React 水合
 * 通常在 load 之后才执行 —— 监听回调永远不会触发，SW 一次都没注册过
 * （实测 navigator.serviceWorker.getRegistrations() 为 0、/sw.js 零请求），
 * PWA 完全是个摆设。直接注册即可，无需等 load。
 */

import { useEffect, useRef, useState } from 'react'

export function PwaRegister() {
  /** 是否有可用的更新待应用 */
  const [updateReady, setUpdateReady] = useState(false)
  /** 只有「确实提示过更新」才允许 controllerchange 自动刷新——
   *  首次安装时 clients.claim() 同样会触发 controllerchange，
   *  不加这个闸门会让用户首次访问就被刷新一次 */
  const updatePromptedRef = useRef(false)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // 开发环境下主动注销可能残留的 Service Worker，避免其拦截开发期动态模块与 HMR 导致 404
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            void registration.unregister()
          }
        }).catch(() => {
          // 开发环境注销残留 SW 的顺手操作：失败无需处理，也不影响生产逻辑
        })
      }
      return
    }
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    let disposed = false
    let registration: ServiceWorkerRegistration | null = null

    const markUpdate = () => {
      updatePromptedRef.current = true
      setUpdateReady(true)
    }

    // 具名 handler：updatefound 挂在长生命周期的 ServiceWorkerRegistration 上，
    // 必须在 cleanup 中解绑，否则 StrictMode 双挂载 / HMR 下重复绑定。
    const onUpdateFound = () => {
      const reg = registration
      const sw = reg?.installing
      if (!sw) return
      const onStateChange = () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) markUpdate()
        if (sw.state === 'installed' || sw.state === 'activated' || sw.state === 'redundant') {
          sw.removeEventListener('statechange', onStateChange)
        }
      }
      sw.addEventListener('statechange', onStateChange)
    }

    // 直接注册；不等 load 事件（见上方 BUG 教训）
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg
        if (disposed) {
          reg.removeEventListener('updatefound', onUpdateFound)
          return
        }
        if (reg.waiting && navigator.serviceWorker.controller) markUpdate()
        reg.addEventListener('updatefound', onUpdateFound)
      })
      .catch((err) => {
        console.warn('[pwa] service worker 注册失败：', err)
      })

    // 更新提示出现后，新 SW 接管（controllerchange）→ 自动刷新到新版本
    const onControllerChange = () => {
      if (!updatePromptedRef.current) return
      if (sessionStorage.getItem('pwa-reloaded')) return
      sessionStorage.setItem('pwa-reloaded', '1')
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      disposed = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      registration?.removeEventListener('updatefound', onUpdateFound)
    }
  }, [])

  if (!updateReady) return null

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-lg border border-border/80 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
      <span className="text-sm">有新版本可用</span>
      <button
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        onClick={() => {
          // 新 SW 已由 skipWaiting 激活；这里直接刷新拿到新资源，
          // 不依赖 controllerchange（若自动刷新已发生则 sessionStorage 闸门会兜住）
          sessionStorage.removeItem('pwa-reloaded')
          window.location.reload()
        }}
      >
        刷新
      </button>
      <button
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setUpdateReady(false)}
      >
        稍后
      </button>
    </div>
  )
}
