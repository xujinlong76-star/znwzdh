/**
 * 复制到剪贴板：**报喜之前必须先确认真的成功**。
 *
 * 真实缺陷：三处直接把写入丢出去，然后无条件宣告「已复制」：
 *
 *     void navigator.clipboard.writeText(url)
 *     toast({ title: '🔗 已复制免登专属分享链接！' })
 *
 * 但剪贴板写入**经常失败，而且悄悄失败**：
 *   - 非安全上下文（http:// 局域网 IP）或浏览器不支持时，
 *     `navigator.clipboard` 根本不存在，取 `.writeText` 会直接抛 TypeError；
 *   - 页面失去焦点、剪贴板权限被拒时，返回的 Promise 会 reject；
 *   - 只要没人接住这个 Promise，失败就不留任何痕迹。
 *
 * 用户看到「已复制」，粘出来却是空的 —— 一句凭空生成的成功宣告。这与本项目其它
 * 页面已修过的「把失败说成事实」是同一类问题（见 lib/degrade.ts、lib/profile-view.ts）。
 *
 * 这里把「是否可用 / 结果 / 失败文案」集中一处：UI 只负责渲染。
 */

export type CopyResult = { ok: true } | { ok: false; reason: string };

/** 没有任何内容可复制（空字符串同样不该报「已复制」） */
export const CLIPBOARD_EMPTY = "没有可复制的内容";

/** 环境根本不支持：非 HTTPS/localhost，或浏览器过旧 */
export const CLIPBOARD_UNSUPPORTED =
  "当前页面用不了剪贴板（浏览器不支持，或不是 HTTPS / localhost 这样的安全上下文）";

/** 环境支持，但这次写入被拒绝 */
export const CLIPBOARD_DENIED = "浏览器拒绝了这次剪贴板写入（页面可能失去焦点，或剪贴板权限被拒）";

/** 剪贴板 API 是否可用（纯询问，不触发写入） */
export function clipboardSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const api = navigator.clipboard;
  return typeof api?.writeText === "function";
}

/**
 * 写入剪贴板，并把结果**如实回报**。
 * 永远不抛异常：调用方拿到 `ok:false` 就知道该说什么，而不是自己猜。
 */
export async function copyText(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, reason: CLIPBOARD_EMPTY };
  if (!clipboardSupported()) return { ok: false, reason: CLIPBOARD_UNSUPPORTED };
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, reason: CLIPBOARD_DENIED };
  }
}

/** 复制失败时的提示文案（统一措辞，各处不再自己发明） */
export function copyFailureToast(result: { ok: false; reason: string }): {
  title: string;
  description: string;
} {
  return {
    title: "复制失败",
    description: `${result.reason}。可以手动选中文字再按 Ctrl/Cmd+C。`,
  };
}
