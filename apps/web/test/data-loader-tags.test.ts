/**
 * data-loader 的 tags 放行（Batch C 前置修复）。
 *
 * 根因：`processNavigationSubItem` 是字段白名单，navigation.json 条目一直
 * 带着 tags（导航站自己的 taxonomy，与 hub tags 同源），但白名单把它裁掉——
 * 首页 rich 卡片的 #tag 芯片永远拿不到数据，Batch C 的内链化成了无米之炊。
 *
 * 这里锁三件事：
 *   1. tags 原样透传（芯片的数据来源）；
 *   2. 没有 tags 时保持 undefined，不硬造空数组（别处靠 `item.tags?.` 判空）；
 *   3. 其余字段行为不变（videoConfig 类型兜底等既有语义不被顺手破坏）。
 *
 * 注意：只放行 tags。relations / actions / liveMetrics / health 仍然裁掉——
 * 首页管线没有它们的增补来源，放了也是 undefined（预存状态，不在本批范围）。
 */
import { describe, expect, it } from "vitest";

import { processNavigationSubItem } from "@/lib/data-loader";

describe("processNavigationSubItem：tags 放行", () => {
  it("tags 原样透传", () => {
    const out = processNavigationSubItem({
      id: "s1",
      title: "DeepSeek",
      href: "https://chat.deepseek.com",
      enabled: true,
      tags: ["大模型", "中文"],
    });
    expect(out.tags).toEqual(["大模型", "中文"]);
  });

  it("没有 tags 时保持 undefined（不硬造空数组）", () => {
    const out = processNavigationSubItem({
      id: "s2",
      title: "无标签站点",
      href: "https://example.com",
      enabled: true,
    });
    expect(out.tags).toBeUndefined();
  });

  it("其余字段行为不变（videoConfig 类型兜底语义保持）", () => {
    const valid = processNavigationSubItem({
      id: "s3",
      title: "视频站",
      href: "https://example.com",
      enabled: true,
      videoConfig: { type: "youtube", videoId: "v1" },
    });
    expect(valid.videoConfig).toEqual({ type: "youtube", videoId: "v1" });

    // 非法类型回退 bilibili（既有行为，别被 tags 改动顺手破坏）
    const fallback = processNavigationSubItem({
      id: "s4",
      title: "坏类型",
      href: "https://example.com",
      enabled: true,
      videoConfig: { type: "toutube", videoId: "v2" },
    });
    expect(fallback.videoConfig?.type).toBe("bilibili");
  });
});
