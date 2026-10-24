/**
 * 检索个性化参数契约：HTTP 入参 schema 必须覆盖 core 的信号类型。
 *
 * 为什么单独钉这条：zod 默认剥掉未声明的键，schema 比 `PersonalizationSignals`
 * 少一个字段时，请求不报错、类型检查也未必报错（只有当 Route 内部再赋值给
 * 该类型时才露馅），结果是「画像采集了、前端传了、排序器从没收到」。
 * 2026-10-24 实测就是这样少掉了 favoriteSiteIds，TS2353 才把它揪出来。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PersonalizationSignals } from "@navhub/core";

const SRC = readFileSync(new URL("../src/routes/search.ts", import.meta.url), "utf8");

function personalizeSchemaKeys(): string[] {
  const block = /personalize:\s*z\.object\(\{([\s\S]*?)\}\)\.optional\(\)/.exec(SRC)?.[1];
  if (!block) return [];
  return [...block.matchAll(/^\s*([A-Za-z_]\w*):\s*z\./gm)].map((m) => m[1]);
}

describe("搜索入参 personalize 与 PersonalizationSignals 同形", () => {
  it("schema 覆盖 core 信号的全部字段", () => {
    const expected: Array<keyof PersonalizationSignals> = [
      "topCategories",
      "topTags",
      "visitedSiteIds",
      "favoriteSiteIds",
    ];
    expect(personalizeSchemaKeys().sort()).toEqual([...expected].sort());
  });

  it("路由把画像里的收藏信号真的传给了排序器", () => {
    expect(SRC).toContain("favoriteSiteIds: profile.favoriteSiteIds");
  });
});
