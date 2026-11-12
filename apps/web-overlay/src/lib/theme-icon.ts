/**
 * 主题图标判定（纯函数，无 React 依赖）：
 * 从 skin-picker.tsx 抽出来，让 node 测试能直接 import 它——
 * 以前测试只能用 new Function 从 .tsx 源码里抠函数体，
 * 组件本身在 node 环境下永远挂载不了。
 */
export function isThemeIconUrl(icon: string | null | undefined): icon is string {
  if (!icon) return false
  const value = icon.trim()
  // scheme 不区分大小写：HTTPS://、Data:image/ 也要认
  const lower = value.toLowerCase()
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    value.startsWith('/') ||
    lower.startsWith('data:image')
  )
}
