/**
 * 批次 M 回归（2026-11-06 深扫 F-6）：site-peek-dialog 的「场景视觉」弹层
 * 曾把服务端下发的 `data.imageUrl` 直接交给图片源与点击外跳（裸 URL 出口）。
 *
 * 这条正是 url-hygiene 全库不变量抓到的：`visualUrl` 来自外部可控数据，
 * `javascript:` / `data:` 类协议可借此进入渲染与外链。
 * 本测试钉住修复不被回退（源码级断言，与 url-hygiene 互补：那条扫全库，这条盯本文件）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(resolve(ROOT, "src/components/site-peek-dialog.tsx"), "utf8");

describe("site-peek-dialog 场景视觉弹层 URL 安全", () => {
  it("图片源经 safeSrc 包裹（不是裸 src={visualUrl}）", () => {
    expect(SRC).toContain("safeSrc(visualUrl)");
    expect(SRC).not.toContain("src={visualUrl}");
  });

  it("点击外跳经 safeWindowOpen（不是裸 window.open）", () => {
    expect(SRC).toContain("safeWindowOpen(visualUrl)");
    expect(SRC).not.toContain("window.open(visualUrl");
  });

  it("相关安全工具确实从 @/lib/safe-url 导入", () => {
    expect(SRC).toMatch(/import \{[^}]*safeSrc[^}]*\} from '@\/lib\/safe-url'/);
    expect(SRC).toMatch(/import \{[^}]*safeWindowOpen[^}]*\} from '@\/lib\/safe-url'/);
  });
});
