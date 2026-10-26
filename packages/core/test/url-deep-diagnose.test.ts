/**
 * 深度取证判定单测。
 *
 * 这里刻意**不测网络**：判定层的职责就是把「采集到的事实」翻译成结论，
 * 所以每个用例只喂观测、只断言结论与证据链。采集层（guardedFetch）另有测试。
 *
 * 两条最有价值的防线：
 *   1. 超时 ≠ 死链：置信度必须显著低于 404/DNS 失败，否则运营会把「慢站」误删；
 *   2. 未采集的层必须 skip：不能让「没查」伪装成「查过且正常」。
 */
import { describe, expect, it } from "vitest";
import {
  computeReachabilityTrend,
  diagnoseUrlDeep,
  isTextualContentType,
  registrableDomain,
  type DeepProbeObservations,
} from "../src/url-deep-diagnose.ts";

const base: DeepProbeObservations = {
  url: "https://example.com/tools",
  status: 200,
  dnsOk: true,
  redirects: [],
  contentType: "text/html; charset=utf-8",
  bodySample:
    "<html><head><title>Example Tools</title></head><body>" +
    "<p>这是一个提供在线工具与文档的正常页面，包含足够的正文内容用于信息熵计算。</p>" +
    "<p>我们提供格式转换、文本处理、图片压缩等常用能力，并持续维护更新。</p>" +
    "</body></html>",
};

describe("URL 结构层", () => {
  it("非法 URL 直接判 unreachable，并给出修正动作", () => {
    const d = diagnoseUrlDeep({ url: "not a url" });
    expect(d.verdict).toBe("unreachable");
    expect(d.actions.map((a) => a.kind)).toContain("manual");
    expect(d.evidence[0]?.layer).toBe("url");
    expect(d.evidence[0]?.status).toBe("fail");
  });

  it("非 http/https 协议同样不可探活", () => {
    const d = diagnoseUrlDeep({ url: "ftp://files.example.com/a.zip" });
    expect(d.verdict).toBe("unreachable");
    expect(d.evidence[0]?.detail).toContain("ftp:");
  });

  it("IP 直连与非标准端口只降级为 warn，不改变可达结论", () => {
    const d = diagnoseUrlDeep({ ...base, url: "http://203.0.113.9:8080/" });
    const urlLayer = d.evidence.find((e) => e.layer === "url");
    expect(urlLayer?.status).toBe("warn");
    expect(urlLayer?.detail).toContain("IP 直连");
    expect(urlLayer?.detail).toContain("8080");
    expect(d.verdict).toBe("healthy");
  });
});

describe("连接层失败的类型区分", () => {
  it("DNS 解析失败判 expired-domain（动作含归档+替换+剔除）", () => {
    const d = diagnoseUrlDeep({
      url: "https://gone.example",
      dnsOk: false,
      error: "DNS 解析失败: gone.example",
      failureKind: "connect",
    });
    expect(d.verdict).toBe("expired-domain");
    expect(d.evidence.find((e) => e.layer === "dns")?.status).toBe("fail");
    const kinds = d.actions.map((a) => a.kind);
    expect(kinds).toContain("archive");
    expect(kinds).toContain("replace");
    expect(kinds).toContain("remove");
  });

  it("超时判 unreachable 但置信度显著低于硬失败（慢 ≠ 死）", () => {
    const timeoutDiag = diagnoseUrlDeep({
      url: "https://slow.example",
      failureKind: "timeout",
      error: "timeout",
      dnsOk: true,
    })
    const notFoundDiag = diagnoseUrlDeep({ url: "https://gone.example/page", status: 404, dnsOk: true })
    expect(timeoutDiag.verdict).toBe("unreachable")
    expect(timeoutDiag.confidence).toBeLessThan(0.6)
    expect(notFoundDiag.confidence).toBeGreaterThan(timeoutDiag.confidence + 0.2)
    expect(timeoutDiag.headline).toContain("不等于死链")
  })

  it("SSRF 拦截不当作站点故障，且不提供替换建议", () => {
    const d = diagnoseUrlDeep({
      url: "http://10.0.0.8/",
      failureKind: "ssrf-blocked",
      error: "目标地址受保护",
    })
    expect(d.verdict).toBe("unreachable")
    expect(d.evidence.find((e) => e.layer === "http")?.detail).toContain("SSRF")
    expect(d.actions.map((a) => a.kind)).toEqual(["manual"])
  })

  it("重定向超限判 redirect-hijack，并提示人工复现", () => {
    const d = diagnoseUrlDeep({
      url: "https://loop.example",
      failureKind: "redirect-limit",
      error: "超过重定向上限",
    })
    expect(d.verdict).toBe("redirect-hijack")
    expect(d.actions.map((a) => a.kind)).toContain("manual")
  })
});

describe("HTTP 状态层", () => {
  it("5xx 判 server-error（可恢复），不给剔除建议", () => {
    const d = diagnoseUrlDeep({ ...base, status: 503 })
    expect(d.verdict).toBe("server-error")
    expect(d.actions.map((a) => a.kind)).not.toContain("remove")
  })

  it("401/403/405/412/418/429 一律判 bot-blocked，不视为死链", () => {
    for (const status of [401, 403, 405, 412, 418, 429]) {
      const d = diagnoseUrlDeep({ ...base, status })
      expect(d.verdict, `status=${status}`).toBe("bot-blocked")
      expect(d.actions, `status=${status}`).toHaveLength(0)
    }
  })

  it("404 判 http-error；410 置信度更高", () => {
    const d404 = diagnoseUrlDeep({ ...base, status: 404 })
    const d410 = diagnoseUrlDeep({ ...base, status: 410 })
    expect(d404.verdict).toBe("http-error")
    expect(d410.verdict).toBe("http-error")
    expect(d410.confidence).toBeGreaterThan(d404.confidence)
    expect(d410.headline).toContain("永久移除")
  })
});

describe("内容层：停放页与软 404", () => {
  it("命中两个停放词 → parked（即使 HTTP 200）", () => {
    const d = diagnoseUrlDeep({
      ...base,
      bodySample:
        "<html><body><h1>This domain is for sale</h1><p>Buy this domain today. 域名出售</p></body></html>",
    })
    expect(d.verdict).toBe("parked")
    expect(d.evidence.find((e) => e.layer === "content")?.status).toBe("fail")
    expect(d.contentFacts?.matchedParkingKeywords.length).toBeGreaterThan(0)
  })

  it("命中「页面未找到」且正文很短 → soft-404", () => {
    const d = diagnoseUrlDeep({
      ...base,
      bodySample: "<html><body><h1>页面未找到</h1><p>请返回首页</p></body></html>",
    })
    expect(d.verdict).toBe("soft-404")
  })

  it("未采集响应体时内容层必须是 skip，不能伪装成通过", () => {
    const d = diagnoseUrlDeep({ ...base, bodySample: undefined })
    const contentLayer = d.evidence.find((e) => e.layer === "content")
    expect(contentLayer?.status).toBe("skip")
    expect(d.verdict).toBe("healthy")
    // 没做内容检测时，健康结论的置信度必须低于做过检测的
    const withContent = diagnoseUrlDeep(base)
    expect(d.confidence).toBeLessThan(withContent.confidence)
  })

  it("非 HTML 的 Content-Type 给 warn（下载直链被当网页收录）", () => {
    const d = diagnoseUrlDeep({ ...base, contentType: "application/pdf" })
    const warn = d.evidence.find((e) => e.layer === "http" && e.status === "warn")
    expect(warn?.detail).toContain("application/pdf")
  })

  /**
   * 截断感知。
   *
   * 起因是一次实测：10 个真实站点按 8KB 采集，nextjs.org 前 8192 字符里正文只有 134 个，
   * gov.cn 有 5048 个——同样过 THIN_CONTENT 的 60 字阈值，差别只在前 8KB 里塞了多少 inline CSS。
   * 所以「正文少」在截断状态里根本不是证据，只是还没读到。
   */
  it("响应被截断时，正文过少只记 skip 并说明原因，不下「内容匮乏」的结论", () => {
    const thinHtml = '<html><head><title>loading</title></head><body><div id="root"></div></body></html>'
    const truncated = diagnoseUrlDeep({
      ...base,
      bodySample: thinHtml,
      truncated: true,
    })
    const layer = truncated.evidence.find((e) => e.layer === "content")
    expect(layer?.status).toBe("skip")
    expect(layer?.detail).toContain("截断")

    // 同一个 HTML，若响应是完整的，那才是真的薄 → warn
    const complete = diagnoseUrlDeep({ ...base, bodySample: thinHtml })
    expect(complete.evidence.find((e) => e.layer === "content")?.status).toBe("warn")
  })

  it("截断只削弱「正文少」这一条，多个停放词命中仍照常判 fail", () => {
    // 注意：`domain is for sale` 并不包含关键词 `domain for sale`（多个 is），
    // 这里必须用真正命中 ≥2 个关键词的样本，否则测的是「1 个词 + 短正文」那条弱规则。
    const parked =
      "<html><body>This domain for sale. Inquire about this domain today. Additional filler text for length.</body></html>"
    const d = diagnoseUrlDeep({ ...base, bodySample: parked, truncated: true })
    expect(d.verdict).toBe("parked")
    expect(d.evidence.find((e) => e.layer === "content")?.status).toBe("fail")
  })

  /**
   * 单个关键词 + 截断，不再判停放。
   *
   * 实测背景：MDN 的「403 Forbidden」说明页正文只有 150 字（前 8KB 几乎全是标记与脚本），
   * 命中 1 个 `forbidden`，旧规则据此判「疑似停放」——文档页被当成域名出售页。
   * 判据是：能超过 8KB HTML 的页面不可能是「一页域名出售」，正文长度在截断样本上不代表内容量。
   */
  it("单个关键词 + 响应截断，不判停放（避免把技术文档当停放页）", () => {
    const docpage =
      "<html><body>HTTP 403 Forbidden 表示服务器理解了请求但拒绝执行。" +
      "常见原因包括身份验证失败、权限不足、来源 IP 被限制、防盗链策略，以及访问控制列表拦截。" +
      "处理方式是检查凭据与授权配置。</body></html>"
    const d = diagnoseUrlDeep({ ...base, bodySample: docpage, truncated: true })
    expect(d.verdict).not.toBe("parked")
    expect(d.evidence.find((e) => e.layer === "content")?.status).not.toBe("fail")
  })

  /**
   * 下载直链的误判路径。
   *
   * PDF/图片的字节经 TextDecoder 解码后是大量 U+FFFD，字符分布高度集中，
   * Shannon 熵必然很低 —— 如果照常跑正文检测，就会得出「疑似域名停放」。
   * 一个正常的 PDF 下载被标成停放页，随后还会被自动替换掉。
   */
  it("PDF 等非文本响应不做正文判定，不能因低熵被判成停放", () => {
    const binaryish = "%PDF-1.4\n" + "\uFFFD".repeat(400)
    const d = diagnoseUrlDeep({ ...base, contentType: "application/pdf", bodySample: binaryish })
    expect(d.verdict).not.toBe("parked")
    const layer = d.evidence.find((e) => e.layer === "content")
    expect(layer?.status).toBe("skip")
    expect(layer?.detail).toContain("不是可解析文本")
  })

  it("isTextualContentType：未声明按文本处理，二进制类型一律跳过", () => {
    expect(isTextualContentType(undefined)).toBe(true)
    expect(isTextualContentType(null)).toBe(true)
    expect(isTextualContentType("text/html; charset=utf-8")).toBe(true)
    expect(isTextualContentType("application/xhtml+xml")).toBe(true)
    expect(isTextualContentType("text/plain")).toBe(true)
    expect(isTextualContentType("application/pdf")).toBe(false)
    expect(isTextualContentType("image/png")).toBe(false)
    expect(isTextualContentType("application/zip")).toBe(false)
  })
});

describe("重定向层", () => {
  it("跳转到域名停放服务 → parked，且证据点明落点", () => {
    const d = diagnoseUrlDeep({
      ...base,
      finalUrl: "https://www.sedoparking.com/example.com",
      redirects: ["http://example.com/tools", "https://www.sedoparking.com/example.com"],
    })
    expect(d.verdict).toBe("parked")
    const redirect = d.evidence.find((e) => e.layer === "redirect")
    expect(redirect?.status).toBe("fail")
    expect(redirect?.detail).toContain("sedoparking.com")
  })

  it("跨主域跳转判 redirect-hijack（不冒充健康）", () => {
    const d = diagnoseUrlDeep({
      ...base,
      finalUrl: "https://ads.example.net/landing",
      redirects: ["https://ads.example.net/landing"],
    })
    expect(d.verdict).toBe("redirect-hijack")
    expect(d.evidence.find((e) => e.layer === "redirect")?.detail).toContain("跨主域跳转")
  })

  it("同主域跳转（www 前缀/子路径）不判劫持", () => {
    const d = diagnoseUrlDeep({
      ...base,
      url: "https://example.com/a",
      finalUrl: "https://www.example.com/b",
      redirects: ["https://www.example.com/b"],
    })
    expect(d.verdict).toBe("healthy")
    expect(d.evidence.find((e) => e.layer === "redirect")?.status).toBe("pass")
  })
});

describe("证据链与置信度", () => {
  it("六层证据齐备，未采集的 wayback 为 skip", () => {
    const d = diagnoseUrlDeep(base)
    const layers = d.evidence.map((e) => e.layer)
    for (const layer of ["url", "dns", "redirect", "http", "content", "wayback"]) {
      expect(layers, `缺少 ${layer} 层`).toContain(layer)
    }
    expect(d.evidence.find((e) => e.layer === "wayback")?.status).toBe("skip")
  })

  it("置信度恒在 0.3..0.98，且同一输入结果确定", () => {
    const samples: DeepProbeObservations[] = [
      base,
      { ...base, status: 404 },
      { ...base, status: 503 },
      { ...base, dnsOk: false },
      { ...base, bodySample: "<html><body>域名出售 此域名正在出售</body></html>" },
    ]
    for (const s of samples) {
      const a = diagnoseUrlDeep(s)
      const b = diagnoseUrlDeep(s)
      expect(a.confidence).toBeGreaterThanOrEqual(0.3)
      expect(a.confidence).toBeLessThanOrEqual(0.98)
      expect(a).toEqual(b)
    }
  })
});

describe("可注册主域抽取", () => {
  it("普通域名取后两段", () => {
    expect(registrableDomain("www.example.com")).toBe("example.com")
    expect(registrableDomain("a.b.example.co.jp")).toBe("example.co.jp")
  })

  it("二级公共后缀（com.cn / gov.uk）取三段", () => {
    expect(registrableDomain("www.moe.gov.cn")).toBe("moe.gov.cn")
    expect(registrableDomain("news.example.co.uk")).toBe("example.co.uk")
  })
});

describe("可达率趋势：斜率而非首尾差", () => {
  it("点数不足判 insufficient", () => {
    expect(computeReachabilityTrend([]).trend).toBe("insufficient")
    expect(computeReachabilityTrend([{ at: 1, reachability: 0.9 }]).trend).toBe("insufficient")
  })

  it("单调上升判 improving，且 delta 为首尾差", () => {
    const t = computeReachabilityTrend([
      { at: 1, reachability: 0.6 },
      { at: 2, reachability: 0.7 },
      { at: 3, reachability: 0.8 },
    ])
    expect(t.trend).toBe("improving")
    expect(t.delta).toBeCloseTo(0.2, 3)
  })

  it("中间抖动但整体上升仍判 improving（首尾差会被抖动误导）", () => {
    const t = computeReachabilityTrend([
      { at: 1, reachability: 0.5 },
      { at: 2, reachability: 0.95 },
      { at: 3, reachability: 0.5 },
      { at: 4, reachability: 0.52 },
      { at: 5, reachability: 0.9 },
    ])
    // 首尾差 +0.4 看起来「大幅改善」，但斜率只有约 +0.07/次；这里断言方向正确即可
    expect(t.trend).toBe("improving")
    expect(t.points).toBe(5)
  })

  it("长期微幅波动判 stable", () => {
    const t = computeReachabilityTrend([
      { at: 1, reachability: 0.9 },
      { at: 2, reachability: 0.905 },
      { at: 3, reachability: 0.9 },
      { at: 4, reachability: 0.902 },
    ])
    expect(t.trend).toBe("stable")
  })

  it("null 点被排除，不参与拟合", () => {
    const t = computeReachabilityTrend([
      { at: 1, reachability: null },
      { at: 2, reachability: 0.8 },
      { at: 3, reachability: null },
      { at: 4, reachability: 0.85 },
    ])
    expect(t.points).toBe(2)
    expect(t.trend).toBe("improving")
  })

  /**
   * 斜率以下标为 x 轴，方向完全取决于入参顺序。
   * 体检历史是从 audit_logs 倒序查出来的，调用方漏了 reverse 就会把
   * 「持续恶化」读成「持续改善」——而且两种结论看起来同样合理，不会被发现。
   */
  it("倒序传入也得出同一方向（排序由函数自己保证）", () => {
    const ascending = [
      { at: 1, reachability: 0.9 },
      { at: 2, reachability: 0.8 },
      { at: 3, reachability: 0.7 },
    ]
    const descending = [...ascending].reverse()
    const a = computeReachabilityTrend(ascending)
    const d = computeReachabilityTrend(descending)
    expect(a.trend).toBe("degrading")
    expect(d.trend).toBe("degrading")
    expect(d.slope).toBeCloseTo(a.slope, 4)
    expect(d.delta).toBeCloseTo(a.delta, 4)
  })
});
