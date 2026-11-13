/**
 * 智能整理（P1 #6）：按意思建议分组，用户确认后才建夹、才移动。
 *
 * 锁五件事：
 *  1. 确定性：同样输入永远得到同样建议（id、名称、成员、顺序都不漂）；
 *  2. 护栏：单条不成组、候选太少不建议、已有分组的不参与、一次最多 5 组；
 *  3. 诚实：语义通道不可用（neighbors 为 null）时零建议——不拿关键词拼
 *     假分组；组名只取成员真实的共享标签/关键词，绝不编一个名字；
 *  4. 忽略持久化：dismiss 的建议 id 进 localStorage，同一批成员不再
 *     重复出现；存储损坏时不抛错；
 *  5. 接线：收藏页真的挂上了面板（只给建议、用户点采用后才建夹移成员），
 *     面板用中枢语义通道探测近邻、不传身份、不自动跑。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SMART_COLLECTIONS_DISMISSED_KEY,
  SMART_COLLECTIONS_MAX_GROUPS,
  SMART_COLLECTIONS_MIN_CANDIDATES,
  SMART_COLLECTIONS_MIN_GROUP_SIZE,
  SMART_COLLECTIONS_PROBE_LIMIT,
  addDismissedId,
  describeNoSmartCollections,
  describeSmartCollectionsUnavailable,
  describeTooFewForSmartCollections,
  extractSmartKeywords,
  filterDismissedSuggestions,
  parseDismissedIds,
  serializeDismissedIds,
  suggestSmartCollections,
  type SmartCollectionItem,
} from "../src/lib/smart-collections";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

function fav(
  siteId: string,
  title: string,
  extra: Partial<SmartCollectionItem> = {},
): SmartCollectionItem {
  return { siteId, title, ...extra };
}

/** 语义近邻表：a 的近邻是 b，b 的近邻是 a（互为近邻） */
function mutualNeighbors(...pairs: Array<[string, string]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a)?.add(b);
    map.get(b)?.add(a);
  }
  return map;
}

const COOK_A = fav("cook-a", "下厨房", { description: "家常菜谱大全", tags: ["做饭"] });
const COOK_B = fav("cook-b", "美食杰", { description: "菜谱分享", tags: ["做饭"] });
const COOK_C = fav("cook-c", "豆果美食", { description: "菜谱与厨艺", tags: ["做饭"] });
const CODE_A = fav("code-a", "GitHub", { description: "代码托管平台" });
const CODE_B = fav("code-b", "Stack Overflow", { description: "程序员问答社区" });
const LONELY = fav("lonely", "一个人的站点", { description: "与谁都不相近" });

describe("护栏：不成组的情况一律零建议", () => {
  it("语义通道不可用（neighbors 为 null）→ 零建议，不拿关键词拼假分组", () => {
    const items = [COOK_A, COOK_B, COOK_C, CODE_A, CODE_B];
    expect(suggestSmartCollections(items, null)).toEqual([]);
  });

  it("候选不足 3 个 → 零建议（哪怕其中两个语义相近）", () => {
    expect(suggestSmartCollections([COOK_A, COOK_B], mutualNeighbors(["cook-a", "cook-b"]))).toEqual([]);
    expect(suggestSmartCollections([COOK_A], new Map())).toEqual([]);
    expect(suggestSmartCollections([], new Map())).toEqual([]);
    expect(SMART_COLLECTIONS_MIN_CANDIDATES).toBe(3);
  });

  it("单条成不了组：孤立的收藏不进任何分组", () => {
    const items = [COOK_A, COOK_B, COOK_C, LONELY];
    const groups = suggestSmartCollections(items, mutualNeighbors(["cook-a", "cook-b"], ["cook-b", "cook-c"]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.memberIds).not.toContain("lonely");
  });

  it("没有边（语义无近邻、标签无共享）→ 零建议", () => {
    const items = [COOK_A, CODE_A, LONELY];
    expect(suggestSmartCollections(items, new Map())).toEqual([]);
  });

  it("已有分组的收藏不参与（不教用户推翻自己的决定）", () => {
    const filed = fav("cook-a", "下厨房", { description: "家常菜谱大全", tags: ["做饭"], folderId: "f1" });
    // LONELY 只是凑够 3 个候选（已分组的不算候选）：它自己不成组
    const groups = suggestSmartCollections(
      [filed, COOK_B, COOK_C, LONELY],
      mutualNeighbors(["cook-a", "cook-b"], ["cook-b", "cook-c"]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.memberIds).toEqual(["cook-b", "cook-c"]);
  });

  it("最小组 size 与最多组数是常量（2 / 5），不是写死在调用方的魔法数字", () => {
    expect(SMART_COLLECTIONS_MIN_GROUP_SIZE).toBe(2);
    expect(SMART_COLLECTIONS_MAX_GROUPS).toBe(5);
    expect(SMART_COLLECTIONS_PROBE_LIMIT).toBe(30);
  });
});

describe("分组：语义边与标签边都能成组，理由分得清", () => {
  it("互为语义近邻的三条成一组，组名取共享关键词、理由说内容相近", () => {
    const groups = suggestSmartCollections(
      [COOK_A, COOK_B, COOK_C],
      mutualNeighbors(["cook-a", "cook-b"], ["cook-b", "cook-c"]),
    );
    expect(groups).toHaveLength(1);
    const group = groups[0] as NonNullable<(typeof groups)[number]>;
    expect(group.memberIds).toEqual(["cook-a", "cook-b", "cook-c"]);
    // 三条都打了「做饭」标签且覆盖全部成员 → 组名就是用户的标签
    expect(group.name).toBe("做饭");
    expect(group.reasonKind).toBe("mixed");
    expect(group.reason).toContain("共同标签「做饭」");
    expect(group.reason).toContain("内容意思相近");
  });

  it("单向近邻也连边（A 觉得 B 近，B 没回查到 A，仍是一组）", () => {
    const oneWay = new Map<string, Set<string>>([["cook-a", new Set(["cook-b"])]]);
    const groups = suggestSmartCollections([COOK_A, COOK_B, LONELY], oneWay);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.memberIds).toEqual(["cook-a", "cook-b"]);
  });

  it("没有语义近邻时共享标签仍可成组（通道可用但语义没召回的兜底）", () => {
    const groups = suggestSmartCollections([COOK_A, COOK_B, LONELY], new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("做饭");
    expect(groups[0]?.reasonKind).toBe("tag");
    expect(groups[0]?.reason).toBe("共同标签「做饭」");
    expect(groups[0]?.reason).not.toContain("内容意思相近");
  });

  it("无共享标签时组名取共享关键词，理由说共同关键词", () => {
    // 共享词是分隔符隔开的完整词串「学做菜」（中文连续词串按原样取，不做分词猜测）
    const a = fav("k-a", "学做菜 - 入门", { description: "新手第一课" });
    const b = fav("k-b", "学做菜 - 进阶", { description: "大厨带练" });
    const c = fav("k-c", "无关站点", { description: "天气查询" });
    const groups = suggestSmartCollections([a, b, c], mutualNeighbors(["k-a", "k-b"]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("学做菜");
    expect(groups[0]?.reason).toContain("共同关键词「学做菜」");
    expect(groups[0]?.reason).toContain("内容意思相近");
  });

  it("组名绝不凭空编：名称一定是成员的标签或真实文本里的词", () => {
    const a = fav("n-a", "量子计算入门", { description: "量子比特科普" });
    const b = fav("n-b", "量子计算进阶", { description: "量子算法导论" });
    const c = fav("n-c", " unrelated", { description: "天气预报" });
    const groups = suggestSmartCollections([a, b, c], mutualNeighbors(["n-a", "n-b"]));
    expect(groups).toHaveLength(1);
    const name = groups[0]?.name ?? "";
    const memberText = [a, b].map((m) => [m.title, m.description ?? "", ...(m.tags ?? [])].join(" ")).join(" ");
    expect(memberText).toContain(name);
  });

  it("连一个关键词都没有的组直接丢弃（空标题、无标签、无描述不配拥有名字）", () => {
    const a = fav("e-a", "", {});
    const b = fav("e-b", "", {});
    const c = fav("e-c", "", {});
    expect(suggestSmartCollections([a, b, c], mutualNeighbors(["e-a", "e-b"]))).toEqual([]);
  });
});

describe("确定性与上限：同样输入同样输出，最多 5 组、大的在前", () => {
  it("两次调用结果完全相同（id、名称、成员、顺序）", () => {
    const items = [COOK_A, COOK_B, COOK_C, CODE_A, CODE_B, LONELY];
    const neighbors = mutualNeighbors(["cook-a", "cook-b"], ["cook-b", "cook-c"], ["code-a", "code-b"]);
    const first = suggestSmartCollections(items, neighbors);
    const second = suggestSmartCollections(items, neighbors);
    expect(second).toEqual(first);
    // 成员顺序与输入顺序无关：打乱输入再算，id 与成员集合不变
    const shuffled = suggestSmartCollections([CODE_B, LONELY, COOK_C, CODE_A, COOK_B, COOK_A], neighbors);
    expect(shuffled.map((g) => g.id).sort()).toEqual(first.map((g) => g.id).sort());
  });

  it("6 个互不相干的标签组 → 只取前 5 组，且按成员数降序", () => {
    const items: SmartCollectionItem[] = [];
    const neighbors = new Map<string, Set<string>>();
    for (let g = 0; g < 6; g++) {
      const size = g === 0 ? 4 : 2;
      for (let i = 0; i < size; i++) {
        items.push(fav(`g${g}-i${i}`, `组${g}站点${i}`, { tags: [`标签${g}`] }));
      }
      items.push(fav(`g${g}-filler`, `填充${g}`, { description: "填充" }));
    }
    const groups = suggestSmartCollections(items, neighbors);
    expect(groups).toHaveLength(5);
    expect(groups[0]?.memberIds).toHaveLength(4);
    expect(groups.slice(1).every((g) => g.memberIds.length === 2)).toBe(true);
  });

  it("组名超过 30 字时截断到收藏夹上限（与文件夹同口径）", () => {
    const longTag = "很长".repeat(20) + "的标签名";
    expect(longTag.length).toBeGreaterThan(30);
    const a = fav("l-a", "甲", { tags: [longTag] });
    const b = fav("l-b", "乙", { tags: [longTag] });
    const c = fav("l-c", "丙", { description: "其它" });
    const groups = suggestSmartCollections([a, b, c], new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name.length).toBeLessThanOrEqual(30);
  });
});

describe("extractSmartKeywords：只取原样出现过的词串", () => {
  it("中文取 2 字以上词串，拉丁取词，通用词过滤掉", () => {
    expect(extractSmartKeywords("下厨房 官网 家常菜谱大全")).toEqual(["下厨房", "家常菜谱大全"]);
    expect(extractSmartKeywords("GitHub 代码托管平台")).toEqual(["github", "代码托管平台"]);
    expect(extractSmartKeywords("")).toEqual([]);
  });
});

describe("忽略持久化：dismiss 的建议不再出现，存储坏了也不抛", () => {
  it("parse / serialize 往返一致；损坏 / 非数组返回空数组", () => {
    expect(parseDismissedIds(serializeDismissedIds(["smart-abc", "smart-def"]))).toEqual([
      "smart-abc",
      "smart-def",
    ]);
    expect(parseDismissedIds(null)).toEqual([]);
    expect(parseDismissedIds("不是 json")).toEqual([]);
    expect(parseDismissedIds(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseDismissedIds(JSON.stringify(["ok", 42, null, ""]))).toEqual(["ok"]);
  });

  it("addDismissedId 去重；filterDismissedSuggestions 只去掉已忽略的", () => {
    expect(addDismissedId(["a"], "a")).toEqual(["a"]);
    expect(addDismissedId(["a"], "b")).toEqual(["a", "b"]);
    const groups = [
      { id: "g1", name: "甲" },
      { id: "g2", name: "乙" },
    ];
    expect(filterDismissedSuggestions(groups, ["g1"]).map((g) => g.id)).toEqual(["g2"]);
    expect(filterDismissedSuggestions(groups, []).map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("已忽略的建议 id 存储键与收藏本体、收藏夹键都分开", () => {
    expect(SMART_COLLECTIONS_DISMISSED_KEY).toBe("navhub.favorites.smart-collections.dismissed.v1");
    expect(SMART_COLLECTIONS_DISMISSED_KEY).not.toBe("navhub.favorites.folders.v1");
  });
});

describe("空态文案：如实说原因，不把没建议说成没内容", () => {
  it("三条空态文案各有各的说法", () => {
    expect(describeTooFewForSmartCollections(2)).toContain("2 个");
    expect(describeTooFewForSmartCollections(2)).toContain("3 个以上");
    expect(describeSmartCollectionsUnavailable()).toContain("语义服务暂不可用");
    expect(describeSmartCollectionsUnavailable()).toContain("稍后再试");
    expect(describeNoSmartCollections()).toContain("没有找到");
    expect(describeNoSmartCollections()).toContain("标签");
  });
});

describe("接线守卫：收藏页真的挂上了智能整理，且只在用户确认后才应用", () => {
  it("收藏页挂载面板并传入收藏、建夹、移动三个接线", () => {
    const page = overlaySource("src/app/favorites/page.tsx");
    expect(page).toContain("SmartCollectionsPanel");
    expect(page).toContain("import { SmartCollectionsPanel }");
    expect(page).toContain("items={favorites.items}");
    expect(page).toContain("onCreateFolder={createFolderDirectly}");
    expect(page).toContain("onMoveToFolder={assignFolder}");
    // 面板只在有收藏时出现；建夹走既有夹子 API（同名复用），移动走既有 assignFolder
    expect(page).toContain("favorites.items.length > 0 && (");
  });

  it("面板是用户点击触发分析：入口按钮、采用、忽略、重试都在", () => {
    const panel = overlaySource("src/components/smart-collections-panel.tsx");
    expect(panel).toContain("开始智能整理");
    expect(panel).toContain("重新分析");
    expect(panel).toContain("采用此分组");
    expect(panel).toContain("忽略");
    expect(panel).toContain("重试");
    expect(panel).toContain("onClick={() => void runAnalysis()}");
    // 分析只在点击时跑：没有 mount 即自动分析的 effect
    expect(panel).not.toMatch(/useEffect\(\(\) => \{\s*void runAnalysis/);
  });

  it("面板用中枢语义通道探测近邻：mode=semantic、不传身份、复用 semanticSiteScores", () => {
    const panel = overlaySource("src/components/smart-collections-panel.tsx");
    expect(panel).toContain("searchSites(");
    expect(panel).toContain("mode: 'semantic'");
    expect(panel).toContain("semanticSiteScores(");
    expect(panel).toContain("MEANING_SEARCH_POOL_LIMIT");
    expect(panel).not.toContain("identity");
  });

  it("面板只在用户确认后才建夹移成员：建夹与移动只活在采用处理器里", () => {
    const panel = overlaySource("src/components/smart-collections-panel.tsx");
    expect(panel).toContain("async function applyGroup");
    expect(panel).toContain("await onCreateFolder(group.name)");
    expect(panel).toContain("await onMoveToFolder(siteId, folderId)");
    // 忽略持久化进独立 localStorage 键
    expect(panel).toContain("SMART_COLLECTIONS_DISMISSED_KEY");
    expect(panel).toContain("已忽略全部建议");
    expect(panel).toContain("重新查看已忽略的建议");
  });

  it("面板的诚实空态：太少 / 暂不可用 / 无建议三句话都在", () => {
    const panel = overlaySource("src/components/smart-collections-panel.tsx");
    expect(panel).toContain("describeTooFewForSmartCollections");
    expect(panel).toContain("describeSmartCollectionsUnavailable");
    expect(panel).toContain("describeNoSmartCollections");
    expect(panel).toContain("全部收藏都已有分组");
  });
});
