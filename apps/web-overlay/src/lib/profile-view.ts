/**
 * 「我的偏好」的三态判定：**取回失败 ≠ 没有画像**。
 *
 * 真实缺陷：页面原本把请求失败和「真的没有画像」渲染成同一句话 ——
 * 中枢连不上时，用户看到的是
 *
 *     「暂无个性化画像。搜索并收藏几个站点后，这里会显示系统推断出的偏好。」
 *
 * 这是一句**站不住的事实陈述**：我们并不知道他有没有画像，我们只是没取到。
 * 用户会照着自己的数据没被记录去理解，而不是「服务暂时不可用」。
 * 同一个判定原则在 /hot、/tags、/collections、/site/[id] 都已经落实过
 * （见 lib/degrade.ts 顶部注释），这里把它补齐：
 *
 *   - 失败 → 说明原因 + 明确「这不代表你没有画像」+ 值得重试时给重试按钮；
 *   - 成功但为空 → 才说「暂无个性化画像」。
 *
 * 判定抽成纯函数，UI 只负责渲染。
 */
import { describeDegrade } from "./degrade";

export type ProfileViewState = "loading" | "degraded" | "empty" | "ready";

export interface ProfileViewInput {
  /** 正在请求（含用户点「重试」后的那一次） */
  loading: boolean;
  /** 上一次请求是否失败；成功后必须清零 */
  failed: boolean;
  /** 是否真的取到了非空画像 */
  hasProfile: boolean;
}

/**
 * 状态优先级：加载中 > 取回失败 > 空 > 有内容。
 *
 * 「加载中」压在「失败」之上是有意的：用户点了重试以后，界面应该回到
 * 「加载中…」，而不是把上一次的红字继续挂在那里。
 */
export function profileViewState(input: ProfileViewInput): ProfileViewState {
  if (input.loading) return "loading";
  if (input.failed) return "degraded";
  return input.hasProfile ? "ready" : "empty";
}

/** 只有**确实取到且为空**时才允许出现的一句话 */
export const PROFILE_EMPTY_MESSAGE =
  "暂无个性化画像。搜索并收藏几个站点后，这里会显示系统推断出的偏好。";

export interface ProfileDegradeNotice {
  /** 面向用户的原因（来自 describeDegrade，已是可读中文） */
  message: string;
  /** 必须说清楚这不是「没有画像」 */
  hint: string;
  /** 401/403 之类的重试没有意义，此时不该给重试按钮 */
  retryable: boolean;
}

/** 取回失败 → 说明文案。绝不包含「暂无 / 没有画像」这类事实陈述。 */
export function profileDegradeNotice(error: unknown): ProfileDegradeNotice {
  const { message, retryable } = describeDegrade(error);
  return {
    message: `未能取回你的个性化画像：${message}`,
    hint: "这不代表你没有画像 —— 只是这次没取到，稍后重试即可。",
    retryable,
  };
}
