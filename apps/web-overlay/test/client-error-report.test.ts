/**
 * 前端错误上报（P2-5）的前端一半。
 *
 * 真实缺口：错误边界把崩溃翻译得很好了，但**服务端从来不知道**——
 * 发版后出现 ChunkLoadError，只能等用户反馈。这个模块把「已分类的崩溃」
 * 脱敏后送到中枢。
 *
 * 锁三件事：
 *   1. 指纹稳定（空白归一），同类错误不因换行/缩处产生不同指纹；
 *   2. **隐私**：上报体只有 kind + 指纹 + pathname + digest——
 *      不带错误原文、不带 query（原文里可能夹带用户输入）；
 *   3. 三个错误边界（error / global-error / route-error）真的接上了，
 *      不是「写了个模块没人调用」。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildErrorReport, fingerprint } from "../src/lib/client-error-report";

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..", "..", "web-overlay");

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("overlay 缺少文件 " + rel);
  return readFileSync(p, "utf8");
}

describe("fingerprint：稳定且不含原文", () => {
  it("同一消息（空白/换行不同）指纹一致", () => {
    expect(fingerprint("Loading chunk 42 failed")).toBe(fingerprint("Loading   chunk 42\n failed"));
  });

  it("不同消息指纹不同，且恒为 12 位小写十六进制", () => {
    const a = fingerprint("ChunkLoadError");
    const b = fingerprint("NetworkError");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toMatch(/^[0-9a-f]{12}$/);
  });

  it("空消息也有确定输出（不抛错）", () => {
    expect(fingerprint("")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("buildErrorReport：到底发了什么", () => {
  it("kind 来自 classifyCrash，不自己发明分类", () => {
    expect(buildErrorReport({ message: "ChunkLoadError: Loading chunk 1 failed." }).kind).toBe("chunk");
    expect(buildErrorReport({ message: "Failed to fetch" }).kind).toBe("network");
  });

  it("path 只保留 pathname（query 被剥掉），digest 透传", () => {
    const r = buildErrorReport({ message: "boom", pathname: "/hot?tab=week&q=用户输入", digest: "d-123" });
    expect(r.path).toBe("/hot");
    expect(r.digest).toBe("d-123");
  });

  it("上报体不含错误原文（隐私红线：消息只进指纹，不出浏览器）", () => {
    const r = buildErrorReport({ message: "secret user typed <script>", pathname: "/submit" });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("script");
    expect(Object.keys(r).sort()).toEqual(["fingerprint", "kind", "path"]);
  });
});

describe("接线：三个错误边界都接上了", () => {
  for (const rel of [
    "src/app/error.tsx",
    "src/app/global-error.tsx",
    "src/components/route-error.tsx",
  ]) {
    it(`${rel} 调用 reportClientError`, () => {
      const s = overlayFile(rel);
      expect(s).toContain("from '@/lib/client-error-report'");
      expect(s).toContain("reportClientError({");
    });
  }

  it("上报默认关闭（NEXT_PUBLIC_ERROR_REPORT=1 才启用）", () => {
    const s = overlayFile("src/lib/client-error-report.ts");
    expect(s).toContain("NEXT_PUBLIC_ERROR_REPORT");
    expect(s).toContain("sendBeacon");
  });
});
