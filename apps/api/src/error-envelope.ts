/**
 * 统一错误包络（M13）。
 *
 * 此前全站错误有三种写法在混用：
 *   - 路由 inline：`{ ok: false, error: "参数无效" }`（error 是人话，无 code）；
 *   - routes/shared.ts 助手：`{ error: "参数无效", detail? }`（无 ok、无 code）；
 *   - server.ts 全局兜底：`{ error: <人话>, code, message, requestId, retryable }`
 *     与 404 处理器 `{ error: "NOT_FOUND", message, requestId }`（error 一处是
 *     人话、一处是 code）。
 * 客户端无法用同一规则分支判断错误，只能按字符串匹配人话——一改文案就全断。
 *
 * 统一后的包络（所有新迁移的路由 + 两个全局处理器都用它）：
 *   `{ ok: false, error: <CODE>, code: <CODE>, message: <人话>, requestId?, details?, retryable? }`
 *   - `error` 与 `code` 是同一份机器码（双写只为兼容：404 处理器与部分测试
 *     读 `error`，全局兜底读 `code`；两者不再各说各话）；
 *   - `message` 是给人看的文案，不做分支判断；
 *   - `requestId` 只有服务端能给时才出现（路由层没有 req.id 概念时省略）；
 *   - `retryable` 只在全局兜底里按状态码推导（5xx / 429 为 true）。
 *
 * 迁移范围：本文件落地的同时，server.ts 两个全局处理器与 keyset 改造涉及的
 * 列表路由（sites / favorites / categories / jobs / videos / audit /
 * taxonomy / me 的 visits 与 notifications）改用它；其余路由仍用旧形状，
 * 待 routes/shared.ts 的 notFound/badRequest/conflict/forbidden/
 * unauthorized 助手整体迁移时再一并切过去（那次改动会动全站测试断言，
 * 不宜混在这轮数据层改动里）。
 */
import type { FastifyReply } from "fastify";

export const ERROR_CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

/** 状态码 → 默认机器码；未知状态一律 INTERNAL_ERROR。 */
export function errorCodeForStatus(status: number): string {
  return ERROR_CODE_BY_STATUS[status] ?? "INTERNAL_ERROR";
}

/** 只有 5xx 与 429 值得客户端重试（与 error-contract.test.ts 的约定一致）。 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export interface ErrorEnvelope {
  ok: false;
  /** 机器码，与 code 相同。 */
  error: string;
  /** 机器码，与 error 相同。 */
  code: string;
  /** 给人看的文案，不做分支判断。 */
  message: string;
  requestId?: string;
  /** 框架/校验给出的结构化明细（如 zod issues）；没有时省略。 */
  details?: unknown;
  /** 是否值得重试；路由层不知道时省略。 */
  retryable?: boolean;
}

export function buildErrorEnvelope(input: {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  requestId?: string;
  retryable?: boolean;
}): ErrorEnvelope {
  const code = input.code ?? errorCodeForStatus(input.status);
  return {
    ok: false,
    error: code,
    code,
    message: input.message,
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
  };
}

/**
 * 路由层回错误：设状态码并返回包络。
 * `code` 缺省时按状态码取默认码（见 ERROR_CODE_BY_STATUS）。
 */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string | undefined,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  reply.code(status);
  return buildErrorEnvelope({ status, code, message, details });
}
