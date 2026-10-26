/**
 * 内容级防劫持：**响应被截断时不得用正文长度下结论**。
 *
 * 缺陷来源（实测复现，非推测）：
 *   采集器只读前 8KB。判定规则里「命中 1 个停放关键词且正文 < 300 字」→ 疑似停放。
 *   在截断响应上，textLength 反映的是**采集宽度**而非**页面内容量**，
 *   于是 MDN 的「403 Forbidden」说明页（正文 150 字）被判成疑似停放，
 *   「404 Not Found」说明页被判成软 404 —— 两页都是完全正常的文档页。
 *
 * 判据反过来更简单：**能超过 8KB HTML 的页面不可能是「一页域名出售」**。
 * 所以截断时只保留强证据（≥2 个关键词、视觉哈希吻合），不再用正文长度加权。
 */
import { describe, expect, it } from "vitest";
import { auditPageHealth } from "../src/health-sentinel.ts";

/** 构造一个「正文够长、能过 THIN_CONTENT 与低熵两条线」的文档页正文 */
const DOC_BODY =
  "HTTP 状态码 403 Forbidden 表示服务器理解了请求但拒绝执行。常见原因包括身份验证失败、" +
  "权限不足、来源 IP 被限制、防盗链策略、以及服务器端访问控制列表阻止了当前客户端。" +
  "处理方式是检查凭据与授权配置，必要时联系站点管理员申请访问权限。";

const html = (body: string) => `<html><head><title>403</title></head><body><p>${body}</p></body></html>`;

describe("auditPageHealth：截断样本不能当完整页面判", () => {
  it("基线：同一段正文、未截断时，1 个关键词 + 正文短仍判疑似停放", () => {
    const r = auditPageHealth("https://developer.mozilla.org/zh-CN/docs/403", html(DOC_BODY));
    expect(r.truncated).toBe(false);
    expect(r.status).toBe("SUSPICIOUS_PARKED");
  });

  it("截断时同一条不再成立：文档页必须是 HEALTHY", () => {
    const r = auditPageHealth("https://developer.mozilla.org/zh-CN/docs/403", html(DOC_BODY), undefined, undefined, {
      truncated: true,
    });
    expect(r.truncated).toBe(true);
    expect(r.status).toBe("HEALTHY");
  });

  it("强证据不受影响：命中 2 个停放关键词时，截断也照常判疑似停放", () => {
    const parked = "This domain for sale. Inquire about this domain today.";
    const r = auditPageHealth("https://parked.example/", html(parked), undefined, undefined, { truncated: true });
    expect(r.status).toBe("SUSPICIOUS_PARKED");
  });

  it("正文极短且被截断时，不说「内容极度匮乏」，置信度下调", () => {
    const r = auditPageHealth("https://vercel.com/", html("Skip to content"), undefined, undefined, {
      truncated: true,
    });
    expect(r.status).toBe("THIN_CONTENT");
    expect(r.reason).toContain("截断");
    expect(r.reason).not.toContain("极度匮乏");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("未截断时正文极短，仍然如实说出「内容极度匮乏」", () => {
    const r = auditPageHealth("https://x.example/", html("Skip to content"));
    expect(r.status).toBe("THIN_CONTENT");
    expect(r.reason).toContain("极度匮乏");
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});
