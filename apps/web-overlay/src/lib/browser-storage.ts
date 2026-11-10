/**
 * 浏览器本地存储的**类型安全**访问入口。
 *
 * ## 为什么需要
 *
 * 有 7 个文件各自复制了一份完全相同的 getStorage()：
 *
 *   function getStorage(): Storage | null {
 *     if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
 *     if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
 *       return (globalThis as any).localStorage
 *     }
 *     return null
 *   }
 *
 * 两个问题：
 *   1. **重复**：11 处 (globalThis as any).localStorage，改一处要改 7 个文件；
 *   2. **as any 是显式类型债务**（本仓库有 no-explicit-any 棘轮盯着）。
 *
 * 实际上这一点都不需要 any：Storage 是标准 DOM 类型，
 * globalThis 上是否存在它可以用 in 运算符安全判定。
 *
 * ## 为什么不直接写 window.localStorage
 *
 * 因为这段代码会跑在三种环境里：
 *   - 浏览器：window.localStorage 可用；
 *   - Node / SSR：没有 window，退化到 globalThis.localStorage（某些宿主会注入）；
 *   - 隐私模式 / 配额禁用：访问 localStorage 会**抛异常**，必须 catch。
 *
 * 第三种是最容易被漏掉的：Safari 无痕模式下读 window.localStorage 可能直接抛，
 * 所以这里用 try/catch 包住，失败返回 null 而不是让整页崩掉。
 */

/** 取当前环境的 Storage 实现；不可用（SSR / 隐私模式 / 被禁用）时返回 null */
export function getBrowserStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // 探测一次：Safari 无痕模式下 setItem 会抛，光判断存在性不够
      const probe = '__navhub_storage_probe__'
      window.localStorage.setItem(probe, '1')
      window.localStorage.removeItem(probe)
      return window.localStorage
    }
  } catch {
    // 隐私模式 / 配额禁用：继续尝试 globalThis，最终返回 null
  }

  try {
    // 某些宿主（Worker、测试环境）只在 globalThis 上注入
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      const candidate = (globalThis as { localStorage?: Storage }).localStorage
      if (candidate) return candidate
    }
  } catch {
    // 同上：访问受限时静默退化
  }

  return null
}

/** 是否存在可用的本地存储（给 UI 决定要不要显示「本机保存」类提示） */
export function hasBrowserStorage(): boolean {
  return getBrowserStorage() !== null
}
