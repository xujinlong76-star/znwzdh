/**
 * ⚠️ 同步副本：实现源头是 `packages/core/src/search-scope.ts`，本文件与之逐字一致
 * （除本段说明）。一致性由 `test/search-scope-parity.test.ts` 锁定。
 *
 * 为什么要复制：Web 生产镜像（docker/Dockerfile.web）**只拷贝 apps/web-overlay/**，
 * 镜像里没有 packages/core。前端直接 import @navhub/core 会让镜像构建 TS2307；
 * 映射到 packages 源码又会在镜像里指向不存在的路径。仓库既有同类处理
 * （health-state.ts / category-url.ts / shortlink-target.ts）也是「同构复制 + 用例对齐」。
 *
 * 修改顺序：先改 core，再同步到这里，跑 parity 用例。
 */

export interface SearchScope {
  /** 分类 slug 或 id（/search 的 category 参数） */
  category?: string;
  /** 标签（/search 的 tag 参数） */
  tag?: string;
  /** 正交分面（/search 的 f_<key> 参数组） */
  facets?: Record<string, string[]>;
}

/** category 上限：与 /api/search 的 categoryId（z.string().max(64)）同形。 */
export const SEARCH_SCOPE_CATEGORY_MAX_LENGTH = 64;
/** tag 上限：与 /api/search 的 tag（z.string().max(40)）同形。 */
export const SEARCH_SCOPE_TAG_MAX_LENGTH = 40;
/** 列值总长上限：facets 键值再多也不应让一行历史无限膨胀。 */
export const SEARCH_SCOPE_MAX_LENGTH = 2048;

/**
 * facets 清洗上限：与 packages/core/src/facets.ts 的 FACET_MAX_* 同值
 * （KEYS 20 / KEY_LENGTH 50 / VALUE_LENGTH 100 / VALUES_PER_KEY 200）。
 * 数值改动时两处必须同改；core 的 search-scope.test.ts 用同一组矩阵
 * 同时喂 clampFacetFilter 与本函数，锁死两者对「接受/丢弃」的一致性。
 */
const SCOPE_FACET_MAX_KEYS = 20;
const SCOPE_FACET_MAX_KEY_LENGTH = 50;
const SCOPE_FACET_MAX_VALUE_LENGTH = 100;
const SCOPE_FACET_MAX_VALUES_PER_KEY = 200;

function cleanCategory(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().slice(0, SEARCH_SCOPE_CATEGORY_MAX_LENGTH).trim();
  return v || undefined;
}

function cleanTag(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().slice(0, SEARCH_SCOPE_TAG_MAX_LENGTH).trim();
  return v || undefined;
}

/**
 * facets 清洗（clampFacetFilter 的有损版）：非法键/值不报错、整组丢掉，
 * 而不是让一次历史写入失败。键与值都小写、去重；空键/空值跳过。
 */
function cleanFacets(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > SCOPE_FACET_MAX_KEYS) return undefined;
  const facets: Record<string, string[]> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim().toLowerCase();
    if (!key || key.length > SCOPE_FACET_MAX_KEY_LENGTH) return undefined;
    const rawValues = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string"
        ? rawValue.split(",")
        : [rawValue];
    const values: string[] = [];
    for (const v of rawValues) {
      if (typeof v !== "string" && typeof v !== "number") return undefined;
      const normalized = String(v).trim().toLowerCase();
      if (!normalized) continue;
      if (normalized.length > SCOPE_FACET_MAX_VALUE_LENGTH) return undefined;
      values.push(normalized);
    }
    if (values.length === 0 || values.length > SCOPE_FACET_MAX_VALUES_PER_KEY) return undefined;
    facets[key] = [...new Set(values)];
  }
  return Object.keys(facets).length > 0 ? facets : undefined;
}

/**
 * 把作用域编成存入 `search_history.scope` 的字符串；无作用域时返回 ''。
 *
 * 超长只可能来自 facets：丢 facets 再试一次（category/tag 本身已封顶，
 * 不会超长）；仍超长则返回 ''，不让一行历史写失败。
 */
export function encodeSearchScope(scope: SearchScope | null | undefined): string {
  if (!scope) return "";
  const out: Record<string, unknown> = {};
  const category = cleanCategory(scope.category);
  if (category) out.category = category;
  const tag = cleanTag(scope.tag);
  if (tag) out.tag = tag;
  const facets = cleanFacets(scope.facets);
  if (facets) out.facets = facets;
  if (Object.keys(out).length === 0) return "";
  const json = JSON.stringify(out);
  if (json.length <= SEARCH_SCOPE_MAX_LENGTH) return json;
  delete out.facets;
  if (Object.keys(out).length === 0) return "";
  return JSON.stringify(out);
}

/**
 * 解码列值；任何非法输入（非 JSON、非对象、超长、脏 facets）都退回 {}。
 *
 * 永不抛错：读路径（历史页、MCP）面对旧行与脏数据时，坏 scope 只等于
 * 「无作用域」，不能连累整行历史读不出来。
 */
export function decodeSearchScope(raw: unknown): SearchScope {
  if (typeof raw !== "string" || !raw.trim()) return {};
  // 病态输入先挡：JSON.parse 之前不分配超大字符串的解析结果。
  if (raw.length > SEARCH_SCOPE_MAX_LENGTH * 4) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  const out: SearchScope = {};
  const category = cleanCategory(record.category);
  if (category) out.category = category;
  const tag = cleanTag(record.tag);
  if (tag) out.tag = tag;
  const facets = cleanFacets(record.facets);
  if (facets) out.facets = facets;
  return out;
}
