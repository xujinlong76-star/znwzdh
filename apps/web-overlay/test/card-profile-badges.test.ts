/**
 * Batch0-02（W4）：导航卡片档案三字段（细化方案 §8.1，标准模式）。
 *
 * 锁五件事（源码文本断言，与 card-tag-links.test.ts 同款做法）：
 *   1. pricing 角标文案：free→完全免费、freemium→免费增值、paid→付费、
 *      open_source→开源免费、unknown→灰色“未标注”，与 #tag 芯片同一行；
 *   2. requires_account 角标：none→免登录、optional→登录可选、
 *      required→须登录（中性色，不用红）；unknown→卡片上不画；
 *   3. best_for 一行在描述下方，超长省略号 + title 悬停看全文，缺失整行不画；
 *   4. 三字段全部缺失时卡片与现状一致——三处渲染全是条件渲染，无兜底占位；
 *   5. draft 态字段一律不画：分片 join 只传 verified 行（见
 *      navigation-shards.test.ts），卡片层不另设 draft 分支。
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

const src = overlayFile("src/components/navigation-card.tsx");

/** 标准模式分支切片：从标准模式注释到文件末尾 */
const standardStart = src.indexOf("// 3. 标准现代卡片");
const standardSrc = src.slice(standardStart);

describe("卡片档案三字段（标准模式）", () => {
  it("切片定位成功（守卫自身没失效）", () => {
    expect(standardStart).toBeGreaterThan(-1);
    expect(standardSrc).toContain("mt-auto pt-2.5 flex items-center gap-1 flex-wrap");
  });

  it("pricing 角标五档文案齐全", () => {
    for (const label of ["完全免费", "免费增值", "付费", "开源免费", "未标注"]) {
      expect(src, `缺 pricing 文案：${label}`).toContain(label);
    }
    expect(src).toContain('free: "完全免费"');
    expect(src).toContain('freemium: "免费增值"');
    expect(src).toContain('paid: "付费"');
    expect(src).toContain('open_source: "开源免费"');
    expect(src).toContain('unknown: "未标注"');
  });

  it("requires_account 角标三档文案齐全，unknown 不画", () => {
    expect(src).toContain('none: "免登录"');
    expect(src).toContain('optional: "登录可选"');
    expect(src).toContain('required: "须登录"');
    // unknown 守卫：卡片上不画角标
    expect(standardSrc).toContain('item.requires_account !== "unknown"');
    expect(standardSrc).toContain("{item.requires_account &&");
  });

  it("须登录角标用中性色，不用红", () => {
    const idx = standardSrc.indexOf("REQUIRES_ACCOUNT_BADGE_LABEL[item.requires_account]");
    expect(idx).toBeGreaterThan(-1);
    const span = standardSrc.slice(Math.max(0, idx - 400), idx + 200);
    expect(span).not.toMatch(/text-(red|rose)-|bg-(red|rose)-/);
    expect(span).toContain("text-muted-foreground");
  });

  it("pricing 角标与 #tag 芯片同一行（标签行内渲染）", () => {
    const tagRow = standardSrc.indexOf("mt-auto pt-2.5 flex items-center gap-1 flex-wrap");
    const pricingBadge = standardSrc.indexOf("PRICING_BADGE_LABEL[item.pricing]");
    const accountBadge = standardSrc.indexOf("REQUIRES_ACCOUNT_BADGE_LABEL[item.requires_account]");
    expect(tagRow).toBeGreaterThan(-1);
    expect(pricingBadge).toBeGreaterThan(tagRow);
    expect(accountBadge).toBeGreaterThan(tagRow);
    // pricing 角标是条件渲染，unknown 灰色“未标注”走同一 muted 芯片样式
    expect(standardSrc).toContain("{item.pricing &&");
    const pricingSpan = standardSrc.slice(Math.max(0, pricingBadge - 400), pricingBadge + 200);
    expect(pricingSpan).toContain("text-muted-foreground");
  });

  it("best_for 一行在描述下方：超长省略号 + title 悬停看全文，缺失整行不画", () => {
    const descClose = standardSrc.indexOf("</CardDescription>");
    const bestFor = standardSrc.indexOf("{item.best_for &&");
    expect(descClose).toBeGreaterThan(-1);
    expect(bestFor).toBeGreaterThan(descClose);
    expect(standardSrc).toContain("title={item.best_for}");
    // 单行省略：truncate 或 line-clamp-1
    const row = standardSrc.slice(bestFor, bestFor + 400);
    expect(row).toMatch(/truncate|line-clamp-1/);
    expect(row).toContain("{item.best_for}");
  });

  it("三字段全部缺失时卡片与现状一致：三处全是条件渲染，无占位文案", () => {
    expect(standardSrc).toContain("{item.pricing &&");
    expect(standardSrc).toContain("{item.requires_account &&");
    expect(standardSrc).toContain("{item.best_for &&");
    expect(standardSrc).not.toContain("暂无适用说明");
    expect(standardSrc).not.toContain("未核实");
  });
});
