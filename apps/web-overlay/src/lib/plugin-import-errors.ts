/**
 * 插件导入失败文案（Phase 2 批 B，设计线 K7）：
 * 失败提示按三类指导语模板写——请先登录 / 同名已存在 / 请稍后重试，
 * 服务端原话（err.message）只做补充，不再把「Unauthorized」这类技术串
 * 当主文案甩给用户。需要登录时，调用方在失败行旁展示「去登录」入口。
 */

export interface ImportErrorView {
  /** 主文案：给用户看的友好说明，不含技术串 */
  message: string;
  /** 补充说明：需要登录时是操作指引；其余情况是服务端原话或网络提示 */
  detail?: string;
  /** 是否在失败行旁展示「去登录」入口 */
  needsLogin: boolean;
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "";
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  return undefined;
}

/** 需要登录的信号：401/403 状态，或服务端透传的未授权原话。 */
function isAuthFailure(status: number | undefined, raw: string): boolean {
  if (status === 401 || status === 403) return true;
  return /\bunauthorized\b|\bforbidden\b|未登录|没有权限|请先登录/i.test(raw);
}

export function formatImportError(err: unknown): ImportErrorView {
  const status = statusOf(err);
  const raw = rawMessage(err).trim();
  if (isAuthFailure(status, raw)) {
    // 401/403：主文案只讲「请先登录」，绝不把 Unauthorized 原串透传出来；
    // 补充说明只讲操作指引，不贴服务端原话。
    return {
      message: "请先登录，登录后重新导入即可",
      detail: "只有登录用户可以导入插件",
      needsLogin: true,
    };
  }
  if (status === 409 || /已存在|冲突|duplicate/i.test(raw)) {
    return {
      message: "同名插件已存在，不会覆盖已有版本",
      detail: raw || undefined,
      needsLogin: false,
    };
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(raw)) {
    return { message: "请稍后重试", detail: "网络请求失败，请检查网络后重试", needsLogin: false };
  }
  return { message: "请稍后重试", detail: raw || undefined, needsLogin: false };
}
