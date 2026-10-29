/**
 * Copilot 流式帧的唯一事实源（服务端写入与浏览器解析共用）。
 *
 * 为什么需要独立模块：帧协议只有三种类型，但过去两侧都靠字符串字面量硬抄。
 * 中枢新增第四种帧而客户端不认时，表现不是报错，而是**内容静默丢失**
 * （草稿少一段、终稿永远等不到）。这里把类型白名单与运行时解析收敛到一处：
 * 服务端 `write()` 受 `CopilotFrame` 约束，客户端解析也必须经过 `parseCopilotFrame`。
 *
 * 为什么放在 core 而不是某个 app：解析逻辑要在 API 与浏览器两侧共用。
 * `apps/web` 是独立安装的 vendored 底座（不依赖 @navhub/*），因此
 * `apps/web-overlay/src/lib/copilot-frame.ts` 保留一份由
 * `scripts/sync-core-mirrors.mjs` 生成的逐字节镜像，由 core-mirror 闸门守住。
 *
 * 运行时校验刻意宽松：`done` 承载可变字段（引用、额度、建议、降级文案），
 * 只强制 `type` 与会直接影响渲染的两个字段（`reply` / `ok`），
 * 避免「多一个字段就整帧丢弃」；未知字段原样保留。
 */

export const COPILOT_FRAME_TYPES = ["delta", "reasoning", "done"] as const;

export type CopilotFrameType = (typeof COPILOT_FRAME_TYPES)[number];

/** 正文增量 */
export interface CopilotDeltaFrame {
  type: "delta";
  text: string;
}

/** 思维链增量（与正文分开，前端单独渲染） */
export interface CopilotReasoningFrame {
  type: "reasoning";
  text: string;
}

/**
 * 权威终稿。字段随产品演进（reply / ok / error / code / model /
 * reasoningContent / citations / retrieval / suggestions / quota / degraded…），
 * 这里只约束类型，不逐字段建模。
 */
export interface CopilotDoneFrame {
  type: "done";
  [key: string]: unknown;
}

export type CopilotFrame = CopilotDeltaFrame | CopilotReasoningFrame | CopilotDoneFrame;

export function isCopilotFrameType(value: unknown): value is CopilotFrameType {
  return typeof value === "string" && (COPILOT_FRAME_TYPES as readonly string[]).includes(value);
}

/**
 * 解析一帧的 JSON 载荷（不含 SSE 的 `data:` 前缀）。
 *
 * 返回 null 表示「这不是可用帧」：坏 JSON、非对象、未知 `type`、
 * `delta`/`reasoning` 缺文本都会落到这里。调用方按「丢进度、不炸流」处理；
 * 安全性来自另一条不变量——没有合法 `done` 就按失败收口，草稿一律作废。
 */
export function parseCopilotFrame(raw: string): CopilotFrame | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!isCopilotFrameType(record.type)) return null;

  if (record.type === "delta" || record.type === "reasoning") {
    if (typeof record.text !== "string" || record.text.length === 0) return null;
    return { type: record.type, text: record.text };
  }

  // done：只拦会让抽屉渲染崩溃的形状；未知扩展字段原样保留
  if (record.reply !== undefined && typeof record.reply !== "string") return null;
  if (record.ok !== undefined && typeof record.ok !== "boolean") return null;
  return record as CopilotDoneFrame;
}
