/**
 * 拖拽手柄上下文（轻量层，不 import dnd-kit）。
 *
 * 分层原因：dnd-kit 实测约 133 KB（minified），直接 import 进
 * navigation-card 会吃掉首页 / 预算的大半 headroom。所以：
 *   - 卡片 / 分区只 import 这一层（React context + 一个 ref 回调），
 *     零拖拽依赖；
 *   - 真正的 dnd-kit 逻辑在 components/diy/diy-drag-kit.tsx，
 *     由编辑态进入时动态 import（navigation-category-section 里
 *     import()，navigation-content 里由 coordinator 接线 provider）。
 * 没有 provider 时 context 是 null，卡片不渲染拖拽手柄，只留 ⋯ 菜单。
 */
'use client'

import { createContext, useContext } from 'react'

/**
 * 拖拽手柄的 ref 回调：重型层（DiyDraggableCard）从 useDraggable 拿到
 * handleRef 后经这个 context 交给卡片里的手柄按钮。
 * 卡片渲染手柄按钮时把这个回调挂到 ref 上即可。
 */
export type DiyDragHandleRef = (element: Element | null) => void

export const DiyDragHandleContext = createContext<DiyDragHandleRef | null>(null)

/** 卡片里调用：返回 null = 当前没有拖拽会话（不渲染手柄） */
export function useDiyDragHandleRef(): DiyDragHandleRef | null {
  return useContext(DiyDragHandleContext)
}

/**
 * 一次 dnd-kit 拖拽是否正在进行（指针/键盘皆算）。
 *
 * 用途：卡片操作区的方向键漫游（navigation-card 的 handleActionsKeyDown）
 * 必须知道这件事——键盘拖拽进行中（Space 已拿起卡片），←/→/Esc 要交给
 * dnd-kit KeyboardSensor（它在 document 捕获阶段监听），漫游再
 * preventDefault + 挪焦点，方向键就只动焦点、拖不动卡片了。
 * 默认 false（provider 外渲染的卡片沿用旧漫游行为）。
 */
export const DiyDragActiveContext = createContext<boolean>(false)

/** 卡片操作区调用：当前是否有拖拽正在进行 */
export function useDiyDragActive(): boolean {
  return useContext(DiyDragActiveContext)
}
