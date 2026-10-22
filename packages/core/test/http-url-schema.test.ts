/**
 * 站点入库 URL 的协议白名单。
 *
 * `z.string().url()` 只要求「能解析成绝对 URL」，`javascript:` / `data:` / `file:`
 * 这些伪协议全部通过（本机 zod 4.6.7 实测）。而 MCP 的 create_site / batch_import
 * 是 parse 完直接 `repo.createSite` 入库，REST 投稿与站点创建同源，入库后：
 *   - 前端渲染 `<a href>` → 点击即执行脚本（存储型 XSS）；
 *   - 投稿队列里审核员点开的是一条 pending 记录 → 打穿的是管理员自己的浏览器；
 *   - 书签导出 / `canonicalizeUrl`（非 http 原样返回，见下方最后一条断言）
 *     会把它当正常站点一路带到下游。
 * 所以白名单必须钉在契约层：REST body、MCP inputSchema、OpenAPI 文档共用同一份。
 */
import { describe, expect, it } from "vitest";
import { BatchImportInput, CreateSiteInput, httpUrl, SiteCreateBody } from "../src/mcp-schemas.ts";
import { canonicalizeUrl } from "../src/types.ts";
import { zodSchemaToJsonSchema } from "../src/json-schema.ts";

const PSEUDO_PROTOCOLS = [
  "javascript:alert(1)",
  "javascript:void(0)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "blob:https://example.com/1234abcd",
  "chrome-extension://abcdefghijklmnop/背景.html",
  "about:blank",
];

describe("CreateSiteInput.url 协议白名单", () => {
  it.each(PSEUDO_PROTOCOLS)("%s 必须被拒绝", (url) => {
    expect(CreateSiteInput.safeParse({ url }).success).toBe(false);
  });

  it("http / https 正常地址不得误伤", () => {
    for (const url of ["http://example.com", "https://example.com/a?b=1#c", "https://xn--fiqs8s.cn/"]) {
      expect(CreateSiteInput.safeParse({ url }).success).toBe(true);
    }
  });

  it("相对地址仍然被拒（白名单不能顺手放宽 .url()）", () => {
    expect(CreateSiteInput.safeParse({ url: "/just-a-path" }).success).toBe(false);
    expect(CreateSiteInput.safeParse({ url: "example.com" }).success).toBe(false);
  });
});

describe("同源派生的其它入口", () => {
  it("batch_import 的嵌套 sites[].url 同样拒收伪协议", () => {
    const bad = BatchImportInput.safeParse({ sites: [{ url: "https://ok.com" }, { url: "javascript:alert(1)" }] });
    expect(bad.success).toBe(false);
    expect(BatchImportInput.safeParse({ sites: [{ url: "https://ok.com" }] }).success).toBe(true);
  });

  it("REST 的 SiteCreateBody 由 CreateSiteInput.omit() 派生，白名单必须跟着走", () => {
    // omit() 会保留字段上的 checks；若哪天派生关系被拆成两份手写清单，这条会红
    const body = { categoryId: "c1", url: "javascript:alert(document.cookie)" };
    expect(SiteCreateBody.safeParse(body).success).toBe(false);
    expect(SiteCreateBody.safeParse({ ...body, url: "https://ok.com" }).success).toBe(true);
  });

  it("关联站 targetUrl 与深链模板同样拒收伪协议", () => {
    const badRelation = { categoryId: "c1", url: "https://ok.com", relations: [{ targetTitle: "官网", targetUrl: "javascript:alert(1)", relationType: "related" }] };
    expect(SiteCreateBody.safeParse(badRelation).success).toBe(false);
    const badAction = { categoryId: "c1", url: "https://ok.com", actions: [{ id: "a", label: "搜", urlTemplate: "data:text/html,x" }] };
    expect(SiteCreateBody.safeParse(badAction).success).toBe(false);
    // {q} 占位符必须继续合法：种子数据里的深链模板全是这种形态
    const ok = { ...badAction, actions: [{ id: "a", label: "搜", urlTemplate: "https://github.com/search?q={q}&type=repositories" }] };
    expect(SiteCreateBody.safeParse(ok).success).toBe(true);
  });
});

describe("契约改动的副作用边界", () => {
  it("refine 不进 JSON Schema，OpenAPI / MCP 文档不被降级成 {}", () => {
    // json-schema.ts 用 unrepresentable: "any"：自定义校验无法表达时该字段会退化成 {}，
    // 文档就再也看不出这是个 URI。zod 4 把 refine 存进 _def.checks，因此 format 应保留。
    const js = zodSchemaToJsonSchema(CreateSiteInput);
    const props = js.properties as Record<string, Record<string, unknown>>;
    expect(props.url.format).toBe("uri");
    expect(props.url.type).toBe("string");
    expect(props.url.description).toBe("站点网址");
  });

  it("canonicalizeUrl 对非 http 原样返回：入库前的协议校验是唯一一道闸", () => {
    // 这条不是在测修复本身，而是钉住「为什么必须在校验层拦下」——下游规范化救不了伪协议
    expect(canonicalizeUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(canonicalizeUrl("https://Example.com:443/x?utm_source=a")).toBe("https://example.com/x");
  });

  it("httpUrl() 的提示语可自定义，错误信息直达调用方", () => {
    const r = httpUrl("只支持 http(s)").safeParse("javascript:alert(1)");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("只支持 http(s)");
  });
});
