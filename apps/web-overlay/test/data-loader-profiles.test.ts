/**
 * Batch0-02（W4）：processNavigationSubItem 放行档案三字段 + status 透传。
 *
 * 细化方案 §6.2：data-loader 返回对象加 pricing / requires_account /
 * best_for，并同批补 status 透传（修既有漂移：白名单有、透传无）。
 * 缺失时保持 undefined，不硬造值；draft 态不在此层判定——分片 join
 * 只传 verified 行（见 navigation-shards.test.ts），loader 只原样透传。
 */
import { describe, expect, it } from "vitest";

import { processNavigationSubItem } from "@/lib/data-loader";

describe("processNavigationSubItem：档案三字段 + status 透传", () => {
  it("pricing / requires_account / best_for / status 原样透传", () => {
    const out = processNavigationSubItem({
      id: "s1",
      title: "甲工具",
      href: "https://a.example.com",
      enabled: true,
      status: "active",
      pricing: "freemium",
      requires_account: "optional",
      best_for: "个人轻量写作",
    });
    expect(out.pricing).toBe("freemium");
    expect(out.requires_account).toBe("optional");
    expect(out.best_for).toBe("个人轻量写作");
    expect(out.status).toBe("active");
  });

  it("缺失时保持 undefined，不硬造空值", () => {
    const out = processNavigationSubItem({
      id: "s2",
      title: "无档案站点",
      href: "https://example.com",
      enabled: true,
    });
    expect(out.pricing).toBeUndefined();
    expect(out.requires_account).toBeUndefined();
    expect(out.best_for).toBeUndefined();
    expect(out.status).toBeUndefined();
  });

  it("requires_account 为 unknown 时照常透传（卡片层决定不画角标）", () => {
    const out = processNavigationSubItem({
      id: "s3",
      title: "未核实站点",
      href: "https://example.com",
      enabled: true,
      pricing: "unknown",
      requires_account: "unknown",
    });
    expect(out.pricing).toBe("unknown");
    expect(out.requires_account).toBe("unknown");
    expect(out.best_for).toBeUndefined();
  });
});
