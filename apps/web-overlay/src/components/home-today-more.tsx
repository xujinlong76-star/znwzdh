'use client'

/**
 * 首页「更多今日内容」折叠区（U-24）。
 *
 * 把原来首屏直出的 4 条带顶（简报条、考试条、接力卡、连胜条）原样收进来，
 * 相对顺序与内容、行为零变化；今日区已把考试倒计时与下一步节点提上去，
 * 所以折叠区默认收起也不会藏住时效信息。
 *
 * 折叠只用 `hidden` 属性切换：4 条的 SSR HTML 本来就在首页里，不新增字节、
 * 不新增请求，展开时无加载态；开关状态记本机 localStorage（只记开关，
 * 不记任何用户数据），默认收起。服务端与客户端首帧都按收起渲染，
 * 挂载后才读本机状态，避免水合错位。
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** 折叠开关的本机存储键：只记开/关（'1' / '0'）。 */
export const HOME_TODAY_MORE_STORAGE_KEY = 'navhub.home.todayMoreOpen.v1'
/** 默认收起：导航网格优先上首屏；时效信息已在今日区。 */
export const HOME_TODAY_MORE_DEFAULT_OPEN = false

export function HomeTodayMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(HOME_TODAY_MORE_DEFAULT_OPEN)

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(HOME_TODAY_MORE_STORAGE_KEY) === '1')
    } catch {
      // 存储不可用时保持默认收起，不抛。
    }
  }, [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      window.localStorage.setItem(HOME_TODAY_MORE_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // 存不下就只关这一次渲染，不抛。
    }
  }

  return (
    <section aria-label="更多今日内容">
      <div className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="home-today-more"
          className="inline-flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <span>更多今日内容</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            简报 · 考试季 · 接力 · 连胜
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </span>
        </button>
      </div>
      <div id="home-today-more" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
