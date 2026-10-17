/**
 * 统一的剪贴板写入：**永不 reject**，返回值表示是否真的写进去了。
 *
 * 为什么不用裸 `navigator.clipboard.writeText`：
 *   - 非安全上下文（`http://` 部署、部分 WebView）里 Clipboard API 不存在或直接抛；
 *   - 文档失焦时（点完按钮立刻 blur）`writeText` 会 reject；
 *   - 仓里曾有 6 处 `void navigator.clipboard...` / 裸调用后无条件 `setCopied(true)`
 *     并弹"已复制"——失败时既是 unhandled rejection，又是**假成功**：
 *     用户以为复制好了，粘贴才发现是空的。
 *
 * 兜底用 `textarea + execCommand('copy')`：API 已废弃，但仍是 http 下唯一可用手段
 * （tokens 页早就这么做了，这里抽出来共用，避免各处各写一份还漏掉 catch）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 无权限 / 非安全上下文 / 文档失焦 -> 走降级分支
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
