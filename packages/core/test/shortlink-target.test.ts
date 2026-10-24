/**
 * 短链 `/s/<code>` 的目标白名单（服务端这一份）。
 *
 * 三个入口共用这里的 `isInternalShortLinkTarget`：POST /api/shortlinks（入库）、
 * store 的 createShortLink（写闸）与 resolveShortLink（读回）。前端 `/s/[code]`
 * 路由还有一份同构实现（apps/web 不依赖 @navhub/core），用例表在
 * `apps/web-overlay/test/shortlink-target.test.ts` 里重复钉一次。
 */
import { describe, expect, it } from "vitest";
import { httpUrl, isInternalShortLinkTarget, MAX_SHORTLINK_TARGET_LENGTH } from "../src/mcp-schemas.ts";

const REJECTED_TARGETS: Array<[string, string]> = [
  ["/marketplace/../../admin", "点段规范化后落在 /admin，前缀字面量却过关"],
  ["/marketplace/x/../../../api/users", "同上：多层点段"],
  ["/marketplace/..\\..\\evil.example", "反斜杠被当成路径分隔符"],
  ["/marketplace/..\\./admin", "点段 + 反斜杠混写"],
  ["\\marketplace/x", "不以 /marketplace/ 开头"],
  ["//evil.example/marketplace/x", "协议相对地址：浏览器直接换域"],
  [" /\tmarketplace/x", "空格 + 制表符伪装前缀"],
  ["/marketplace/..\t./admin", "浏览器会先删掉 Tab 再解析，于是变成 ../ 遍历"],
  ["https://evil.example/marketplace/x", "绝对外链"],
  ["javascript:alert(1)", "伪协议"],
];

describe("isInternalShortLinkTarget：站内 /marketplace/ 白名单", () => {
  it.each(REJECTED_TARGETS)("%s 必须被拒绝（%s）", (target, why) => {
    expect(isInternalShortLinkTarget(target), why).toBe(false);
  });

  it("真实分享形态不得误伤", () => {
    for (const target of [
      "/marketplace/github-copilot-guide",
      "/marketplace/github-copilot-guide?install=1",
      "/marketplace/slug#a-section",
      "/marketplace/%E4%B8%AD%E6%96%87-slug",
    ]) {
      expect(isInternalShortLinkTarget(target)).toBe(true);
    }
  });

  it("长度上限保持 500（写入侧曾经用它单独判过一次）", () => {
    expect(MAX_SHORTLINK_TARGET_LENGTH).toBe(500);
    const boundary = `/marketplace/${"b".repeat(MAX_SHORTLINK_TARGET_LENGTH - 13)}`;
    expect(boundary.length).toBe(MAX_SHORTLINK_TARGET_LENGTH);
    expect(isInternalShortLinkTarget(boundary)).toBe(true);
    expect(isInternalShortLinkTarget(`${boundary}x`)).toBe(false);
  });
});

describe("httpUrl 的两条新增口径（与前端 safeHref 同一套）", () => {
  const field = httpUrl();
  const accepts = (value: string) => field.safeParse(value).success;
  const parsed = (value: string) => {
    const r = field.safeParse(value);
    return r.success ? r.data : null;
  };

  it("伪协议的控制字符变体仍然被拒（java\\nscript: 剥掉换行就是 javascript:）", () => {
    expect(accepts("java\tscript:alert(1)")).toBe(false);
    expect(accepts("java\nscript:alert(1)")).toBe(false);
    expect(accepts("javascript:alert(1)")).toBe(false);
  });

  it("zod 的 .url() 会按 WHATWG 口径规范化：入库值就是浏览器实际打开的值", () => {
    // 这条不是「放行控制字符」，而是把口径说清楚：Tab/LF/CR 在解析阶段就被删掉，
    // 所以我们校验的串和浏览器用的串是同一个。前端 safeHref 没有这层规范化，
    // 只能在渲染期显式拒绝（见 apps/web-overlay/src/lib/safe-url.ts）。
    expect(parsed("https://navhub.example/a\tb")).toBe("https://navhub.example/ab");
    expect(parsed("https://navhub.example/ ")).toBe("https://navhub.example/");
  });

  it("带 userinfo 的 URL 拒绝：显示的域名不是真正跳转的域名", () => {
    expect(accepts("https://navhub.example@evil.example")).toBe(false);
    expect(accepts("https://navhub.example:pw@evil.example/x")).toBe(false);
    expect(accepts("https://navhub.example:8443/a?b=1")).toBe(true);
  });
});
