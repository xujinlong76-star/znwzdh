'use client'

import { useEffect } from 'react'
import {
  XIAOMAOMAO_ENABLED_CHANGED_EVENT,
  loadXiaomaomaoEnabled,
} from '@/lib/xiaomaomao-pref'

const SCRIPT_ID = 'navhub-xiaomaomao-script'
const SCRIPT_SRC = '/xiaomaomao/xiaomaomao.min.js'

function injectXiaomaomaoScript() {
  if (typeof document === 'undefined') return
  if (document.getElementById(SCRIPT_ID) || document.getElementById('xiaomaomao')) return
  const script = document.createElement('script')
  script.id = SCRIPT_ID
  script.src = SCRIPT_SRC
  script.async = true
  document.body.appendChild(script)
}

/**
 * P0-4 按需加载器：
 * - 用户在用户中心关闭小猫猫时，**零下载、零解析、零执行**挂件脚本；
 * - 开启时在空闲期加载压缩版 `/xiaomaomao/xiaomaomao.min.js`（121 KB / 34 KB gzip，immutable 长缓存）；
 * - 若用户在当前会话中于用户中心重新开启，监听事件即时动态注入，无需刷新页面。
 */
export function XiaomaomaoLoader() {
  useEffect(() => {
    let timer: number | null = null
    const scheduleInject = () => {
      if (!loadXiaomaomaoEnabled(window.localStorage)) return
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
      if (typeof ric === 'function') {
        timer = ric(injectXiaomaomaoScript, { timeout: 2500 })
      } else {
        timer = window.setTimeout(injectXiaomaomaoScript, 800)
      }
    }

    if (document.readyState === 'complete') {
      scheduleInject()
    } else {
      window.addEventListener('load', scheduleInject, { once: true })
    }

    const onEnabledChange = (ev: Event) => {
      const detail = (ev as CustomEvent<{ on?: boolean }>).detail
      const enabled = typeof detail?.on === 'boolean' ? detail.on : loadXiaomaomaoEnabled(window.localStorage)
      if (enabled) injectXiaomaomaoScript()
    }
    window.addEventListener(XIAOMAOMAO_ENABLED_CHANGED_EVENT, onEnabledChange)

    return () => {
      window.removeEventListener('load', scheduleInject)
      window.removeEventListener(XIAOMAOMAO_ENABLED_CHANGED_EVENT, onEnabledChange)
      if (timer !== null) {
        const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
        if (typeof cic === 'function') cic(timer)
        else window.clearTimeout(timer)
      }
    }
  }, [])

  return null
}
