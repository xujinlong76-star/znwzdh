/**
 * 崩溃页面的文案：**用户看到的必须是「该做什么」，不是一行英文内部信息**。
 *
 * 真实缺陷（改动前）：
 *   - `app/error.tsx` 把 `error.message` 当正文 —— 生产环境里那是
 *     `Minified React error #418` / `ChunkLoadError` / `Failed to fetch`，
 *     用户看不懂、不知怎么办，也没有任何可用于定位的编号；
 *   - 没有 `global-error.tsx`：根布局 / 全局 providers 抛错时，用户看到的是
 *     Next 的无样式兜底页，整站观感崩塌且没有出口。
 *
 * 这里锁三件事：
 *   1. 分类与文案（纯函数，纯输入输出）；
 *   2. 对用户无意义的 detail 必须被丢掉（不许拿压缩错误当正文），
 *      同时 digest（唯一能对应服务端日志的编号）必须透出；
 *   3. 两个崩溃页面共享同一套解释口径，且 global-error 自带 <html>/<body> 与内联样式。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyCrash, crashReportText, describeCrash } from "../src/lib/error-report";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("classifyCrash：按异常形态分类", () => {
  it("发版瞬间的 ChunkLoadError 单独分类（最常见且最可自救）", () => {
    for (const message of [
      "ChunkLoadError: Loading chunk 512 failed",
      "Loading chunk app/page failed",
      "Loading CSS chunk 3 failed",
      "Failed to load chunk /_next/static/chunks/main.js",
    ]) {
      expect(classifyCrash(message)).toBe("chunk");
    }
  });

  it("网络层失败", () => {
    for (const message of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "net::ERR_INTERNET_DISCONNECTED",
    ]) {
      expect(classifyCrash(message)).toBe("network");
    }
  });

  it("水合不一致（发版后旧 HTML 撞上新 JS）", () => {
    expect(classifyCrash("Hydration failed because the initial UI does not match")).toBe("hydration");
    expect(classifyCrash("Text content does not match server-rendered HTML.")).toBe("hydration");
  });

  it("本机存储写满", () => {
    expect(classifyCrash("QuotaExceededError: The quota has been exceeded.")).toBe("storage");
  });

  it("其余都归为运行时异常", () => {
    expect(classifyCrash("")).toBe("runtime");
    expect(classifyCrash("Cannot read properties of undefined (reading 'map')")).toBe("runtime");
  });
});

describe("describeCrash：每类都要给出「该做什么」", () => {
  it("所有分类都有非空标签 / 标题 / 说明，且不会抛异常", () => {
    const inputs: unknown[] = [
      new Error("ChunkLoadError: Loading chunk 1 failed"),
      new Error("Failed to fetch"),
      new Error("Hydration failed"),
      new Error("QuotaExceededError"),
      new Error("boom"),
      "boom",
      { message: "boom" },
      null,
      undefined,
      42,
      "",
    ];
    for (const input of inputs) {
      const info = describeCrash(input);
      expect(info.badge.trim().length).toBeGreaterThan(0);
      expect(info.title.trim().length).toBeGreaterThan(0);
      expect(info.hint.trim().length).toBeGreaterThan(0);
      expect(typeof info.retryable).toBe("boolean");
    }
  });

  it("资源加载失败：告诉用户是发版导致的，重试有效", () => {
    const info = describeCrash(new Error("ChunkLoadError: Loading chunk 1 failed"));
    expect(info.kind).toBe("chunk");
    expect(info.retryable).toBe(true);
    expect(info.hint).toContain("重新加载");
    expect(info.hint).toContain("新版本");
  });

  it("网络失败：先让用户查网络，再说中枢可能不可达", () => {
    const info = describeCrash(new Error("Failed to fetch"));
    expect(info.kind).toBe("network");
    expect(info.hint).toContain("网络");
    expect(info.retryable).toBe(true);
  });

  it("水合不一致：detail 必须丢掉（那是内部细节，用户无从行动）", () => {
    const info = describeCrash(new Error("Hydration failed because the initial UI does not match"));
    expect(info.kind).toBe("hydration");
    expect(info.detail).toBeUndefined();
    expect(info.hint).toContain("重新加载");
  });

  it("存储满：不给「重新加载」（按了也没用的按钮最伤信任）", () => {
    const info = describeCrash(new Error("QuotaExceededError: The quota has been exceeded."));
    expect(info.kind).toBe("storage");
    expect(info.retryable).toBe(false);
    expect(info.hint).toContain("本地数据");
  });

  it("压缩后的 React 错误不许当正文（回归：用户看到的是一行天书）", () => {
    const info = describeCrash(new Error("Minified React error #418; visit https://react.dev/errors/418"));
    expect(info.kind).toBe("runtime");
    expect(info.detail).toBeUndefined();
    expect(info.badge).toBe("运行时异常");
  });

  it("有意义的异常信息要保留下来，供反馈定位", () => {
    const info = describeCrash(new Error("Cannot read properties of undefined (reading 'hits')"));
    expect(info.detail).toBe("Cannot read properties of undefined (reading 'hits')");
  });

  it("digest 是唯一能对应服务端日志的编号，必须透出并去除空白", () => {
    expect(describeCrash(new Error("boom"), " abc123 ").digest).toBe("abc123");
    expect(describeCrash(new Error("boom"), "   ").digest).toBeUndefined();
    expect(describeCrash(new Error("boom")).digest).toBeUndefined();
  });
});

describe("crashReportText：可复制的诊断文本", () => {
  it("含类型与说明，并在有编号 / 详情时带上它们", () => {
    const text = crashReportText(describeCrash(new Error("boom"), "abc123"));
    expect(text.startsWith("[山羊胡崩溃反馈]")).toBe(true);
    expect(text).toContain("类型：运行时异常");
    expect(text).toContain("编号：abc123");
    expect(text).toContain("详情：boom");
    expect(text).toContain("时间：");
  });

  it("没有编号 / 详情时不写空行（避免「编号：」后面什么都没有）", () => {
    const text = crashReportText(describeCrash(new Error("Minified React error #418")));
    expect(text).not.toContain("编号：");
    expect(text).not.toContain("详情：");
    expect(text).not.toContain("页面：");
  });
});

describe("源码守卫：两个崩溃页面共享同一套口径", () => {
  it("error.tsx 用 describeCrash 决定文案，并把 digest / 详情 / 重试交出去", () => {
    const src = overlaySource("src/app/error.tsx");
    expect(src).toContain("describeCrash(error, error?.digest)");
    expect(src).toContain("crashReportText(crash)");
    expect(src).toContain("{crash.badge}");
    expect(src).toContain("{crash.title}");
    expect(src).toContain("{crash.hint}");
    expect(src).toContain("{crash.digest}");
    expect(src).toContain("crash.retryable &&");
    expect(src).toContain("重新加载");
    expect(src).toContain("返回主页");
    expect(src).toContain("复制诊断信息");
    // 旧写法：直接把原始异常信息当正文
    expect(src).not.toContain("{error.message");
  });

  it("global-error.tsx 存在，自带 html/body 与内联样式（根布局此时不可用）", () => {
    const src = overlaySource("src/app/global-error.tsx");
    expect(src).toContain("'use client'");
    expect(src).toContain("<html");
    expect(src).toContain("<body");
    expect(src).toContain("style={{");
    expect(src).toContain("describeCrash(error, error?.digest)");
    expect(src).toContain("crash.retryable &&");
    expect(src).toContain("返回主页");
    // 根布局已出错，客户端路由不可信：必须整页跳转（也避免 lint 要求改用 Link）
    expect(src).toContain("window.location.assign('/')");
    expect(src).not.toContain("next/link");
  });
});
