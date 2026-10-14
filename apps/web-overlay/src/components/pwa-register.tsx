'use client'

/**
 * Service Worker 注册。
 *
 * 仅生产环境注册：开发期 SW 会缓存 next dev 的模块导致热更新错乱。
 * 更新策略：新 SW 安装后不抢占（skipWaiting 由用户下次访问自然生效），
 * 避免用户正在浏览时页面被强制刷新。
 *
 * BUG 教训：曾经把 register 挂在 window 的 'load' 事件里，而 React 水合
 * 通常在 load 之后才执行 —— 监听回调永远不会触发，SW 一次都没注册过
 * （实测 navigator.serviceWorker.getRegistrations() 为 0、/sw.js 零请求），
 * PWA 完全是个摆设。直接注册即可，无需等 load。
 */

import { useEffect } from 'react'

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    // 直接注册；不等 load 事件（见上方 BUG 教训）
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // 注册失败（非 HTTPS / 浏览器限制）只告警不阻断：PWA 是增强，不是依赖。
      // 注意：不要静默吞掉——静默失败曾让"PWA 已接入"的验收结论失真。
      console.warn('[pwa] service worker 注册失败：', err)
    })
  }, [])

  return null
}
