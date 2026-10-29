/**
 * 调用时单价解析（成本快照的唯一来源）。
 *
 * 口径（优先级从高到低）：
 *   1. 分模型单价簿 `llm_model_prices`：输入/输出分别定价，命中即用；
 *   2. 旧版单一价（管理端 costPer1kTokensRmb > 环境变量）：同一费率套输入输出，
 *      只为兼容既有部署，不区分方向的报价本身就是近似值；
 *   3. 都没有 → null，成本列写 NULL。未知成本绝不能落成 0。
 *
 * 结果会在写入 `llm_usage` 时快照到行上：之后调价只影响新调用，
 * 历史成本按当时单价解释。
 */
import type { AppContext } from "./context.ts";
import { getLlmCostUnitPriceRmb } from "./llm-config.ts";
import type { LlmUsagePrice } from "@navhub/store";

/**
 * 解析某个模型当前的单价。
 *
 * 读取失败按「没有单价」处理：成本是观测附属品，绝不能反噬一次已经成功的模型调用。
 */
export async function resolveLlmPrice(
  ctx: AppContext,
  model: string | null | undefined,
): Promise<LlmUsagePrice | null> {
  try {
    const key = String(model ?? "").trim();
    if (key) {
      const row = await ctx.repo.getLlmModelPrice(key);
      if (row) {
        return {
          promptPer1kRmb: row.promptPer1kRmb,
          completionPer1kRmb: row.completionPer1kRmb,
          source: "book",
        };
      }
    }
    const legacy = await getLlmCostUnitPriceRmb(ctx);
    if (legacy > 0) {
      return { promptPer1kRmb: legacy, completionPer1kRmb: legacy, source: "legacy" };
    }
    return null;
  } catch (err) {
    console.warn("[navhub] 单价解析失败（本次调用成本按未采集处理）:", err);
    return null;
  }
}
