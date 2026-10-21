/**
 * 列表页的降级可见性。
 *
 * 与详情页（degrade.test.ts）同一类问题、同一个信号：中枢不可用时这些页面
 * 的“空”和“真的没有内容”长得一模一样：
 *   - /hot         → 「暂无热度数据」（榜单页的全部内容就是数据，等于说本站没数据）
 *   - /tags        → 「共聚合 0 个标签」+「暂未找到与 “” 匹配的技术标签」（后者更离谱：
 *                   搜索框是空的，却说“没有匹配”）
 *   - /collections → 「暂无精选专题，站长正在策划中」（把故障甩锅给站长）
 *   - /tags/[slug] → 有降级横幅，但没有重试入口
 *
 * 这里用源码守卫锁住修复：必须接上 onDegraded、渲染统一提示条与重试，
 * 且空状态文案要区分「取不回来」与「本来就没有」。
 *
 * Batch B（RSC 化）后 /tags、/tags/[slug] 重写成「服务端壳 + 客户端岛」：
 * 行为（降级回调、提示条、重试、空状态文案）随岛迁到
 * components/tag-cloud.tsx 与 components/tag-results-board.tsx，本文件的
 * 行为守卫因此指向岛文件；另配「壳必须挂岛」断言——壳空挂等于岛不上
 * SSR，标签内链 0 条进 HTML 的老问题就回来了，比任何文案回归都严重。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const hot = overlayFile("src/app/hot/page.tsx");
const collections = overlayFile("src/app/collections/page.tsx");
const tags = overlayFile("src/components/tag-cloud.tsx");
const tagDetail = overlayFile("src/components/tag-results-board.tsx");
const tagsPage = overlayFile("src/app/tags/page.tsx");
const tagDetailPage = overlayFile("src/app/tags/[slug]/page.tsx");

describe("/hot：榜单取不回来时要说出来", () => {
  it("把降级原因接回页面（两个榜单都要挂回调）", () => {
    expect(hot).toContain("describeDegrade(error, '榜单数据')");
    expect(hot).toContain("fetchTrending(30, onDegraded)");
    expect(hot).toContain("fetchNewSites(30, onDegraded)");
    expect(hot).not.toMatch(/fetchTrending\(30\)/);
  });

  it("渲染统一提示条并提供重试", () => {
    expect(hot).toContain("<HubDegradedNotice notice={notice} onRetry={reload}");
    expect(hot).toContain("reloadToken");
  });

  it("空状态区分「取不回来」与「暂无数据」", () => {
    expect(hot).toContain("notice ? '本次未能取回榜单数据' : '暂无访问量数据'");
    expect(hot).toContain("notice ? '本次未能取回新入库数据' : '暂无新入库数据'");
  });
});

describe("/tags：标签云的「0 个标签」不能说成事实", () => {
  it("页面壳把 TagCloud 挂上 SSR（RSC 化后壳不能空挂）", () => {
    expect(tagsPage).toContain("<TagCloud");
  });

  it("接上降级回调与重试", () => {
    expect(tags).toContain("describeDegrade(error, '标签数据')");
    expect(tags).toMatch(/fetchTags\(\(error\)/);
    expect(tags).toContain("<HubDegradedNotice notice={notice} onRetry={reload}");
  });

  it("标题里的数量在降级时换成「取不回来」的说法", () => {
    expect(tags).toContain("标签统计暂时取不回来");
    expect(tags).toContain("`共聚合 ${tags.length} 个技术与生态领域标签");
  });

  it("空状态不再用「没匹配」掩盖取数失败（搜索框为空时尤其荒唐）", () => {
    expect(tags).toContain("notice ? '本次未能取回标签数据' : '暂无标签数据'");
    // 分支顺序：先判「一个都没有」，再判「筛选后没有」
    expect(tags.indexOf("tags.length === 0 ?")).toBeLessThan(tags.indexOf("filteredTags.length === 0 ?"));
  });
});

describe("/collections：别把故障甩锅给站长", () => {
  it("接上降级回调与重试", () => {
    expect(collections).toContain("describeDegrade(error, '专题数据')");
    expect(collections).toMatch(/fetchCollections\(\(error\)/);
    expect(collections).toContain("<HubDegradedNotice notice={notice} onRetry={reload}");
  });

  it("空状态区分「取不回来」与「暂无专题」", () => {
    expect(collections).toContain("notice ? '本次未能取回专题列表' : '暂无精选专题，站长正在策划中'");
  });
});

describe("/tags/[slug]：降级横幅统一成可重试的提示条", () => {
  it("页面壳把 TagResultsBoard 挂上 SSR（RSC 化后壳不能空挂）", () => {
    expect(tagDetailPage).toContain("<TagResultsBoard");
  });

  it("复用 HubDegradedNotice 并带重试", () => {
    expect(tagDetail).toContain("<HubDegradedNotice");
    expect(tagDetail).toContain("onRetry={reload}");
    expect(tagDetail).toContain("reloadToken");
  });

  it("不再使用页面私有的 ⚠️ 横幅样式", () => {
    expect(tagDetail).not.toContain("⚠️ 检索服务暂时不可用");
    expect(tagDetailPage).not.toContain("⚠️ 检索服务暂时不可用");
  });

  it("请求回调带取消守卫，重试不会写入已卸载的组件", () => {
    expect(tagDetail).toContain("if (cancelled) return");
    expect(tagDetail).toContain("cancelled = true");
  });
});
