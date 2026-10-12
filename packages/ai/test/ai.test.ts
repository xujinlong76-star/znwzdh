import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUARD,
  SsrfBlockedError,
  assertUrlShape,
  guardedFetch,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
} from "../src/ssrf.ts";
import { absolutize, extractMetadata } from "../src/metadata.ts";
import {
  EnrichmentSchema,
  enrichUrl,
  heuristicCategory,
  heuristicTags,
  stripCodeFence,
} from "../src/enrich.ts";

const BT = String.fromCharCode(96);
const FENCE = BT.repeat(3);
const Q = String.fromCharCode(34);

describe("SSRF: IPv4 网段判定", () => {
  const blocked = [
    "127.0.0.1", "127.1.2.3", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254",
    "192.168.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "0.1.2.3",
    "224.0.0.1", "239.255.255.255", "255.255.255.255", "198.18.0.1", "198.51.100.7", "203.0.113.9",
  ];
  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "151.101.1.69", "172.15.0.1", "172.32.0.1", "192.169.0.1"];

  it("拦截环回/私网/链路本地/组播/保留网段", () => {
    for (const ip of blocked) expect(isBlockedIpv4(ip), ip).toBe(true);
  });

  it("放行正常公网地址", () => {
    for (const ip of allowed) expect(isBlockedIpv4(ip), ip).toBe(false);
  });

  it("169.254.169.254 被拦截（云元数据端点，SSRF 经典目标）", () => {
    expect(isBlockedIpv4("169.254.169.254")).toBe(true);
  });
});

describe("SSRF: IPv6 网段判定", () => {
  it("拦截环回、未指定、链路本地、ULA、组播", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1"]) {
      expect(isBlockedIpv6(ip), ip).toBe(true);
    }
  });

  it("拦截 IPv4 映射地址（::ffff:127.0.0.1 不能绕过）", () => {
    expect(isBlockedIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIpv6("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIpv6("::ffff:7f00:1")).toBe(true);
    expect(isBlockedIpv6("::ffff:8.8.8.8")).toBe(false);
  });

  it("放行公网 IPv6", () => {
    expect(isBlockedIpv6("2001:4860:4860::8888")).toBe(false);
  });

  it("非法 IP 一律视为不安全（fail closed）", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("999.1.1.1")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("SSRF: URL 形态校验", () => {
  it("只允许 http/https", () => {
    expect(() => assertUrlShape("file:///etc/passwd")).toThrow(SsrfBlockedError);
    expect(() => assertUrlShape("gopher://x/1")).toThrow(SsrfBlockedError);
    expect(() => assertUrlShape("ftp://x/y")).toThrow(SsrfBlockedError);
    expect(assertUrlShape("https://example.com").hostname).toBe("example.com");
    expect(assertUrlShape("http://example.com").protocol).toBe("http:");
  });

  it("非法 URL 抛 SsrfBlockedError 而不是 TypeError", () => {
    expect(() => assertUrlShape("not a url")).toThrow(SsrfBlockedError);
  });
});

describe("SSRF: 端到端拦截", () => {
  it("字面私网 IP 被拒绝，且不发出请求", async () => {
    for (const target of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/"]) {
      await expect(guardedFetch(target)).rejects.toThrow(SsrfBlockedError);
    }
  });

  it("file:// 协议被拒绝", async () => {
    await expect(guardedFetch("file:///C:/Windows/win.ini")).rejects.toThrow(SsrfBlockedError);
  });

  it("allowPrivateNetworks=true 时才放行私网（NAS 内网导航站的显式开关）", async () => {
    await expect(
      guardedFetch("http://127.0.0.1:1/", { allowPrivateNetworks: true, timeoutMs: 1500 }),
    ).rejects.not.toThrow(SsrfBlockedError);
  });

  it("默认防护参数保守", () => {
    expect(DEFAULT_GUARD.timeoutMs).toBe(10_000);
    expect(DEFAULT_GUARD.maxBytes).toBe(2 * 1024 * 1024);
    expect(DEFAULT_GUARD.maxRedirects).toBe(3);
    expect(DEFAULT_GUARD.allowPrivateNetworks).toBe(false);
  });
});

describe("HTML 元数据抽取", () => {
  const html = [
    "<html lang=" + Q + "zh-CN" + Q + "><head>",
    "<title>站点标题</title>",
    "<meta name=" + Q + "description" + Q + " content=" + Q + "这是描述&amp;更多" + Q + ">",
    "<meta property=" + Q + "og:title" + Q + " content=" + Q + "OG 标题" + Q + ">",
    "<meta property=" + Q + "og:description" + Q + " content=" + Q + "OG 描述" + Q + ">",
    "<meta property=" + Q + "og:image" + Q + " content=" + Q + "/cover.png" + Q + ">",
    "<meta name=" + Q + "theme-color" + Q + " content=" + Q + "#0f172a" + Q + ">",
    "<link rel=" + Q + "icon" + Q + " href=" + Q + "/favicon-32.png" + Q + ">",
    "</head><body></body></html>",
  ].join("");

  it("优先取 og:* 而不是 <title>", () => {
    const m = extractMetadata(html, "https://example.com/page");
    expect(m.title).toBe("OG 标题");
    expect(m.description).toBe("OG 描述");
  });

  it("相对路径被解析成绝对 URL", () => {
    const m = extractMetadata(html, "https://example.com/page");
    expect(m.icon).toBe("https://example.com/favicon-32.png");
    expect(m.image).toBe("https://example.com/cover.png");
  });

  it("解析 lang 与 theme-color", () => {
    const m = extractMetadata(html, "https://example.com");
    expect(m.lang).toBe("zh-CN");
    expect(m.themeColor).toBe("#0f172a");
  });

  it("HTML 实体被解码", () => {
    const m = extractMetadata("<title>a&amp;b</title>", "https://x.com");
    expect(m.title).toBe("a&b");
  });

  it("没有 icon 时回退到 /favicon.ico", () => {
    const m = extractMetadata("<head><title>t</title></head>", "https://x.com/a/b");
    expect(m.icon).toBe("https://x.com/favicon.ico");
  });

  it("content 在 name 之前也能解析（属性顺序无关）", () => {
    const m = extractMetadata("<meta content=" + Q + "前置属性" + Q + " name=" + Q + "description" + Q + ">", "https://x.com");
    expect(m.description).toBe("前置属性");
  });

  it("absolutize 对非法输入不抛错", () => {
    expect(absolutize(null, "https://x.com")).toBeNull();
    expect(absolutize("http://[bad", "https://x.com")).toBe("http://[bad");
  });
});

describe("AI 富化：启发式降级路径", () => {
  it("没有 API Key 时使用启发式，并如实标注 provenance", async () => {
    const r = await enrichUrl("http://127.0.0.1:9/", { llm: { apiKey: null } });
    expect(r.provenance).toBe("heuristic");
    expect(r.title).toBeTruthy();
    expect(r.warnings.some((w) => w.includes("未配置 LLM"))).toBe(true);
  });

  it("抓取失败时也不抛错，而是记入 warnings", async () => {
    const r = await enrichUrl("http://127.0.0.1:9/", { heuristicOnly: true, guard: { timeoutMs: 800 } });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.httpStatus).toBeNull();
  });

  it("分类规则命中最相关的类目", () => {
    expect(heuristicCategory("GitHub Copilot AI 代码补全")).toBe("AI 工具");
    expect(heuristicCategory("全国天气预报查询")).toBe("生活服务");
    expect(heuristicCategory("Docker 容器镜像仓库")).toBe("开发运维");
  });

  it("标签抽取包含规则命中与拉丁词，且有上限", () => {
    const tags = heuristicTags("Figma UI 设计协作工具 figma-plugin");
    expect(tags).toContain("设计");
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it("LLM 输出的 schema 校验会拒绝残缺结构", () => {
    expect(EnrichmentSchema.safeParse({ title: "t" }).success).toBe(false);
    expect(EnrichmentSchema.safeParse({
      title: "t", description: "足够长的描述文本", tags: ["a"], keywords: ["b"], category: "c",
    }).success).toBe(true);
  });

  it("stripCodeFence 剥掉 markdown 代码块", () => {
    const wrapped = FENCE + "json\n" + '{"a":1}' + "\n" + FENCE;
    expect(stripCodeFence(wrapped)).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
    expect(stripCodeFence('这里是结果：\n' + wrapped + '\n祝使用愉快！')).toBe('{"a":1}');
    expect(stripCodeFence('请看：{"a":1} 已经生成完成')).toBe('{"a":1}');
  });
});
