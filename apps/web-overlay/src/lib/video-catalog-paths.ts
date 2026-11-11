/**
 * 视频快照与分片的内容路径常量（web 侧唯一事实源）。
 *
 * 与中枢侧 apps/api/src/video-shards.ts 的同名常量必须逐字一致——中枢按这些
 * 路径派生落库，web 按这些路径读；两侧各有钉死常量值的测试，改路径必须
 * 两边一起改。背景见 VIDEOS_ISR_PLAN（路线 b：快照拆分）。
 */

export const VIDEOS_DOC_PATH = "src/navsphere/content/videos.json";
export const VIDEOS_INDEX_PATH = "src/navsphere/content/videos-index.json";
export const VIDEOS_IDMAP_PATH = "src/navsphere/content/videos-idmap.json";

export function videoShardPath(categoryId: string): string {
  return "src/navsphere/content/videos-cat-" + categoryId + ".json";
}
