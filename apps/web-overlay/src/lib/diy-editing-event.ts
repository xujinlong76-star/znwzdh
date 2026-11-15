/**
 * DIY 编排态事件桥：FloatingQuickNav 与 home-diy-storage 之间的极轻通道。
 *
 * 为什么不用 useHomeDIY：FloatingQuickNav 只读 `isEditingLayout` 一个布尔值，
 * 但 `use-home-diy.ts` 的静态 import 闭包是 10 个文件、约 217 KB 源码
 *（diy-presets / home-diy-storage / layout-sync / diy-share-link /
 * diy-layout-schema / use-home-diy-grid / diy-drag / grid-layout /
 * layout-sync-events / use-home-diy 自身），经 providers.tsx 全局挂载后
 * 整棵子树进了根布局的 layout 共享 chunk，/me 等 9 路因此超包预算。
 * 这条桥零依赖、不 import 任何 DIY 模块，断开这条静态链。
 *
 * 正确性：编排态初始恒 false（home-diy-storage 初始 sharedState
 * `isEditingLayout: false`），唯一写入入口 setHomeDiyEditingLayout 每次
 * 翻转都广播一次；订阅方以 false 起步、事件到达后同步，读到的值与
 * useHomeDIY() 读到的同一份状态一致。编排态只由用户手势触发（工具栏 /
 * 恢复中心），不可能在 FloatingQuickNav 挂载前就已为 true，不存在窗口期。
 */
export const DIY_EDITING_LAYOUT_EVENT = 'navhub:diy-editing-layout'

export function dispatchDiyEditingLayout(next: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DIY_EDITING_LAYOUT_EVENT, { detail: next }))
}

export function subscribeDiyEditingLayout(handler: (next: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    handler((event as CustomEvent<boolean>).detail)
  }
  window.addEventListener(DIY_EDITING_LAYOUT_EVENT, listener)
  return () => window.removeEventListener(DIY_EDITING_LAYOUT_EVENT, listener)
}
