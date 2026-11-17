/**
 * 搜短剧详情页解析器（soduanju-subject，供 U-D3 追剧提醒闭环用）。
 *
 * 实测结构（2026-11-17 探针，10 个详情页样本，含 6 个 /duanju/ + 4 个 /manju/）：
 *  - 完结徽章：`<span class="font-medium text-primary dark:text-accent-light">已完结</span>`
 *  - 集数行：`<span>红果短剧</span> · <span>全 N 集</span> · <span>YYYY-MM-DD</span> · <span>总时长 …`
 *    （日期是上映日，不是资料更新日；返回 releasedAt 时不冒充更新日）
 *  - 标签：`<a href="/tags?id=…">题材</a>` chip 行（首个 chip 即主 题材）。
 *
 * 诚实规则：
 *  - 只有“全 N 集”一种模式被实测过（10/10 样本均为已完结）；连载中的
 *    “更新至第 N 集 / 已更新 N 集”写法是按同站文案习惯写的备用模式，
 *    尚未观测到真实样本——连载剧出现时若两种模式都匹配不到，返回 null，
 *    不猜集数；
 *  - 同一页出现多个不一致的集数时返回 null（不挑一个当真的）；
 *  - 空壳详情页（如满院亲戚 S7，13KB、无正文无数据）无集数，返回 null。
 */
export interface SoduanjuSubjectInfo {
  /** 最新集数：已完结 = 全集数；连载中 = 已更新集数。 */
  episodes: number;
  /** 是否已完结（以“已完结”徽章为准）。 */
  finished: boolean;
  /** 上映日（YYYY-MM-DD），详情页 meta 行的日期；取不到为 null。 */
  releasedAt: string | null;
}

const FINISHED_BADGE_RE =
  /<span class="font-medium text-primary dark:text-accent-light">已完结<\/span>/;
const FULL_EPISODES_RE = /全\s*(\d+)\s*集/g;
/** 备用模式：连载中写法，尚未观测到真实样本（见模块注释）。 */
const UPDATED_EPISODES_RE = /(?:更新至第|已更新)\s*(\d+)\s*集/g;
const RELEASE_DATE_RE =
  /全\s*\d+\s*集<\/span>\s*<span[^>]*>·<\/span><span>(\d{4}-\d{2}-\d{2})<\/span>/;

/** 取一组正则的全部匹配值；值不一致时返回 null（不挑一个当真的）。 */
function uniqueNumber(re: RegExp, html: string): number | null {
  const values = new Set<number>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) values.add(n);
  }
  if (values.size === 0) return null;
  if (values.size > 1) return null;
  return [...values][0] ?? null;
}

export function parseSoduanjuSubject(html: string): SoduanjuSubjectInfo | null {
  const finished = FINISHED_BADGE_RE.test(html);
  // 已完结优先认“全 N 集”；连载中认“更新至第 N 集 / 已更新 N 集”。
  const episodes =
    uniqueNumber(FULL_EPISODES_RE, html) ?? uniqueNumber(UPDATED_EPISODES_RE, html);
  if (episodes === null) return null;
  const releasedAt = RELEASE_DATE_RE.exec(html)?.[1] ?? null;
  return { episodes, finished, releasedAt };
}
