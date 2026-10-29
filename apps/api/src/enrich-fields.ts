/**
 * 富化结果的字段级取舍。
 *
 * 富化一次会同时产出标题、描述、标签、类目与图标，但它们的可信度并不相同：
 * 模型写的标题可能更通顺，也可能把一个品牌名"改对"成错的名字；页面没有 description
 * 时启发式给的是空值占位；关键词规则抽的标签有时比模型更准。整包写库等于把这些
 * 差异一起吞掉，运营唯一的补救是事后逐项手改。
 *
 * 这里把"要应用哪些字段"变成调用方的显式输入：
 *   - 不传 = 全应用（保持旧行为，老客户端不用改）；
 *   - 传了 = 只应用列出的字段，其余保持调用方/库里的原值；
 *   - `missing` 来源的字段一律跳过并在 skipped 里说明原因——空值不是"最新信息"，
 *     覆盖人工填写只会制造「表单校验不让我提交」这类难查的问题；
 *   - 不认识的字段名进 ignoredFields 而不是静默丢弃：调用方拼错了字段名，能看见。
 */
import type { EnrichmentResult } from "@navhub/ai";

export const ENRICH_FIELD_KEYS = ["title", "description", "category", "tags", "icon"] as const;
export type EnrichFieldKey = (typeof ENRICH_FIELD_KEYS)[number];

export interface EnrichFieldSkip {
  field: EnrichFieldKey;
  reason: string;
}

export interface EnrichSelection {
  /** 可以直接写库的字段（键名与仓储层的入参一致） */
  applied: Partial<Pick<EnrichmentResult, "title" | "description" | "tags" | "iconUrl">> & {
    category?: string | null;
  };
  appliedFields: EnrichFieldKey[];
  skipped: EnrichFieldSkip[];
  ignoredFields: string[];
}

const FIELD_SET = new Set<string>(ENRICH_FIELD_KEYS);

export function selectEnrichmentFields(
  result: EnrichmentResult,
  requested?: readonly string[] | null,
): EnrichSelection {
  const ignoredFields: string[] = [];
  const wanted = requested == null
    ? new Set<EnrichFieldKey>(ENRICH_FIELD_KEYS)
    : (() => {
        const set = new Set<EnrichFieldKey>();
        for (const raw of requested) {
          const key = String(raw).trim();
          if (FIELD_SET.has(key)) set.add(key as EnrichFieldKey);
          else if (key) ignoredFields.push(key);
        }
        return set;
      })();

  const applied: EnrichSelection["applied"] = {};
  const appliedFields: EnrichFieldKey[] = [];
  const skipped: EnrichFieldSkip[] = [];

  const skipIfMissing = (field: EnrichFieldKey): boolean => {
    const meta = result.fields?.[field];
    if (!meta) {
      skipped.push({ field, reason: "这条富化结果没有给出该字段的来源信息" });
      return true;
    }
    if (meta.source === "missing") {
      skipped.push({ field, reason: meta.note ?? "没有可用的值" });
      return true;
    }
    if (Array.isArray(meta.value) && meta.value.length === 0) {
      skipped.push({ field, reason: "值为空" });
      return true;
    }
    return false;
  };

  // 固定顺序遍历：同一份请求在响应里永远得到同样的 appliedFields 顺序，便于断言与审计
  for (const field of ENRICH_FIELD_KEYS) {
    if (!wanted.has(field)) continue;
    if (skipIfMissing(field)) continue;
    const value = result.fields[field].value;
    switch (field) {
      case "title":
        applied.title = String(value);
        break;
      case "description":
        applied.description = String(value);
        break;
      case "tags":
        applied.tags = value as string[];
        break;
      case "icon":
        applied.iconUrl = value as string | null;
        break;
      case "category":
        applied.category = value as string | null;
        if (!applied.category) {
          skipped.push({ field, reason: "没有类目建议" });
          delete applied.category;
          continue;
        }
        break;
    }
    appliedFields.push(field);
  }

  return { applied, appliedFields, skipped, ignoredFields };
}
