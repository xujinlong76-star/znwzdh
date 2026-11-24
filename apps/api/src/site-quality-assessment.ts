/**
 * 将现有站点元数据与真实巡检记录转换为质量评分证据。
 *
 * 保守原则：
 * - 可访问性至少需要两次非 WAF 阻断巡检；单次失败/403 不做死站结论。
 * - 内容完整度只衡量目录字段，不宣称页面内容本身优质。
 * - 唯一性只证明数据库约束下的精确 URL 唯一，不代表没有同域名近似重复。
 * - 语义相关性、来源真实性、内容新鲜度与安全风险目前没有足够可信数据，保持未知。
 */
import {
  isBotBlockedHealthRecord,
  type Site,
  type SiteQualityAssessments,
} from "@navhub/core";

export interface SiteQualityHealthSample {
  ok: boolean;
  checkedAt: number;
  error: string | null;
}

type SiteQualityInput = Pick<Site, "url" | "title" | "description" | "iconKey" | "categoryId" | "tags">;

function emptyDimensions(): SiteQualityAssessments {
  return {
    accessibility: { score: null, evidence: [] },
    contentCompleteness: { score: null, evidence: [] },
    sourceTrust: { score: null, evidence: ["当前仅记录录入渠道，尚未验证域名所有权或官方身份"] },
    relevance: { score: null, evidence: ["尚未执行页面正文与类目/标签的语义一致性校验"] },
    uniqueness: { score: null, evidence: [] },
    freshness: { score: null, evidence: ["尚无可信的页面内容更新时间证据"] },
    risk: { score: null, evidence: ["尚未接入独立安全情报或恶意内容检测证据"] },
  };
}

export function buildSiteQualityAssessments(
  site: SiteQualityInput,
  healthSamples: readonly SiteQualityHealthSample[],
): SiteQualityAssessments {
  const dimensions = emptyDimensions();
  const fields = [
    { name: "标题", present: typeof site.title === "string" && site.title.trim().length > 0 },
    { name: "描述", present: typeof site.description === "string" && site.description.trim().length > 0 },
    { name: "图标", present: typeof site.iconKey === "string" && site.iconKey.trim().length > 0 },
    { name: "类目", present: typeof site.categoryId === "string" && site.categoryId.trim().length > 0 },
    { name: "标签", present: Array.isArray(site.tags) && site.tags.length > 0 },
  ];
  const completeCount = fields.filter((field) => field.present).length;
  dimensions.contentCompleteness = {
    score: completeCount * 20,
    evidence: fields.map((field) => `${field.name}字段：${field.present ? "已填写" : "缺失"}`),
  };

  // sites.url 的活动行唯一索引只保证精确 URL 不重复；同域名不同路径的近似重复仍需后续治理。
  if (site.url.trim()) {
    dimensions.uniqueness = {
      score: 100,
      evidence: ["站点 URL 受活动站点精确唯一索引约束；未评估同域名不同路径的近似重复"],
    };
  }

  const measurableSamples = healthSamples.filter(
    (sample) => !isBotBlockedHealthRecord(sample.error),
  );
  if (measurableSamples.length >= 2) {
    const successes = measurableSamples.filter((sample) => sample.ok).length;
    dimensions.accessibility = {
      score: Math.round((successes / measurableSamples.length) * 100),
      evidence: [
        `最近 ${measurableSamples.length} 次非 WAF 阻断巡检中，${successes} 次成功`,
        "WAF/机器人拦截记录不计为站点不可访问证据",
      ],
    };
  } else if (healthSamples.length > 0) {
    dimensions.accessibility = {
      score: null,
      evidence: ["有效巡检样本不足两次，暂不对可访问性打分"],
    };
  }

  return dimensions;
}
