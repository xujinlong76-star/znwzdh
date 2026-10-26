/**
 * 登录页不能说谎，也不能沉默。
 *
 * 改动前有两处：
 *   1. `signIn()` 只要返回 error 就写成「密码或 Token 凭证错误」—— 但服务端配置错误
 *      （next-auth 的 `Configuration`）与 5xx 跟用户的输入毫无关系，用户会一直重打密码；
 *   2. 兜底分支只有 `setIsLoading(false)` —— 点下去转圈停止，**一个字都不说**。
 *
 * 这里守住：服务端问题/网络问题绝不指向「你的密码」，凭证问题才指向输入，
 * 任何失败都必须有话说；并且页面里每次「停止加载」都必须配一句解释。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCESS_DENIED,
  NETWORK_FAILURE_STATUS,
  OAUTH_BROKEN,
  PASSWORD_MISMATCH,
  describeSignInFailure,
  isSignInSuccess,
} from "../src/lib/signin-failure";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const SIGNIN = "src/app/auth/signin/page.tsx";

function pageSource(): string {
  return readFileSync(join(ROOT, SIGNIN), "utf8");
}

describe("服务端的问题绝不写成「密码不对」", () => {
  it("HTTP 500：明确说不是密码问题，并指出该找管理员", () => {
    const notice = describeSignInFailure({ status: 500, error: "Callback" });
    expect(notice.message).toContain("HTTP 500");
    expect(notice.message).toContain("这不是你的密码问题");
    expect(notice.message).not.toContain("不匹配");
    expect(notice.userInput).toBe(false);
  });

  it("next-auth 的 Configuration：服务端配置错误，同样不是密码问题", () => {
    const notice = describeSignInFailure({ error: "Configuration" });
    expect(notice.userInput).toBe(false);
    expect(notice.message).toContain("AUTH_SECRET");
    expect(notice.message).not.toContain("不匹配");
  });

  it("回调阶段炸了（Callback / OAuthCreateAccount）也归为服务端问题", () => {
    for (const code of ["Callback", "OAuthCreateAccount"]) {
      const notice = describeSignInFailure({ error: code });
      expect(notice.userInput, `${code} 不该让用户改密码`).toBe(false);
      expect(notice.message).toContain("不是你的密码问题");
    }
  });

  it("网络层完全连不上（status=0）：说清连不上，而不是凭证错误", () => {
    const notice = describeSignInFailure({ status: NETWORK_FAILURE_STATUS });
    expect(notice.userInput).toBe(false);
    expect(notice.message).toContain("无法连接登录服务");
  });
});

describe("凭证问题才指向输入", () => {
  it("CredentialsSignin 与 401 是同一件事，必须给同一句话", () => {
    const byCode = describeSignInFailure({ error: "CredentialsSignin" });
    const byStatus = describeSignInFailure({ status: 401 });
    expect(byCode.message).toBe(byStatus.message);
    expect(byCode.message).toBe(PASSWORD_MISMATCH);
    expect(byCode.message).toContain("不匹配");
    expect(byCode.userInput).toBe(true);
  });

  it("白名单拒绝：换账号才能解决，所以不给「重试」的暗示", () => {
    const byCode = describeSignInFailure({ error: "AccessDenied" });
    const byStatus = describeSignInFailure({ status: 403 });
    expect(byCode.message).toBe(ACCESS_DENIED);
    expect(byStatus.message).toBe(ACCESS_DENIED);
    expect(byCode.retryable).toBe(false);
    expect(byCode.userInput).toBe(true);
  });

  it("OAuth 失败时给出一条仍然可用的备选路径（密码登录）", () => {
    for (const code of ["OAuthSignin", "OAuthCallback", "OAuthCallbackError"]) {
      const notice = describeSignInFailure({ error: code });
      expect(notice.message).toBe(OAUTH_BROKEN);
      expect(notice.message).toContain("管理密码登录");
    }
  });
});

describe("失败必须有话说（不许静默）", () => {
  it("signIn 什么都没返回：不能说「密码错误」，要说「没有结果，请重试」", () => {
    for (const empty of [null, undefined]) {
      const notice = describeSignInFailure(empty);
      expect(notice.message.length).toBeGreaterThan(8);
      expect(notice.message).toContain("没有返回任何结果");
      expect(notice.userInput).toBe(false);
    }
  });

  it("只给了 ok=false、没有原因：不猜是密码错，也不沉默", () => {
    const notice = describeSignInFailure({ ok: false });
    expect(notice.message.length).toBeGreaterThan(8);
    expect(notice.userInput).toBe(false);
    expect(notice.message).not.toBe(PASSWORD_MISMATCH);
    expect(notice.message).not.toContain("不匹配");
  });

  it("未知错误码要如实带出来，不伪装成已知原因", () => {
    const notice = describeSignInFailure({ error: "SomeWeirdCode" });
    expect(notice.message).toContain("SomeWeirdCode");
  });

  it("不变量：任何输入都有一句非空、可读的话，且不会既怪密码又怪服务端", () => {
    const inputs = [
      null,
      undefined,
      {},
      { ok: false },
      { status: 0 },
      { status: 401 },
      { status: 403 },
      { status: 500 },
      { status: 503, error: "Callback" },
      { error: "Configuration" },
      { error: "CredentialsSignin" },
      { error: "AccessDenied" },
      { error: "OAuthSignin" },
      { error: "OAuthCallbackError" },
      { error: "OAuthCreateAccount" },
      { error: "Whatever" },
    ];
    for (const input of inputs) {
      const notice = describeSignInFailure(input as never);
      const label = JSON.stringify(input);
      expect(notice.message.trim().length, `${label} 的说明太短：${notice.message}`).toBeGreaterThan(8);
      const blamesPassword = notice.message.includes("不匹配");
      const blamesServer = notice.message.includes("未正确配置") || notice.message.includes("无法连接");
      expect(blamesPassword && blamesServer, `${label} 同时怪了密码和服务端：${notice.message}`).toBe(false);
    }
  });
});

describe("成功判定：HTTP 200 也可能是失败", () => {
  // 真实缺陷：next-auth v5 对凭证失败仍回 HTTP 200，失败码只在 res.error 里。
  // 页面只判 res.ok，于是「密码错」被当成成功跳转，再被代理弹回登录页，
  // 错误提示丢失，用户只看到页面刷新了一下。
  it("CredentialsSignin 即使 ok=true 也判失败", () => {
    expect(isSignInSuccess({ ok: true, status: 200, error: "CredentialsSignin" })).toBe(false);
  });

  it("只有 ok=true 且没有 error 才算成功", () => {
    expect(isSignInSuccess({ ok: true, status: 200 })).toBe(true);
    expect(isSignInSuccess({ ok: false, status: 401 })).toBe(false);
    expect(isSignInSuccess({})).toBe(false);
    expect(isSignInSuccess(null)).toBe(false);
    expect(isSignInSuccess(undefined)).toBe(false);
  });

  it("登录页两个入口都用同一判定，不再只看 res.ok", () => {
    const src = pageSource();
    expect(src).not.toContain("if (res?.ok)");
    expect((src.match(/isSignInSuccess\(res\)/g) || []).length).toBe(2);
  });
});

describe("登录页接线", () => {
  it("用纯函数判定，不再内联各写一套文案", () => {
    const src = pageSource();
    expect(src).toContain("from '@/lib/signin-failure'");
    expect(src).toContain("describeSignInFailure(res).message");
    expect(src).toContain("describeSignInFailure({ error: urlError }).message");
    // 旧的、被搬到 lib 的文案不许再出现在页面里
    expect(src).not.toContain("密码或 Token 凭证错误");
    expect(src).not.toContain("登录服务连接失败");
    expect(src).not.toContain("GitHub OAuth 登录遇到错误");
  });

  it("兜底分支不再「只停止加载、不说话」", () => {
    const src = pageSource();
    expect(src).not.toMatch(/else\s*\{\s*setIsLoading\(false\)\s*\}/);
    expect(src).not.toMatch(/else\s*\{\s*setIsBypassLoading\(false\)\s*\}/);
  });

  it("每次「停止加载」都必须配一句解释（两个提交入口都一样）", () => {
    const src = pageSource();
    const cred = src.slice(src.indexOf("const handleCredentialsSignIn"), src.indexOf("const handleBypassSignIn"));
    const bypass = src.slice(src.indexOf("const handleBypassSignIn"), src.indexOf("const hasGithub"));
    for (const [name, body, stop] of [
      ["handleCredentialsSignIn", cred, /setIsLoading\(false\)/g],
      ["handleBypassSignIn", bypass, /setIsBypassLoading\(false\)/g],
    ] as const) {
      const stops = (body.match(stop) || []).length;
      const explains = (body.match(/setErrorMessage\((notice|describeSignInFailure)/g) || []).length;
      expect(stops, `${name} 里没有失败分支？`).toBeGreaterThan(0);
      expect(explains, `${name}：${stops} 次停止加载只有 ${explains} 次给出了说明`).toBe(stops);
    }
  });

  it("快捷登录被拒时说「本机没开免密」，其它原因照实说", () => {
    const src = pageSource();
    expect(src).toContain("notice.userInput ? '本地快捷登录未启用，请输入管理密码' : notice.message");
  });
});
