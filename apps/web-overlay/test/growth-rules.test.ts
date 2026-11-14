import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 升级第 12 条守卫：成长规则区真实存在、数字引常量、文案与第 9 条新规一致。
 *
 * 背景：规则以前只存在于 growth.ts:9-27 的文件头注释里，面板上只有当前
 * 倍率和一句免责。2026-11-15 第 9 条改规（设首页不再开 ×1.5）后，面板
 * 必须补一个默认折叠的「成长规则」区；数字不得手写，一律引 growth.ts
 * 常量（HOMEPAGE_CLAIM_XP / PWA_CLAIM_XP / IDENTITY_TIER / STREAK_BONUS_* /
 * USAGE_DAILY_CAP / EARNBACK_* 等），常量一改页面自动跟。
 *
 * 本测试是源码扫描断言（面板是 'use client' 组件，node 环境下
 * renderToString 只会渲染加载态，规则区挂在 effect 之后，看不到）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
function overlayPath(rel: string): string {
  const candidates = [
    resolve(HERE, "..", rel),
    resolve(HERE, "..", "..", "web-overlay", rel),
  ];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return hit;
}

function readOverlay(rel: string): string {
  return readFileSync(overlayPath(rel), "utf8");
}

function rulesBlock(): string {
  const src = readOverlay("src/components/user-center/growth-panel.tsx");
  const m = src.match(/<details[\s\S]*?<\/details>/);
  expect(m, "成长面板缺少 <details> 规则区").not.toBeNull();
  return m![0];
}

describe("成长规则区（升级第 12 条）", () => {
  it("面板有默认折叠的成长规则区，含经验来源与倍率算法", () => {
    const block = rulesBlock();
    // <details> 不带 open：默认折叠，不撑长面板首屏
    expect(block.startsWith("<details className="), "规则区默认应折叠（<details> 不带 open）").toBe(true);
    expect(block).toContain("成长规则：经验怎么来，倍率怎么算");
    expect(block).toContain("经验来源");
    expect(block).toContain("倍率算法");
    expect(block).toContain("过渡口径");
    expect(block).toContain("不带倍率");
    expect(block).toContain("装为应用");
  });

  it("规则区数字引用 growth.ts 常量而非硬编码", () => {
    const block = rulesBlock();
    const required = [
      "{FEATURE_FIRST_EVER_XP}",
      "{DAILY_FIRST_XP}",
      "{REPEAT_XP}",
      "{REPEAT_LIMIT}",
      "{CATEGORY_NEW_XP}",
      "{DAILY_VISIT_XP}",
      "{IDLE_XP_PER_MINUTE}",
      "{IDLE_DAILY_CAP_MINUTES}",
      "{HOMEPAGE_CLAIM_XP}",
      "{PWA_CLAIM_XP}",
      "{IDENTITY_TIER.base",
      "{IDENTITY_TIER.member",
      "{IDENTITY_TIER.homeOrPwa",
      "{STREAK_BONUS_STEP_DAYS}",
      "{STREAK_BONUS_STEP",
      "{STREAK_BONUS_CAP",
      "{MULTIPLIER_CAP",
      "{USAGE_DAILY_CAP}",
      "{EARNBACK_WINDOW_MS",
      "{EARNBACK_MIN_STREAK}",
    ];
    const missing = required.filter((s) => !block.includes(s));
    expect(missing, "规则区下列数字未引用常量（改写成常量引用，勿手写数字）：\n" + missing.join("\n")).toEqual([]);
  });

  it("规则区过渡口径与第 9 条新规一致：老用户保留 ×1.5，新领取不再开档", () => {
    const block = rulesBlock();
    expect(block).toContain("2026-11-15 前已领取设首页奖励的用户");
    expect(block).toContain("档位保留不变，不收回");
    expect(block).toContain("之后新领取的设首页奖励不再开启倍率");
  });

  it("growth.ts 文件头注释是规则文案源头，已按第 9 条新规改写", () => {
    const header = readOverlay("src/lib/growth.ts");
    expect(header).toContain("设为首页只给 +100 一次性经验，不开倍率");
    // 该句在注释里跨两行，分两段断言
    expect(header).toContain("2026-11-15 前");
    expect(header).toContain("已领取的老用户保留 ×1.5，不收回");
  });

  it("引导卡/引导条/页脚不再承诺设首页给加速", () => {
    const guide = readOverlay("src/components/growth/homepage-guide.tsx");
    expect(guide).not.toContain("并开启 ×1.5 加速");
    expect(guide).not.toContain("设置好可领 +{HOMEPAGE_CLAIM_XP} 经验并开启");
    expect(guide).toContain("不带倍率");
    const banner = readOverlay("src/components/growth/homepage-banner.tsx");
    expect(banner).not.toContain("开启经验加速");
    expect(banner).toContain("还能领 {HOMEPAGE_CLAIM_XP} 经验");
    const footer = readOverlay("src/components/footer.tsx");
    expect(footer).not.toContain("领经验加速");
    expect(footer).toContain("设为首页领 +{HOMEPAGE_CLAIM_XP} 经验");
  });
});
