'use client'

/**
 * 首页运营通告条的显隐状态（2026-11-21 首屏重构要求 2）。
 *
 * 为什么需要独立 store：通告条的**开关**在左侧边栏底部（「探索与专题」），
 * 本体渲染在主内容区（HomeMicroStrip）。两者分处两棵互不相邻的子树，
 * 没有共同父组件可以提状态；用 window 事件桥接是这套代码既有做法
 * （见 public/xiaomaomao/xiaomaomao.js 的 window.XIAOMAOMAO + navhub:xiaomaomao-state）。
 *
 * 三态语义：
 *  - 'auto'      默认。**不渲染**——要求 2 的硬指标是「默认不挤占主工作区
 *                首屏高度」，首访也不该白占一行。
 *  - 'shown'     用户从侧栏「探索与专题」主动打开。
 *  - 'dismissed' 用户点过通告条上的 ×，记住别再自动冒出来。
 */

export type AnnouncementState = 'auto' | 'shown' | 'dismissed'

export const ANNOUNCEMENT_STORAGE_KEY = 'navhub.home.announcement.v1'
/** 状态变更广播事件：detail = { state } */
export const ANNOUNCEMENT_CHANGE_EVENT = 'navhub:announcement-change'

export function readAnnouncementState(): AnnouncementState {
  try {
    const raw = window.localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY)
    if (raw === 'shown' || raw === 'dismissed') return raw
    return 'auto'
  } catch {
    return 'auto'
  }
}

export function writeAnnouncementState(state: AnnouncementState): void {
  try {
    if (state === 'auto') window.localStorage.removeItem(ANNOUNCEMENT_STORAGE_KEY)
    else window.localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, state)
  } catch {
    // 隐私模式等写失败只影响「下次还问」，不影响本次显隐
  }
  try {
    window.dispatchEvent(new CustomEvent(ANNOUNCEMENT_CHANGE_EVENT, { detail: { state } }))
  } catch {
    // 事件派发失败不影响调用方
  }
}

/** 通告条在本帧是否应该渲染：只有用户主动打开过才出现。 */
export function shouldRenderAnnouncement(state: AnnouncementState): boolean {
  return state === 'shown'
}
