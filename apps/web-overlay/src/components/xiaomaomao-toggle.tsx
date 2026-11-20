'use client'

import { useEffect, useState } from 'react'
import { Cat } from 'lucide-react'

/**
 * 小猫猫挂件开关（首屏瘦身）：放在侧边栏底部，与通知铃并列。
 *
 * 挂件默认收起（xiaomaomao.js 默认 closed: true），本开关是唯一的常驻
 * 开启入口：点一下展开/收起小猫猫。状态经 window.XIAOMAOMAO 桥接
 * （getState / setCollapsed）与 navhub:xiaomaomao-state 事件同步。
 * 挂件脚本以 lazyOnload 加载、桥接可能晚到：挂载时先读一次 getState，
 * 再监听状态事件；桥接始终不可用（如挂件功能关闭）时不渲染本按钮。
 */
interface XiaomaomaoBridge {
  getState?: () => { alwaysDynamic: boolean; closed: boolean; play: boolean }
  setCollapsed?: (closed: boolean) => boolean
}

function getCatBridge(): XiaomaomaoBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { XIAOMAOMAO?: XiaomaomaoBridge }).XIAOMAOMAO
}

export function XiaomaomaoToggle() {
  const [available, setAvailable] = useState(false)
  const [closed, setClosed] = useState(true)

  useEffect(() => {
    const syncFromBridge = () => {
      const bridge = getCatBridge()
      if (!bridge) return false
      setAvailable(true)
      try {
        const state = bridge.getState?.()
        if (state) setClosed(!!state.closed)
      } catch {
        // 桥接读状态失败时保持上次状态，不阻断渲染
      }
      return true
    }

    // 状态事件：挂件每次收起/展开都会广播，本按钮经此同步
    const onState = (e: Event) => {
      const detail = (e as CustomEvent<{ closed?: boolean }>).detail
      if (typeof detail?.closed === 'boolean') {
        setAvailable(true)
        setClosed(detail.closed)
      }
    }
    window.addEventListener('navhub:xiaomaomao-state', onState)

    // 脚本 lazyOnload：桥接可能晚到，首帧读不到就每 500ms 补读一次（最多 5 秒）
    let timer: number | undefined
    if (!syncFromBridge()) {
      timer = window.setInterval(() => {
        if (syncFromBridge()) window.clearInterval(timer)
      }, 500)
      window.setTimeout(() => window.clearInterval(timer), 5000)
    }

    return () => {
      window.removeEventListener('navhub:xiaomaomao-state', onState)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [])

  if (!available) return null

  return (
    <button
      type="button"
      onClick={() => {
        const bridge = getCatBridge()
        if (!bridge?.setCollapsed) return
        // 桥接内部会落盘并广播 navhub:xiaomaomao-state，本按钮经事件同步
        bridge.setCollapsed(!closed)
        setClosed(!closed)
      }}
      aria-label={closed ? '展开小猫猫挂件' : '收起小猫猫挂件'}
      title={closed ? '展开小猫猫' : '收起小猫猫'}
      aria-pressed={!closed}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
    >
      <Cat className="h-4 w-4" aria-hidden />
      {closed ? (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-muted-foreground/50"
          title="小猫猫已收起"
        />
      ) : null}
    </button>
  )
}
