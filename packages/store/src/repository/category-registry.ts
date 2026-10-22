/**
 * 权威树播种（方案 §5.2）。
 *
 * registry 是封闭集合，库里的 categories 行只是它的一份可重建投影。所以
 * 「库里缺某个 registry 条目」必须能自愈，而不是把站点扔进未分类——
 * 「表面安装成功、实际归类丢失」正是 962 条回收站站点的起点。
 *
 * 播种行一律 `source = 'registry'`：启动清扫（`plugin:%` 口径）与插件卸载
 * （`plugin:<slug>` 精确）都吃不到它们，这就是安装不再造 `plugin:*` 类目行之后
 * 反噬路径自动消失的原因，不需要额外的显式跳过守卫。
 */
import type { Repository } from "../repository.ts";
import { REGISTRY_BY_SLUG, registryId, type Category, type RegistryCategory } from "@navhub/core";

export interface RegistrySeedCounters {
  created: number;
  patched: number;
}

/** 只补空、不覆盖：人工改过的标题归人管，registry 只填它负责且库里为空的那些字段 */
type RegistryPatch = Partial<Pick<Category, "titleEn" | "icon" | "description" | "altLabels" | "sort" | "slug">>;

/**
 * 两边都必须是「registry 有值、库里没有」才补：
 * 只判空会让每次启动都把 215 个叶子重写一遍（updated_at 全表漂，幂等口径也废了）。
 */
function missingPatch(existing: Category, entry: RegistryCategory): RegistryPatch {
  const patch: RegistryPatch = {};
  if (!existing.titleEn && entry.titleEn) patch.titleEn = entry.titleEn;
  if (!existing.icon && entry.icon) patch.icon = entry.icon;
  if (!existing.description && entry.description) patch.description = entry.description;
  if ((existing.altLabels?.length ?? 0) === 0 && entry.altLabels.length > 0) patch.altLabels = entry.altLabels;
  // 叶子 sort 从 1 起、根从 1–18，0 就是「没排过」
  if (!existing.sort && entry.sort) patch.sort = entry.sort;
  return patch;
}

async function ensureOne(
  repo: Repository,
  slug: string,
  counters: RegistrySeedCounters,
): Promise<Category | null> {
  const entry = REGISTRY_BY_SLUG.get((slug ?? "").trim().toLowerCase());
  if (!entry) return null;

  let parentId: string | null = null;
  if (entry.parentSlug) {
    const parent = await ensureOne(repo, entry.parentSlug, counters);
    if (!parent) return null;
    parentId = parent.id;
  }

  const existing = await repo.getCategoryBySlug(entry.slug);
  if (existing) {
    const patch = missingPatch(existing, entry);
    if (Object.keys(patch).length === 0) return existing;
    await repo.updateCategory(existing.id, patch);
    counters.patched++;
    return await repo.getCategory(existing.id);
  }

  // 同父同名行已存在（重名是 slug 之前的历史形态）：复用它，绝不新建第二个同名行
  const clashRows = parentId
    ? await repo.raw("SELECT id FROM categories WHERE parent_id = ? AND title = ? LIMIT 1", [parentId, entry.title])
    : await repo.raw("SELECT id FROM categories WHERE parent_id IS NULL AND title = ? LIMIT 1", [entry.title]);
  const reused = clashRows[0] ? await repo.getCategory(String(clashRows[0].id)) : null;
  if (reused) {
    const patch = missingPatch(reused, entry);
    // slug 是 URL 资产，必须与 registry 一致；被别人占了就维持原状（P3 迁移负责收敛）
    if (!reused.slug) {
      const taken = await repo.raw("SELECT id FROM categories WHERE slug = ? LIMIT 1", [entry.slug]);
      if (!taken[0]) patch.slug = entry.slug;
    }
    if (Object.keys(patch).length === 0) return reused;
    await repo.updateCategory(reused.id, patch);
    counters.patched++;
    return await repo.getCategory(reused.id);
  }

  try {
    const created = await repo.createCategory({
      id: registryId(entry.slug),
      slug: entry.slug,
      title: entry.title,
      titleEn: entry.titleEn,
      icon: entry.icon,
      description: entry.description,
      parentId,
      sort: entry.sort,
      source: "registry",
      altLabels: entry.altLabels,
    });
    counters.created++;
    return created;
  } catch (err) {
    // 不静默：播种失败会让这批站点落未分类，必须留下一行能看见的日志
    console.error(`[registry] 播种类目「${entry.title}」(${entry.slug}) 失败：`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** 解析并补齐单个 registry 条目（含其父级）；slug 不在权威树里返回 null */
export async function ensureRegistryCategory(repo: Repository, slug: string): Promise<Category | null> {
  return ensureOne(repo, slug, { created: 0, patched: 0 });
}

/** 全量播种（幂等，可重复跑）；REGISTRY_BY_SLUG 的插入顺序就是「先根后叶」，父级天然先建 */
export async function seedCategoryRegistry(
  repo: Repository,
): Promise<{ total: number; created: number; patched: number; failed: string[] }> {
  const counters: RegistrySeedCounters = { created: 0, patched: 0 };
  const failed: string[] = [];
  let total = 0;
  for (const slug of REGISTRY_BY_SLUG.keys()) {
    total++;
    if (!(await ensureOne(repo, slug, counters))) failed.push(slug);
  }
  return { total, created: counters.created, patched: counters.patched, failed };
}
