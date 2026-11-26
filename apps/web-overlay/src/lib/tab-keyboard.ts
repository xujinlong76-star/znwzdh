import type { KeyboardEvent } from 'react'

/**
 * U-434：tablist 通用 ←/→（+ Home/End）漫游处理器。
 *
 * 之前全仓 9 处 role="tablist" 都没有键盘支持：声明了 tab 语义，却只能用
 * 鼠标点，键盘用户按 Tab 会逐个经过每个 tab、方向键什么都不做。
 * 已有的最完整实现在 components/workspace-filter.tsx（handleTabKeyDown，
 * 另见 home-capsule-row.tsx 的同款内联版）——但 workspace-filter 是
 * U-439 待删的死代码，钩子不能住在它里面，否则随文件一起被删。
 * 因此抽到这里：所有 tablist 共用同一个处理器，行为一处改、全仓一致。
 *
 * 契约（WAI-ARIA tabs 漫游）：
 *  - 只认 ArrowLeft / ArrowRight / Home / End，其余键一律放行（不吞
 *    输入法、快捷键与其它组件的按键处理）；
 *  - 在当前 tablist 内的 [role="tab"] 之间循环移动焦点，首尾回绕；
 *  - 移动后 click() 新 tab——与鼠标点同一个入口，选中态与副作用
 *    （清武装、切视图、换榜单）走同一条路，不另起一套状态机；
 *  - 依赖调用方给每个 tab 写 roving tabindex（选中 0、其余 -1），
 *    否则方向键移动后 Tab 键仍会逐个停在每个 tab 上；
 *  - 目标元素经 e.currentTarget.querySelectorAll 现取现算：条件渲染
 *    增减 tab（如 AI 学习中心的概念图谱 tab）时不用手动同步列表。
 */
export function handleTabListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') {
    return
  }
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  if (tabs.length === 0) return
  const currentIndex = tabs.findIndex((tab) => tab === document.activeElement)
  if (currentIndex === -1) return
  e.preventDefault()
  let nextIndex: number
  if (e.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabs.length
  } else if (e.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
  } else if (e.key === 'Home') {
    nextIndex = 0
  } else {
    nextIndex = tabs.length - 1
  }
  tabs[nextIndex]?.focus()
  tabs[nextIndex]?.click()
}
