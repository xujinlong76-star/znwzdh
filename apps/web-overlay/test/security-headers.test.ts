/**
 * 安全响应头（P2-4 第一批）。
 *
 * 真实缺口：`next.config.js` 的安全头只有四项基础头；缺 COOP/CORP，
 * CSP 只有「 enforce 」一档——一上线就可能把需要内联脚本的页面打挂。
 * 因此补两件事：
 *   1. COOP（same-origin-allow-popups，不伤 OAuth 弹窗登录）+ CORP（same-site）；
 *   2. CSP **report-only** 档位：与 enforce 同源的策略但只收集违规，
 *      先跑一周再决定 enforce（方案原话：「必须先 report-only 跑一周」）。
 *
 * 这里直接调 `headers()` 验证三种开关组合下的产物，而不是读源码猜。
 */
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

type HeaderEntry = { key: string; value: string };

let savedEnv: NodeJS.ProcessEnv | undefined;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  if (savedEnv) {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  }
});

function loadHeaders(): Promise<HeaderEntry[]> {
  // 清了缓存再加载，保证读到当前 env
  const path = require.resolve("../next.config.js");
  delete require.cache[path];
  const config = require(path);
  return config.headers().then((rules: Array<{ headers: HeaderEntry[] }>) => rules[0].headers);
}

function find(headers: HeaderEntry[], key: string): HeaderEntry | undefined {
  return headers.find((h) => h.key === key);
}

describe("安全响应头：默认档", () => {
  it("基础四件套 + COOP/CORP 常开", async () => {
    delete process.env.NAVHUB_CSP;
    delete process.env.NAVHUB_CSP_REPORT_ONLY;
    delete process.env.NAVHUB_COOP;
    const headers = await loadHeaders();

    expect(find(headers, "X-Content-Type-Options")?.value).toBe("nosniff");
    expect(find(headers, "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
    expect(find(headers, "X-Frame-Options")?.value).toBe("SAMEORIGIN");
    expect(find(headers, "Permissions-Policy")?.value).toBe("geolocation=(), microphone=(), camera=()");
    // COOP 必须是 allow-popups 变体：OAuth 弹窗登录依赖 opener 关系
    expect(find(headers, "Cross-Origin-Opener-Policy")?.value).toBe("same-origin-allow-popups");
    expect(find(headers, "Cross-Origin-Resource-Policy")?.value).toBe("same-site");
  });

  it("默认既不下发 CSP 也不下发 Report-Only（个人部署不被打挂）", async () => {
    delete process.env.NAVHUB_CSP;
    delete process.env.NAVHUB_CSP_REPORT_ONLY;
    const headers = await loadHeaders();
    expect(find(headers, "Content-Security-Policy")).toBeUndefined();
    expect(find(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });
});

describe("CSP 三档开关", () => {
  it("NAVHUB_CSP=1 → enforce 档", async () => {
    process.env.NAVHUB_CSP = "1";
    const headers = await loadHeaders();
    const csp = find(headers, "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
    expect(csp!.value).toContain("object-src 'none'");
    // 投机算式的 new Function 已移除，生产不再需要 unsafe-eval
    expect(csp!.value).not.toContain("unsafe-eval");
    // 没有 report-only 时不应同时下发两个变体（浏览器会都执行）
    expect(find(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("NAVHUB_CSP_REPORT_ONLY=1 → 只收集不拦截，且不与 enforce 同时下发", async () => {
    delete process.env.NAVHUB_CSP;
    process.env.NAVHUB_CSP_REPORT_ONLY = "1";
    const headers = await loadHeaders();
    expect(find(headers, "Content-Security-Policy")).toBeUndefined();
    const ro = find(headers, "Content-Security-Policy-Report-Only");
    expect(ro).toBeDefined();
    expect(ro!.value).toContain("default-src 'self'");
  });

  it("NAVHUB_CSP_REPORT_URI 指定时追加 report-uri", async () => {
    process.env.NAVHUB_CSP_REPORT_ONLY = "1";
    process.env.NAVHUB_CSP_REPORT_URI = "https://csp.example.com/report";
    const headers = await loadHeaders();
    const ro = find(headers, "Content-Security-Policy-Report-Only");
    expect(ro!.value).toContain("report-uri https://csp.example.com/report");
  });

  it("enforce 档同样支持 report-uri（上线后继续收集违规）", async () => {
    process.env.NAVHUB_CSP = "1";
    process.env.NAVHUB_CSP_REPORT_URI = "https://csp.example.com/report";
    const headers = await loadHeaders();
    const csp = find(headers, "Content-Security-Policy");
    expect(csp!.value).toContain("report-uri https://csp.example.com/report");
  });

  it("两个开关同时打开时 enforce 优先，不重复下发 Report-Only", async () => {
    process.env.NAVHUB_CSP = "1";
    process.env.NAVHUB_CSP_REPORT_ONLY = "1";
    const headers = await loadHeaders();
    expect(find(headers, "Content-Security-Policy")).toBeDefined();
    expect(find(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("显式置 0 可退出默认档（U-415 的逃生口：只有 \"1\" 才开启）", async () => {
    process.env.NAVHUB_CSP_REPORT_ONLY = "0";
    process.env.NAVHUB_HSTS = "0";
    const headers = await loadHeaders();
    expect(find(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
    expect(find(headers, "Strict-Transport-Security")).toBeUndefined();
  });

  it("enforce 与 report-only 的指令逐字一致（单一事实源，防策略漂移）", async () => {
    process.env.NAVHUB_CSP = "1";
    const enforced = find(await loadHeaders(), "Content-Security-Policy")!.value;
    delete process.env.NAVHUB_CSP;
    process.env.NAVHUB_CSP_REPORT_ONLY = "1";
    const observed = find(await loadHeaders(), "Content-Security-Policy-Report-Only")!.value;
    expect(observed).toBe(enforced);
  });
});

describe("COOP 可关：性能审计构建用", () => {
  // 2026-11-22 实测：COOP 让导航提交时切 browsing context group，Chromium 丢掉
  // 真实导航的 navigationStart trace 事件 → Lighthouse 全部性能审计报
  // NO_NAVSTART（受控实验：同一份 HTML，只改这一个头，去掉即恢复出分）。
  // OAuth 弹窗登录仍需要它，故默认保持开，只给审计构建留一个关闭位。
  it("NAVHUB_COOP=off → 不下发 COOP，其余安全头一个不少", async () => {
    process.env.NAVHUB_COOP = "off";
    const headers = await loadHeaders();

    expect(find(headers, "Cross-Origin-Opener-Policy")).toBeUndefined();
    // 只关 COOP：CORP 与基础头不能被顺手带走
    expect(find(headers, "Cross-Origin-Resource-Policy")?.value).toBe("same-site");
    expect(find(headers, "X-Content-Type-Options")?.value).toBe("nosniff");
    expect(find(headers, "X-Frame-Options")?.value).toBe("SAMEORIGIN");
    expect(find(headers, "Permissions-Policy")?.value).toBe("geolocation=(), microphone=(), camera=()");
    expect(find(headers, "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
  });

  it("其它取值（on / 1 / 空）都按默认开处理，不给脏值开口子", async () => {
    for (const raw of ["on", "1", "", "same-origin"]) {
      process.env.NAVHUB_COOP = raw;
      const headers = await loadHeaders();
      expect(find(headers, "Cross-Origin-Opener-Policy")?.value, `NAVHUB_COOP=${JSON.stringify(raw)}`).toBe(
        "same-origin-allow-popups",
      );
    }
  });
});

describe("HSTS 只在明确 https 时下发", () => {  it("无 NAVHUB_PUBLIC_URL 时不下发（http 自托管不会被强制升级）", async () => {
    delete process.env.NAVHUB_HSTS;
    delete process.env.NAVHUB_PUBLIC_URL;
    const headers = await loadHeaders();
    expect(find(headers, "Strict-Transport-Security")).toBeUndefined();
  });

  it("https 公开地址时下发", async () => {
    delete process.env.NAVHUB_HSTS;
    process.env.NAVHUB_PUBLIC_URL = "https://nav.example.com";
    const headers = await loadHeaders();
    expect(find(headers, "Strict-Transport-Security")?.value).toBe("max-age=15552000");
  });
});

// env 卫生（D2）：恢复本文件改写的环境变量，避免驻留同 worker 的后续文件
afterAll(() => {
  delete process.env.NAVHUB_CSP;
  delete process.env.NAVHUB_CSP_REPORT_ONLY;
  delete process.env.NAVHUB_CSP_REPORT_URI;
  delete process.env.NAVHUB_HSTS;
  delete process.env.NAVHUB_PUBLIC_URL;
  delete process.env.NAVHUB_COOP;
});
