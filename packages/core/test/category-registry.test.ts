/**
 * 类目权威树的不变量（2026-10-22 类目树升级方案 §3、§4）。
 *
 * 这棵树是安装/富化/MCP 唯一能解析到的封闭集合，所以它自己必须先立住：
 * 1. **深度硬上限 2**——`sidebar.tsx` 只渲染两级，对标样本里没有任何可达目录用 3 层；
 * 2. **每根 ≤14 叶**——超过 14 就没法在侧栏一屏内扫完（对标中文专业站 13–19 根）；
 * 3. **命名规则自洽**——registry 是「人工/AI 不许造名」的依据，自己违规就是双倍违规；
 * 4. **一个旧标题只能有一个归宿**——`legacyTitles`/`altLabels` 撞车会让标题解析
 *    重新退化成「凭存储顺序挑一个」（就是今天「语言」×3 的形态）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CATEGORY_REGISTRY,
  CATEGORY_REGISTRY_ROOTS,
  REGISTRY_BY_SLUG,
  REGISTRY_BY_TITLE,
  UNCATEGORIZED_SLUG,
  isRegistryLeaf,
  isRegistryRoot,
  registryId,
  registryLeaves,
  registryRoots,
  resolveRegistryEntry,
  resolveRegistryLeaf,
} from "../src/category-registry.ts";
import {
  CATEGORY_SLUG_MAX,
  assertCategoryName,
  categorySlug,
  categoryTitleUnits,
  CATEGORY_TITLE_MAX_UNITS,
} from "../src/taxonomy-rules.ts";

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("结构", () => {
  it("18 个一级根，sort 恰为 1–18", () => {
    expect(CATEGORY_REGISTRY_ROOTS).toHaveLength(18);
    expect(registryRoots()).toHaveLength(18);
    expect(CATEGORY_REGISTRY_ROOTS.map((r) => r.sort)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
  });

  it("每个根 ≤14 叶", () => {
    for (const root of CATEGORY_REGISTRY_ROOTS) {
      expect(root.leaves.length, `${root.title} 叶子数 ${root.leaves.length}`).toBeLessThanOrEqual(14);
      expect(root.leaves.length, `${root.title} 没有叶子，站点无处可挂`).toBeGreaterThan(0);
      expect(registryLeaves(root.slug)).toHaveLength(root.leaves.length);
    }
  });

  it("深度硬上限 2：父级必须是无父的根", () => {
    for (const entry of CATEGORY_REGISTRY) {
      if (!entry.parentSlug) continue;
      const parent = REGISTRY_BY_SLUG.get(entry.parentSlug);
      expect(parent, `孤儿条目 ${entry.slug} 的父级 ${entry.parentSlug} 不存在`).toBeDefined();
      expect(parent!.parentSlug, `${entry.slug} 挂在非根节点上（3 层）`).toBeUndefined();
    }
  });

  it("slug 全局唯一、ASCII 形态、长度受限", () => {
    const seen = new Set<string>();
    for (const entry of CATEGORY_REGISTRY) {
      expect(entry.slug, `${entry.title} 的 slug 形态非法`).toMatch(SLUG_SHAPE);
      expect(entry.slug.length).toBeLessThanOrEqual(CATEGORY_SLUG_MAX);
      expect(seen.has(entry.slug), `slug 重复：${entry.slug}`).toBe(false);
      seen.add(entry.slug);
    }
    expect(seen.size).toBe(CATEGORY_REGISTRY.length);
  });

  it("英文名派生的 slug 不与别的条目撞车（人工/AI 新建走生成器，不能撞上手写 slug）", () => {
    // registry 的 slug 是手写的（对标 PH/G2 的英文 URL），生成器只服务手工/AI 新建。
    // 但两条路径共用同一个全局唯一索引，所以「生成结果落到别人头上」必须不可能。
    for (const entry of CATEGORY_REGISTRY) {
      const derived = categorySlug(entry.titleEn, entry.title);
      const owner = REGISTRY_BY_SLUG.get(derived);
      expect(owner === undefined || owner.slug === entry.slug, `${entry.title} 派生 slug ${derived} 指向 ${owner?.slug}`).toBe(true);
    }
  });

  it("每个名字都过命名规则", () => {
    for (const entry of CATEGORY_REGISTRY) {
      expect(() => assertCategoryName({ title: entry.title, titleEn: entry.titleEn }), `${entry.title} 命名不合规`).not.toThrow();
      expect(categoryTitleUnits(entry.title)).toBeLessThanOrEqual(CATEGORY_TITLE_MAX_UNITS);
    }
  });

  it("同父之下标题不重复", () => {
    for (const root of CATEGORY_REGISTRY_ROOTS) {
      const titles = [root.title, ...root.leaves.map((l) => l.title)];
      expect(new Set(titles).size, `${root.title} 子树内有重名`).toBe(titles.length);
    }
  });

  it("内部 id 稳定且与种子时代的 cat-* 区分", () => {
    expect(registryId("ai-tools")).toBe("reg-ai-tools");
    expect(CATEGORY_REGISTRY.every((c) => !c.slug.startsWith("cat-"))).toBe(true);
  });
});

describe("解析", () => {
  it("一个旧标题只能有一个归宿", () => {
    // REGISTRY_BY_TITLE 在构造期就会为撞车抛错；这里再断一次映射数量。
    const pairs: Array<[string, string]> = [];
    for (const entry of CATEGORY_REGISTRY) {
      for (const name of [entry.title, ...entry.altLabels, ...entry.legacyTitles]) pairs.push([name.trim().toLowerCase(), entry.slug]);
    }
    const byKey = new Map<string, string>();
    for (const [key, slug] of pairs) {
      const prev = byKey.get(key);
      // 自己声明两次（标题既是 title 又出现在 legacyTitles）无害；跨条目撞车才是 bug
      expect(prev === undefined || prev === slug, `「${key}」同时指向 ${prev} 与 ${slug}`).toBe(true);
      byKey.set(key, slug);
    }
    expect(byKey.size).toBe(REGISTRY_BY_TITLE.size);
  });

  it("站点归属只接受叶子，一级根一律拒绝", () => {
    expect(isRegistryRoot("ai-tools")).toBe(true);
    expect(isRegistryLeaf("ai-tools")).toBe(false);
    expect(isRegistryLeaf("chat-assistants")).toBe(true);
    expect(resolveRegistryLeaf("AI 工具")).toBeNull();

    expect(isRegistryLeaf("chat-assistants")).toBe(true);
    expect(resolveRegistryLeaf("大模型对话助手")!.slug).toBe("chat-assistants");
    expect(resolveRegistryLeaf("chat-assistants")!.parentSlug).toBe("ai-tools");
  });

  it("受众式旧根名解析到新根（供 P3 迁移按标题反查）", () => {
    for (const legacy of ["AI工具包", "投资者工具包", "自媒体工具包", "开发者工具包"]) {
      const hit = resolveRegistryEntry(legacy);
      expect(hit, `${legacy} 没有归宿`).toBeDefined();
      expect(hit!.parentSlug, `${legacy} 应落在一级根`).toBeUndefined();
    }
  });

  it("解析不出返回 null（调用方落未分类并产提案）", () => {
    expect(resolveRegistryEntry("")).toBeNull();
    expect(resolveRegistryEntry(null)).toBeNull();
    expect(resolveRegistryEntry("完全不存在的类目名")).toBeNull();
    expect(registryId(UNCATEGORIZED_SLUG)).toBe("reg-uncategorized");
  });

  it("条目总数 = 18 根 + 各根叶子数", () => {
    const leaves = CATEGORY_REGISTRY_ROOTS.reduce((n, r) => n + r.leaves.length, 0);
    expect(CATEGORY_REGISTRY.length).toBe(18 + leaves);
    expect(CATEGORY_REGISTRY.length).toBe(REGISTRY_BY_SLUG.size);
  });
});

describe("前端内置的导航基线必须是权威树的快照", () => {
  // apps/web-overlay/src/navsphere/content/navigation.json 是「中枢没起来 / 空库」时的
  // 内容兜底（github.ts 的 baselineFor）。它在 .gitignore 的 apps/web/src/* 里、
  // 又不像其它自研文件那样进过 overlay，所以 vendor-web 每次升级底座都会把上游
  // 那份「9 根 37 子」盖回来。这条断言把「基线 = 权威树形状」钉住：
  // 一旦被上游文件覆盖，第一个用例就会红。
  const repoRoot = resolve(__dirname, "..", "..", "..");
  const baselinePath = join(repoRoot, "apps", "web-overlay", "src", "navsphere", "content", "navigation.json");

  const readBaseline = () =>
    JSON.parse(readFileSync(baselinePath, "utf8")) as {
      navigationItems: Array<{
        id: string;
        title: string;
        subCategories?: Array<{ id: string; title: string }>;
      }>;
    };

  it("基线文件存在且不是上游演示版（根必须全部解析得到一级根）", () => {
    const data = readBaseline();
    expect(data.navigationItems.length).toBeGreaterThan(0);
    for (const node of data.navigationItems) {
      const root = resolveRegistryEntry(node.title);
      expect(root, `基线里的一级根「${node.title}」不在权威树里（八成是被 vendor 盖回上游版了）`).toBeTruthy();
      expect(root!.parentSlug ?? null, `「${node.title}」在权威树里是叶子，不能当一级根`).toBeNull();
      expect(node.id, `基线根 id 必须是 registryId 派生的稳定 id`).toBe(registryId(root!.slug));
    }
  });

  it("基线里的子类目都解析得到该根下的叶子", () => {
    for (const node of readBaseline().navigationItems) {
      const root = resolveRegistryEntry(node.title)!;
      for (const sub of node.subCategories ?? []) {
        const leaf = resolveRegistryLeaf(sub.title);
        expect(leaf, `基线子类目「${sub.title}」解析不到权威树叶子`).toBeTruthy();
        expect(leaf!.parentSlug, `基线子类目「${sub.title}」挂到了「${root.title}」下，权威树里父级不是它`).toBe(root.slug);
        expect(sub.id).toBe(registryId(leaf!.slug));
      }
    }
  });

  it("基线不含「未分类」：兜底页不该把兜底桶当目录展示", () => {
    const titles = readBaseline().navigationItems.map((n) => n.title);
    expect(titles).not.toContain("未分类");
  });
});
