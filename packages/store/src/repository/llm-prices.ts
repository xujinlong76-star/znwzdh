/**
 * 分模型单价簿（¥/1K tokens，输入/输出分开）。
 *
 * 与 `llm_usage` 的关系：写入调用记录时把当时命中的单价**快照**到行上，
 * 之后改价只影响新调用——历史成本必须按当时的价格解释，否则每次调价
 * 都会把过去几个月的账悄悄重写一遍。
 */
import type { Repository } from "../repository.ts";

export interface LlmModelPrice {
  model: string;
  promptPer1kRmb: number;
  completionPer1kRmb: number;
  updatedAt: number;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function rowToPrice(row: Record<string, unknown>): LlmModelPrice {
  return {
    model: String(row.model ?? ""),
    promptPer1kRmb: num(row.prompt_per_1k_rmb),
    completionPer1kRmb: num(row.completion_per_1k_rmb),
    updatedAt: num(row.updated_at),
  };
}

export async function listLlmModelPrices(repo: Repository): Promise<LlmModelPrice[]> {
  const rows = await repo.raw(
    "SELECT model, prompt_per_1k_rmb, completion_per_1k_rmb, updated_at FROM llm_model_prices ORDER BY model",
  );
  return rows.map(rowToPrice);
}

export async function getLlmModelPrice(repo: Repository, model: string): Promise<LlmModelPrice | null> {
  const key = String(model ?? "").trim();
  if (!key) return null;
  const rows = await repo.raw(
    "SELECT model, prompt_per_1k_rmb, completion_per_1k_rmb, updated_at FROM llm_model_prices WHERE model = ?",
    [key],
  );
  const row = rows[0];
  return row ? rowToPrice(row) : null;
}

/**
 * 整簿替换：以 `items` 为完整清单，缺席的模型被删除。
 *
 * 为什么不是逐条 upsert + 单独删除端点：单价簿是一份小型运维配置，
 * 「保存即全量」的语义让并发/半保存状态最少；删除退出定价的模型与
 * 修改价格在同一个动作里完成，不会出现「旧模型残留继续参与折算」。
 */
export async function replaceLlmModelPrices(
  repo: Repository,
  items: Array<{ model: string; promptPer1kRmb: number; completionPer1kRmb: number }>,
): Promise<number> {
  const byModel = new Map<string, { promptPer1kRmb: number; completionPer1kRmb: number }>();
  for (const item of items) {
    const model = String(item.model ?? "").trim().slice(0, 120);
    if (!model) continue;
    const prompt = num(item.promptPer1kRmb, NaN);
    const completion = num(item.completionPer1kRmb, NaN);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
    byModel.set(model, {
      promptPer1kRmb: Math.max(0, prompt),
      completionPer1kRmb: Math.max(0, completion),
    });
  }

  const models = [...byModel.keys()];
  if (models.length === 0) {
    await repo.run("DELETE FROM llm_model_prices");
    return 0;
  }

  const placeholders = models.map(() => "?").join(",");
  await repo.run(`DELETE FROM llm_model_prices WHERE model NOT IN (${placeholders})`, models);

  const now = Date.now();
  for (const [model, price] of byModel) {
    await repo.run(
      "INSERT INTO llm_model_prices (model, prompt_per_1k_rmb, completion_per_1k_rmb, updated_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(model) DO UPDATE SET prompt_per_1k_rmb = EXCLUDED.prompt_per_1k_rmb, " +
        "completion_per_1k_rmb = EXCLUDED.completion_per_1k_rmb, updated_at = EXCLUDED.updated_at",
      [model, price.promptPer1kRmb, price.completionPer1kRmb, now],
    );
  }
  return byModel.size;
}
