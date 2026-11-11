/**
 * 数据管理页（/admin/data）的纯逻辑：部署基线与灌入状态判定。
 *
 * 基线数字的出处（都不许凭空改）：
 *   - 站点 298：一级 14 / 二级 46 / 站点 298，实测自
 *     `apps/web-overlay/src/navsphere/content/navigation.json`
 *     （data-management.test.ts 每次跑测试都会重数一遍，漂移即红）。
 *   - 视频 6007：实测自 `apps/web-overlay/src/navsphere/content/videos.json`
 *    （带 bvid / durationSec+title 的条目数，测试每次重数，漂移即红）。
 *     该文件即 `kv:videos` 的灌入源。
 *
 * 判定只回答「灌了没有」，不回答「够不够用」：
 *   - 0 条 = 空（一定是漏了导入）；
 *   - (0, 基线) = 低于基线（可能漏了导入，也可能被删过——页面只提示核对，
 *     不擅自下结论）；
 *   - ≥ 基线 = 已灌入（之后管理员自己加站，超基线是正常的）。
 */

export const BASELINE_SITES = 298
export const BASELINE_VIDEOS = 6007

export type SeedStatus = 'seeded' | 'below-baseline' | 'empty'

export function seedStatus(actual: number, baseline: number): SeedStatus {
  if (!Number.isFinite(actual) || actual <= 0) return 'empty'
  if (actual < baseline) return 'below-baseline'
  return 'seeded'
}
