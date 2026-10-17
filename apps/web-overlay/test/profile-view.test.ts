/**
 * 「我的偏好」不能在取回失败时说「你没有画像」。
 *
 * 改动前：`catch` 里只 `setProfile(null)`，界面于是走同一个分支渲染
 * 「暂无个性化画像。搜索并收藏几个站点后…」。中枢连不上时，这句话把**故障**说成了
 * **事实** —— 用户会以为自己的行为数据没被记录，而不是「这次没取到」。
 *
 * 这里守住三件事：
 *   1. 三态判定的优先级正确（加载中 > 失败 > 空 > 有内容）；
 *   2. 失败文案与空文案不可能混淆（失败文案里没有「暂无」，空文案里没有「失败」）；
 *   3. 页面确实把错误记下来了（`setLoadError(error)`），并提供重试入口。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROFILE_EMPTY_MESSAGE,
  profileDegradeNotice,
  profileViewState,
} from "../src/lib/profile-view";

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
const PAGE = join(ROOT, "src/app/preferences/page.tsx");

function pageSource(): string {
  return readFileSync(PAGE, "utf8");
}

describe("profileViewState：优先级", () => {
  const base = { loading: false, failed: false, hasProfile: false };

  it("加载中最高：点重试时应回到「加载中…」，而不是继续挂着上一次的红字", () => {
    expect(profileViewState({ ...base, loading: true, failed: true })).toBe("loading");
  });

  it("失败优先于空：这是本次修的核心", () => {
    expect(profileViewState({ ...base, failed: true })).toBe("degraded");
  });

  it("只有「没失败且确实为空」才是空", () => {
    expect(profileViewState(base)).toBe("empty");
  });

  it("有内容且没失败才是 ready", () => {
    expect(profileViewState({ ...base, hasProfile: true })).toBe("ready");
  });

  it("失败 + 有内容（重试前的残留）仍算失败，不会拿旧画像冒充当前状态", () => {
    expect(profileViewState({ loading: false, failed: true, hasProfile: true })).toBe("degraded");
  });
});

describe("两套文案不能互相串味", () => {
  it("失败文案：说清原因，并明确「这不代表你没有画像」", () => {
    const notice = profileDegradeNotice(new Error("NavHub 服务暂时不可用，请稍后重试"));
    expect(notice.message).toContain("未能取回你的个性化画像");
    expect(notice.message).toContain("NavHub 服务暂时不可用");
    expect(notice.hint).toContain("不代表");
    expect(notice.hint).toContain("没有画像");
    expect(notice.retryable).toBe(true);
  });

  it("失败文案里不允许出现「暂无」这类事实陈述", () => {
    const notice = profileDegradeNotice(new Error("boom"));
    expect(notice.message).not.toContain("暂无");
    expect(notice.hint).not.toContain("暂无");
  });

  it("网络层失败（无状态码）也给出可行动的原因", () => {
    const notice = profileDegradeNotice(new TypeError("Failed to fetch"));
    expect(notice.retryable).toBe(true);
    expect(notice.message.length).toBeGreaterThan(10);
  });

  it("401/403 不提供重试按钮（重试没有意义），并指向 Token 设置", () => {
    const err = Object.assign(new Error(""), { status: 401 });
    const notice = profileDegradeNotice(err);
    expect(notice.retryable).toBe(false);
    expect(notice.message).toContain("API Token");
  });

  it("空文案是「暂无」，且不夹带故障措辞", () => {
    expect(PROFILE_EMPTY_MESSAGE).toContain("暂无个性化画像");
    for (const word of ["失败", "不可用", "中枢", "重试"]) {
      expect(PROFILE_EMPTY_MESSAGE).not.toContain(word);
    }
  });
});

describe("页面接线（防止回退成「失败即空」）", () => {
  it("页面把错误记下来了，而不是只清空画像", () => {
    const src = pageSource();
    expect(src).toContain("setLoadError(error)");
    expect(src).toContain("setLoadError(null)");
    expect(src).toContain("useState<unknown>(null)");
  });

  it("页面用纯函数判定三态，且不再内联那句「暂无个性化画像」", () => {
    const src = pageSource();
    expect(src).toContain("profileViewState({");
    expect(src).toContain("view === 'degraded'");
    // 文案必须来自 lib，避免两处文案各自漂移
    expect(src).not.toContain("暂无个性化画像");
    expect(src).toContain("PROFILE_EMPTY_MESSAGE");
  });

  it("降级分支有重试入口（点了会重新请求）", () => {
    const src = pageSource();
    expect(src).toContain("handleRetry");
    expect(src).toContain("重试");
    expect(src).toContain("void load(identity)");
  });

  it("重试时先清错误再加载（否则红字会盖住「加载中」）", () => {
    const src = pageSource();
    const retry = src.slice(src.indexOf("const handleRetry"));
    const body = retry.slice(0, retry.indexOf("}", retry.indexOf("void load(identity)")));
    expect(body.indexOf("setLoadError(null)")).toBeGreaterThan(-1);
    expect(body.indexOf("setLoading(true)")).toBeGreaterThan(-1);
    expect(body.indexOf("setLoadError(null)")).toBeLessThan(body.indexOf("void load(identity)"));
  });
});
