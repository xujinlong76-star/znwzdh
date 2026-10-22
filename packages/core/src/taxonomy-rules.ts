/**
 * 类目命名与挂载规则（类目树升级方案 §4）。
 *
 * 为什么把这些规则放进 core：同一棵树同时被四个写入口喂数据
 * （HTTP 管理接口、AI 富化、MCP、插件市场安装），规则只写在任何一处
 * 都会立刻漂移。这里给出**纯函数**，调用方决定是拒绝（人工/AI 路径）
 * 还是记提案（市场路径）。
 *
 * 明确不做的两件事：
 * 1. 不ban「海外/国际」——它们在新树里是主题（`海外流媒体`、`海外与远程`），
 *    不是语言分面。真正被滥用的语言轴词是 `中文/英文/华文/国产/外语`，
 *    按它们收紧可以覆盖全部历史 offender（`英文与海外媒体`、
 *    `港台与海外华文媒体`、`国产化信创与私有云`）而不伤及主题名。
 * 2. 不给市场安装路径硬拒——29 个站点包声明 536 个类目标题，
 *    里面确有违规名；对它们产提案比让它们安装失败更可用
 *    （PLUGIN_LIMITS.maxCategoryTitle=60 因此保持不动）。
 */

import { pinyinTraits } from "./pinyin.ts";

/** 中文类目标题的视觉宽度上限（1 个汉字 = 1，1 个半角字符 = 0.5） */
export const CATEGORY_TITLE_MAX_UNITS = 7;
/** title_en 的 ASCII 长度上限 */
export const CATEGORY_TITLE_EN_MAX = 40;
/** slug 长度上限（URL 里可见，留足余量再截断） */
export const CATEGORY_SLUG_MAX = 60;

export interface BannedAxis {
  /** 轴名：facets 里承接它的键，或 "freshness"/"audience" 这类无 facet 对应的排序语义 */
  axis: "pricing" | "platform" | "language" | "freshness" | "audience";
  /** 违规词（大小写不敏感） */
  tokens: string[];
  /** 该怎么收：改挂哪个分面或标签 */
  hint: string;
}

/**
 * 「不该出现在类目名里」的五条轴。
 *
 * 每条都在仓库里有实证：把轴当类目写进树，结果是同一需求长出
 * 3~18 个近义根（`图标与插画素材`/`图标字体与素材`/`图标素材`）。
 */
export const BANNED_CATEGORY_AXES: BannedAxis[] = [
  { axis: "pricing", tokens: ["免费", "付费", "订阅", "试用", "开源"], hint: "改用 facets.pricing（open_source / freemium / paid）" },
  { axis: "platform", tokens: ["windows", "macos", "linux", "ios", "android", "小程序", "网页版", "客户端"], hint: "改用 facets.platform" },
  { axis: "language", tokens: ["中文", "英文", "华文", "国产", "外语"], hint: "改用 facets.language（受众本身就是语言时，走合集）" },
  { axis: "freshness", tokens: ["热门", "最新", "榜单", "热搜", "精选", "常用"], hint: "时效不是类目：用 /hot 排序或「编辑精选」合集" },
  { axis: "audience", tokens: ["工具包", "小白", "从业者", "爱好者", "玩家"], hint: "受众不是类目：改用 facets.scene（dev / design / ai / content / productivity / ops）" },
];

/** 半角字符（字母数字标点空格）算 0.5 个视觉单位，其余（汉字、全角标点）算 1 */
export function categoryTitleUnits(title: string): number {
  let units = 0;
  for (const ch of (title ?? "").trim()) {
    units += ch.charCodeAt(0) < 0x2100 ? 0.5 : 1;
  }
  return Math.round(units * 10) / 10;
}

/** 命中了哪条禁用轴；没命中返回 null */
export function categoryBannedAxisHit(title: string): { axis: BannedAxis; token: string } | null {
  const hay = (title ?? "").trim().toLowerCase();
  if (!hay) return null;
  for (const axis of BANNED_CATEGORY_AXES) {
    for (const token of axis.tokens) {
      if (hay.includes(token.toLowerCase())) return { axis, token };
    }
  }
  return null;
}

export interface CategoryNameViolation {
  rule: "empty" | "too_long" | "en_too_long" | "banned_axis";
  message: string;
}

/** 只检不抛：调用方要「记提案」时用它，要「拒绝」时用 assertCategoryName */
export function categoryNameViolations(input: { title: string; titleEn?: string | null }): CategoryNameViolation[] {
  const out: CategoryNameViolation[] = [];
  const title = (input.title ?? "").trim();
  if (!title) {
    out.push({ rule: "empty", message: "类目标题不能为空" });
    return out;
  }
  const units = categoryTitleUnits(title);
  if (units > CATEGORY_TITLE_MAX_UNITS) {
    out.push({
      rule: "too_long",
      message: `类目标题「${title}」视觉宽度 ${units}，超过 ${CATEGORY_TITLE_MAX_UNITS} 个单位（侧栏/面包屑/锚文本会溢出）`,
    });
  }
  const en = (input.titleEn ?? "").trim();
  if (en && en.length > CATEGORY_TITLE_EN_MAX) {
    out.push({ rule: "en_too_long", message: `英文名「${en}」长 ${en.length} 字符，超过 ${CATEGORY_TITLE_EN_MAX}` });
  }
  const hit = categoryBannedAxisHit(title);
  if (hit) {
    out.push({
      rule: "banned_axis",
      message: `类目标题「${title}」把「${hit.token}」这条${hit.axis.axis}轴写进了树：${hit.axis.hint}`,
    });
  }
  return out;
}

/** 人工 / AI / registry 路径用：违规直接抛，错误信息带可执行的建议 */
export function assertCategoryName(input: { title: string; titleEn?: string | null }): void {
  const violations = categoryNameViolations(input);
  if (violations.length > 0) {
    throw new Error("类目命名不合规：" + violations.map((v) => v.message).join("；"));
  }
}

/**
 * 站点只能挂叶子（对标 G2 的硬规则：父类目只作导航）。
 *
 * 挂在根上会让「根页站点数」和「叶子页站点数」两套口径永远对不齐，
 * 也是「未分类」吞掉一半站点的起点。
 */
export function assertAttachableLeaf(category: { id: string; title?: string; parentId?: string | null } | null | undefined): void {
  if (!category) throw new Error("目标类目不存在，不能作为站点归属");
  if (!category.parentId) {
    throw new Error(`类目「${category.title ?? category.id}」是一级根，只能作导航；站点要挂在它的子类目上`);
  }
}

/** ASCII slug 化（与存储层 slugify 分开：那边锁死了中文原样保留的行为） */
function asciiSlug(input: string): string {
  return (input ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CATEGORY_SLUG_MAX)
    .replace(/-+$/g, "");
}

/**
 * 生成类目 slug：优先英文名（纯 ASCII），否则用拼音全拼。
 *
 * 拼音兜底只在「手工/AI 新建且没填英文名」时才用得到——registry 的
 * 18×136 个 slug 一律手写英文（对标 PH/G2），中文标题只出现在
 * `<title>` 与面包屑里。同父冲突由调用方补 `-2`（需要查兄弟节点，
 * 纯函数给不了）。
 */
export function categorySlug(titleEn: string | null | undefined, title: string): string {
  const fromEn = asciiSlug(titleEn ?? "");
  if (fromEn) return fromEn;
  const fromTitle = asciiSlug(title);
  if (fromTitle) return fromTitle;
  return asciiSlug(pinyinTraits(title).full) || "category";
}

/** UUID 形态判定：`/category/{uuid}` 的老链接要 301 到 slug */
export function looksLikeUuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((input ?? "").trim());
}
