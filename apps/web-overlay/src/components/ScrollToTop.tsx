'use client'
/**
 * 回顶按钮（2026-11-21 收口 → 2026-11-22 去重）。
 *
 * ## 为什么这里是空操作
 *
 * 统一浮坞 GlobalFloatingDock 已在根 layout（app/layout.tsx:300）全局挂载，
 * 内含回顶按钮。而 /videos 页仍保留 <ScrollToTop /> 调用点——若这里再返回
 * 一个 <GlobalFloatingDock />，页面上会出现**两个回顶按钮重叠**（两者都
 * fixed bottom-right，z-40，矩形完全相交）。
 *
 * 因此本组件退化为兼容薄壳：返回 null，保留既有调用点不报错。
 * 真正的回顶能力由 layout 的唯一浮坞提供，全站一致。
 *
 * 若未来要下线本组件，删除 /videos/page.tsx 的 import 与调用即可。
 */
export function ScrollToTop() {
  return null
}
