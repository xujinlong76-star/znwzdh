/**
 * 合成元数据的开关（章节树 / 字幕 / 测验）。
 *
 * 背景：`generateAISanitizedMetadata()` 并不调用任何模型，它按固定模板产出
 * 4 个章节、4 条字幕、3 道测验（含硬编码代码片段与讲解文案），再以
 * `videoConfig.chapters` / `transcript` 的身份入库，前端呈现为「AI 提炼」。
 * 这属于**伪造元数据**：用户无法分辨哪句是视频真实内容、哪句是模板。
 *
 * 策略：
 *   - 默认 **关闭**：只写真实抓到的字段，没有就留空，前端走「暂无章节」分支；
 *   - 显式设置 `NAVHUB_VIDEO_SYNTHETIC_METADATA=1` 才生成，且写入时必须打
 *     `synthetic: true`，让 UI 能标注「示例大纲（非视频原字幕）」。
 *
 * 为什么不直接删掉生成函数：它仍是演示与离线兜底的有效能力，问题不在「有没有」，
 * 而在「冒充成真实内容」。
 */

/** 读取开关；显式传入 env 便于单测，不依赖全局 process */
export function syntheticMetadataEnabled(env: Record<string, string | undefined> | undefined = defaultEnv()): boolean {
  const raw = (env?.NAVHUB_VIDEO_SYNTHETIC_METADATA ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** 浏览器/边缘运行时可能没有 process，这里做一次安全取值 */
function defaultEnv(): Record<string, string | undefined> | undefined {
  return typeof process !== "undefined" ? process.env : undefined;
}
