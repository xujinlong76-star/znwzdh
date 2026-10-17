/**
 * 语义化实体关系体系与 SKOS (Simple Knowledge Organization System) 知识组织模型。
 *
 * 核心目标（Phase 3）：
 * 1. 站点关系由原有的单向弱文本声明，提升为具备双向语义推理的知识图谱边（Site Relations Graph）；
 * 2. 类别结构由孤立的单一树状结构，升级为符合 W3C SKOS 规范的概念模型（同义词 altLabels + 跨树关联 relatedCategories）；
 * 3. 前端/API 可按需获取站点的生态图谱、平替雷达以及跨品类相关推荐。
 */

import type { Category, SiteRelation, SiteRelationType } from "./types.ts";

export interface RelationTypeMeta {
  type: SiteRelationType;
  labelZh: string;
  labelEn: string;
  description: string;
  /** 是否为对称关系（如 A 是 B 的替代品 <=> B 也是 A 的替代品） */
  symmetric: boolean;
  /** 反向关系类型（当非对称时，例如 part_of 的反向为 contains） */
  inverse?: string;
}

export const CONTROLLED_RELATION_TYPES: Record<SiteRelationType, RelationTypeMeta> = {
  alternative: {
    type: "alternative",
    labelZh: "平替竞品",
    labelEn: "Alternative",
    description: "功能相当、可相互替代的竞争产品或开源平替方案（如 Figma 与 Penpot）",
    symmetric: true,
  },
  complementary: {
    type: "complementary",
    labelZh: "生态搭配",
    labelEn: "Complementary / Ecosystem",
    description: "协同工作、技术栈强互补的搭配工具（如 Next.js 与 Vercel / Tailwind CSS）",
    symmetric: true,
  },
  ecosystem: {
    type: "ecosystem",
    labelZh: "生态套件",
    labelEn: "Ecosystem",
    description: "同一产品生态、衍生插件或官方集成套件",
    symmetric: true,
  },
  part_of: {
    type: "part_of",
    labelZh: "属于套件",
    labelEn: "Part of",
    description: "子模块或属于大型套件家族（如 Photoshop 属于 Adobe Creative Cloud）",
    symmetric: false,
    inverse: "contains",
  },
  upstream: {
    type: "upstream",
    labelZh: "上游基础",
    labelEn: "Upstream Foundation",
    description: "作为底层支撑技术、依赖或核心运行时（如 Vite 基于 Rollup/esbuild）",
    symmetric: false,
    inverse: "downstream",
  },
  mirror: {
    type: "mirror",
    labelZh: "镜像分支",
    labelEn: "Mirror / Fork",
    description: "官方镜像站点、国内加速源或衍生分支项目",
    symmetric: true,
  },
  related: {
    type: "related",
    labelZh: "相关参考",
    labelEn: "Related",
    description: "同领域具有参考价值的关联资源",
    symmetric: true,
  },
};

/**
 * SKOS 概念数据模型 (W3C SKOS Concept)
 */
export interface SkosConcept {
  "@context": "http://www.w3.org/2004/02/skos/core#";
  "@type": "Concept";
  id: string;
  uri: string;
  /** 规范首选标签 */
  prefLabel: {
    zh: string;
    en?: string;
  };
  /** 同义词 / 备选标签列表 */
  altLabel: string[];
  /** 描述定义 */
  definition?: string;
  /** 更宽泛概念 (父类目) */
  broader?: string | null;
  /** 更狭窄概念 (子类目) */
  narrower: string[];
  /** 相关概念 (跨分类横向关联) */
  related: string[];
  /** 物化路径 */
  notation: string;
}

/**
 * 把 NavHub Category 转换为标准的 SKOS 概念模型
 */
export function categoryToSkosConcept(
  cat: Category,
  allCategories: Category[],
  baseUri: string = "https://navhub.local/categories/"
): SkosConcept {
  const narrower = allCategories
    .filter((c) => c.parentId === cat.id && c.enabled)
    .map((c) => c.id);

  return {
    "@context": "http://www.w3.org/2004/02/skos/core#",
    "@type": "Concept",
    id: cat.id,
    uri: `${baseUri}${cat.id}`,
    prefLabel: {
      zh: cat.title,
      en: cat.titleEn || undefined,
    },
    altLabel: cat.altLabels ?? [],
    definition: cat.description || undefined,
    broader: cat.parentId,
    narrower,
    related: cat.relatedCategories ?? [],
    notation: cat.anchor,
  };
}

/**
 * 规范化关系对象输入
 */
export function normalizeSiteRelation(raw: Partial<SiteRelation>): SiteRelation | null {
  if (!raw.targetTitle || !raw.targetUrl) return null;
  const targetTitle = String(raw.targetTitle).trim();
  const targetUrl = String(raw.targetUrl).trim();
  if (!targetTitle || !targetUrl) return null;

  let relationType: SiteRelationType = "related";
  if (raw.relationType && raw.relationType in CONTROLLED_RELATION_TYPES) {
    relationType = raw.relationType as SiteRelationType;
  }

  return {
    id: raw.id,
    sourceSiteId: raw.sourceSiteId,
    targetSiteId: raw.targetSiteId ?? null,
    targetTitle,
    targetUrl,
    relationType,
    isFreeOrOpenSource: Boolean(raw.isFreeOrOpenSource),
    note: raw.note ? String(raw.note).trim() : undefined,
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 1.0,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
