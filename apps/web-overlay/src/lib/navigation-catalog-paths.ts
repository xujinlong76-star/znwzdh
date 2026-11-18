/**
 * 导航快照与分片的内容路径常量（web 侧唯一事实源）。
 *
 * 与中枢侧 apps/api/src/navigation-shards.ts 的同名常量必须逐字一致——中枢按这些
 * 路径派生落库，web 按这些路径读；两侧各有钉死常量值的测试，改路径必须
 * 两边一起改。背景见 U-36（导航快照按分类分片，主方案 A + 配套 C）。
 */

export const NAVIGATION_DOC_PATH = "src/navsphere/content/navigation.json";
export const NAVIGATION_INDEX_PATH = "src/navsphere/content/navigation-index.json";

export function navigationShardPath(categoryId: string): string {
  return "src/navsphere/content/navigation-cat-" + categoryId + ".json";
}

export function navigationShardPagePath(categoryId: string, page: number): string {
  return "src/navsphere/content/navigation-cat-" + categoryId + "-p" + page + ".json";
}
