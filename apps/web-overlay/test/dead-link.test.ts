import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDeadLinkWaybackUrl,
  formatWaybackTimestamp,
} from "../src/lib/dead-link";

/**
 * 死链防御 #4：一键 Wayback 存档恢复（仅详情页）。
 *
 * 卡片上的「已失效 · 看存档」徽标已于 2026-11-12 移除（连同判定口径
 * isDeadLinkHealth）：卡片数据来自静态导航 JSON，从没有任何一条带巡检
 * health，首页也不取中枢数据，导航 id 与中枢站点 id 之间又没有可验证的
 * 对应关系——徽标在生产里永远画不出来，留着只是死 UI。死链恢复的唯一
 * 活入口在详情页：site-detail-view 直接用中枢站点的 url + createdAt，
 * 一键打开收录时刻的 Wayback 快照。
 *
 * Wayback 链接定向到「收录时刻」最近的快照（YYYYMMDDHHMMSS，UTC），
 * 没有日期时回落到 `*`（最新快照）。全程纯函数，不发网络请求：
 * 恢复动作是用户点击后才打开新标签页。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("收录时刻时间戳 formatWaybackTimestamp", () => {
  it("毫秒 epoch 与 Date 都格式化成 YYYYMMDDHHMMSS（UTC）", () => {
    expect(formatWaybackTimestamp(Date.UTC(2026, 0, 15, 8, 30, 0))).toBe("20260115083000");
    expect(formatWaybackTimestamp(new Date(Date.UTC(2026, 2, 5, 4, 3, 2)))).toBe("20260305040302");
  });

  it("无效、缺失、非正的输入返回 null（调用方回落到 *，不编假时间）", () => {
    expect(formatWaybackTimestamp(null)).toBeNull();
    expect(formatWaybackTimestamp(undefined)).toBeNull();
    expect(formatWaybackTimestamp(0)).toBeNull();
    expect(formatWaybackTimestamp(-1)).toBeNull();
    expect(formatWaybackTimestamp(Number.NaN)).toBeNull();
    expect(formatWaybackTimestamp(new Date("not-a-date"))).toBeNull();
  });
});

describe("一键 Wayback 链接 buildDeadLinkWaybackUrl", () => {
  it("有收录时刻时定向到该时刻最近的快照", () => {
    expect(buildDeadLinkWaybackUrl("https://example.com/page", Date.UTC(2026, 0, 15, 8, 30, 0))).toBe(
      "https://web.archive.org/web/20260115083000/https://example.com/page",
    );
    expect(
      buildDeadLinkWaybackUrl("https://example.com/page", new Date(Date.UTC(2026, 0, 15, 8, 30, 0))),
    ).toBe("https://web.archive.org/web/20260115083000/https://example.com/page");
  });

  it("没有收录时刻时回落到最新快照 *", () => {
    expect(buildDeadLinkWaybackUrl("https://example.com/page")).toBe(
      "https://web.archive.org/web/*/https://example.com/page",
    );
    expect(buildDeadLinkWaybackUrl("https://example.com/page", null)).toBe(
      "https://web.archive.org/web/*/https://example.com/page",
    );
    expect(buildDeadLinkWaybackUrl("https://example.com/page", 0)).toBe(
      "https://web.archive.org/web/*/https://example.com/page",
    );
  });

  it("目标 URL 被规范化（去 utm/hash），非法输入返回空串、调用方不得开空标签页", () => {
    expect(buildDeadLinkWaybackUrl("https://example.com/page?utm_source=x&keep=1#frag")).toBe(
      "https://web.archive.org/web/*/https://example.com/page?keep=1",
    );
    expect(buildDeadLinkWaybackUrl("")).toBe("");
    expect(buildDeadLinkWaybackUrl("https://")).toBe("");
    expect(buildDeadLinkWaybackUrl(":::")).toBe("");
  });

  it("纯函数：不发网络请求，链接本身就是恢复动作", () => {
    const src = overlayFile("src/lib/dead-link.ts");
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("archive.org/api");
    expect(src).not.toContain("availability");
  });
});

describe("接线守卫：死链恢复只活在详情页，卡片不再承诺徽标", () => {
  it("卡片上没有任何死链徽标：徽标文案、判定口径与恢复动作都已移除", () => {
    const src = overlayFile("src/components/navigation-card.tsx");
    expect(src).not.toContain("已失效 · 看存档");
    expect(src).not.toContain("isDeadLinkHealth");
    expect(src).not.toContain("buildDeadLinkWaybackUrl");
    expect(src).not.toContain("handleDeadLinkRecovery");
    expect(src).not.toContain("dead-link");
    expect(src).not.toContain("item.health?.ok === false");
    expect(src).not.toContain("快照自愈");
  });

  it("详情页 Wayback 链接定向到收录时刻（site.createdAt），不再是 *", () => {
    const src = overlayFile("src/components/site-detail-view.tsx");
    expect(src).toContain("buildDeadLinkWaybackUrl(site.url, site.createdAt)");
    expect(src).not.toContain("web.archive.org/web/*/");
  });

  it("巡检健康状态仍透传：loader 不再裁掉 health（供速览弹窗的健康提示）", () => {
    const loader = overlayFile("src/lib/data-loader.ts");
    expect(loader).toContain("health: item.health");
    const types = overlayFile("src/types/navigation.ts");
    expect(types).toContain("health?: NavigationSubItem['health']");
  });

  it("新代码没有显式 any（pre-commit 门禁）", () => {
    const src = overlayFile("src/lib/dead-link.ts");
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toContain("as any");
  });
});
