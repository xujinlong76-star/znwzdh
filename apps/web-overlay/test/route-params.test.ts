import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeDecodeParam } from "@/lib/server/route-params";

/**
 * 动态路由参数解码（2026-10-21 软 404/500 治理的基础件）。
 *
 * Next 传入的 params 可能仍是百分号编码；裸 decodeURIComponent 遇到 `%`
 * 这类畸形输入会抛 URIError，把一次爬虫探测变成 500。这里锁死：
 *   - 坏输入返回 null（调用方 notFound()），绝不抛错；
 *   - 只解码一次（不把 %2525 解成 %）；
 *   - 每个带动态段的服务端页面都走 safeDecodeParam，而不是自己 decode。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("safeDecodeParam", () => {
  it("正常参数原样返回（ASCII 与已解码中文）", () => {
    expect(safeDecodeParam("ai-coding")).toBe("ai-coding");
    expect(safeDecodeParam("开源")).toBe("开源");
  });

  it("百分号编码只解码一次", () => {
    expect(safeDecodeParam("%E5%BC%80%E6%BA%90")).toBe("开源");
    // 双重编码不会二次解码（调用方拿到的仍是编码后的字面量）
    expect(safeDecodeParam("%2525")).toBe("%25");
  });

  it("畸形编码返回 null 而不是抛 URIError", () => {
    for (const bad of ["%", "%E0%A4%A", "%ZZ", "%C3"]) {
      expect(() => safeDecodeParam(bad)).not.toThrow();
      expect(safeDecodeParam(bad)).toBeNull();
    }
  });

  it("空值/空串返回 null（空动态段不应被当成合法资源名）", () => {
    expect(safeDecodeParam("")).toBeNull();
    expect(safeDecodeParam(null)).toBeNull();
    expect(safeDecodeParam(undefined)).toBeNull();
  });
});

describe("动态段服务端页面统一走解码入口", () => {
  // /site/[id] 不在名单里：该路由归并行会话的 P0-1 改造（当前壳直接透传
  // id，由中枢 API 用 encodeURIComponent 拼路径），本轮不越界修改。
  const dynamicPages = [
    "src/app/tags/[slug]/page.tsx",
    "src/app/collections/[slug]/page.tsx",
    "src/app/category/[slug]/page.tsx",
    "src/app/marketplace/[slug]/page.tsx",
    "src/app/marketplace/author/[key]/page.tsx",
  ];

  it.each(dynamicPages)("%s 使用 safeDecodeParam 且没有裸 decodeURIComponent", (rel) => {
    const src = overlayFile(rel);
    expect(src).toContain("safeDecodeParam");
    // 辅助函数本身当然用 decodeURIComponent；页面里出现就是绕过了守卫
    expect(src).not.toMatch(/decodeURIComponent\s*\(/);
  });
});
