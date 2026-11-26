/**
 * SSRF 防护策略的契约测试（此前这个模块一行测试都没有）。
 *
 * 为什么值得单独锁：这是全系统唯一的「用户可控输入 → 服务端发请求」路径。
 * 这里的每一个 if 都对应一条真实的绕过手法：
 *   - `127.0.0.1.nip.io` 这类域名解析到内网 → 必须校验解析后的 IP；
 *   - `::ffff:127.0.0.1`、`0:0:0:0:0:ffff:7f00:1` 是同一地址的不同写法 → 必须真解析；
 *   - `http://169.254.169.254` 云元数据 → 链路本地必须拦；
 *   - `http://host:6379` 打内网 Redis → 危险端口必须拦。
 */
import { describe, expect, it, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import {
  DEFAULT_GUARD,
  SsrfBlockedError,
  assertUrlShape,
  guardedFetch,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  isAlwaysBlockedIp,
  isTrustedHost,
  resolveAndCheck,
} from "../src/ssrf.ts";

// 环境无关性（2026-11-24）：DNS 劫持环境（VPN/TUN 网关合成地址）会把 *.invalid
// 也解析到假 IP（本机实测 198.20.2.x），RFC 2606「.invalid 永不解析」不成立——
// 「解析失败 fail-closed」的断言会随环境翻转。这里用 lookup 桩把 .invalid 钉成
// ENOTFOUND（等价不可解析），其余主机名照常走真实解析，断言不再依赖本机 DNS。
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: (hostname: string, options?: unknown) => {
      if (hostname.endsWith(".invalid")) {
        return Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
      }
      // 私网放行回归使用受控 DNS 响应，不访问外网，也不改动 /etc/hosts。
      if (["private.example.test", "mixed.example.test"].includes(hostname)) {
        return Promise.resolve(answers.get(hostname) ?? []);
      }
      return actual.lookup(hostname, options as never);
    },
  };
});

// allowPrivateNetworks 回归的受控 DNS 响应（普通私网/混合云元数据）。
const answers = new Map<string, Array<{ address: string; family: number }>>();

// mock 卫生（mock-hygiene 门禁）：isolate:false 下 vi.mock 会跨文件泄漏，
// afterAll 里 resetModules 还原模块注册表，不把 node:dns 桩带给后续测试文件。
afterAll(() => {
  answers.clear();
  vi.resetModules();
});

describe("IPv4 网段", () => {
  const blocked = [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "100.64.0.1", // CGNAT
    "169.254.169.254", // 云元数据
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.0.1", // IETF 保留
    "192.0.2.5", // TEST-NET-1
    "192.88.99.1", // 6to4 中继
    "198.18.0.1", // 基准测试
    "198.18.246.9", // 基准测试：本机网关合成地址（U-284 实测 weibo.com 所落地址）
    "198.51.100.7", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "224.0.0.1", // 组播
    "240.0.0.1", // 保留
    "255.255.255.255",
  ];

  it.each(blocked)("%s 必须被拦", (ip) => {
    expect(isBlockedIpv4(ip)).toBe(true);
  });

  const allowed = [
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "192.0.1.1", // 与 192.0.0.0/24 相邻但属于正常公网（曾因只比前两段被误杀）
    "172.32.0.1", // 172.16/12 之外
    "100.63.255.255", // CGNAT 之外
    "100.128.0.1",
  ];

  it.each(allowed)("%s 不能被误杀", (ip) => {
    expect(isBlockedIpv4(ip)).toBe(false);
  });
});

describe("IPv6 网段与内嵌 IPv4", () => {
  const blocked = [
    "::1",
    "::",
    "fe80::1", // 链路本地
    "febf::1", // 链路本地上边界
    "fec0::1", // 站点本地
    "feff::1", // 站点本地上边界
    "fc00::1", // 唯一本地
    "fd12:3456::1", // 唯一本地
    "ff02::1", // 组播
    "2001:db8::1", // 文档
    "2002:7f00:1::1", // 6to4
    "2001:0:53aa::1", // Teredo
    "64:ff9b::7f00:1", // NAT64 内嵌 127.0.0.1
    "::ffff:127.0.0.1", // 映射写法
    "::ffff:7f00:1", // 同一地址的十六进制写法
    "0:0:0:0:0:ffff:127.0.0.1", // 又一种写法
    "::127.0.0.1", // 已废弃的 v4 兼容写法，Linux 上仍可路由
  ];

  it.each(blocked)("%s 必须被拦", (ip) => {
    expect(isBlockedIpv6(ip)).toBe(true);
  });

  it("公网 IPv6 不误杀", () => {
    expect(isBlockedIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIpv6("2a00:1450:4001:80f::200e")).toBe(false);
    expect(isBlockedIpv6("fe7f::1")).toBe(false);
  });

  it("解析不了的串按 fail-closed 处理", () => {
    expect(isBlockedIpv6("not-an-ip")).toBe(true);
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("URL 形态：协议 / 凭证 / 危险端口", () => {
  it.each([
    "http://example.com:22/",
    "http://example.com:6379/",
    "http://example.com:2375/containers/json",
    "http://example.com:6443/api",
    "http://example.com:9200/_cat/indices",
    "https://example.com:10250/pods",
  ])("危险端口被拒：%s", (url) => {
    expect(() => assertUrlShape(url)).toThrow(SsrfBlockedError);
  });

  it.each(["https://example.com/", "http://example.com:8080/x", "https://example.com:8443/"])(
    "正常端口放行：%s",
    (url) => {
      expect(() => assertUrlShape(url)).not.toThrow();
    },
  );

  it("非 http/https 协议被拒", () => {
    expect(() => assertUrlShape("file:///etc/passwd")).toThrow(SsrfBlockedError);
    expect(() => assertUrlShape("gopher://example.com/")).toThrow(SsrfBlockedError);
  });

  it("带凭证的 URL 被拒（避免把 Basic Auth 带进日志与跳转）", () => {
    expect(() => assertUrlShape("https://user:pass@example.com/")).toThrow(SsrfBlockedError);
  });

  it("错误原因可读且带分类（界面按 reason 给不同提示）", () => {
    try {
      assertUrlShape("http://example.com:6379/");
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfBlockedError);
      expect((err as SsrfBlockedError).reason).toBe("blocked-port");
      expect((err as SsrfBlockedError).message).toContain("禁止访问该端口");
    }
  });
});

describe("allowPrivateNetworks 仍校验并钉扎 DNS 结果", () => {
  it.each([
    ["::1", false],
    ["::", true],
    ["fd00:ec2::254", true],
    ["FD00:EC2:0:0:0:0:0:0254", true],
    ["fe80:0:0:0:0:0:0:1", true],
    ["::ffff:169.254.169.254", true],
    ["::ffff:a9fe:a9fe", true],
    ["::169.254.169.254", true],
    ["::a9fe:a9fe", true],
    ["64:ff9b::169.254.169.254", true],
    ["64:ff9b::a9fe:a9fe", true],
    ["64:ff9b:1::169.254.169.254", true],
    ["64:ff9b:1::a9fe:a9fe", true],
    ["64:ff9b::8.8.8.8", false],
    ["::ffff:8.8.8.8", false],
    ["fd12:3456::1", false],
    ["not-an-ip", true],
  ])("无条件封锁判定 %s = %s", (ip, blocked) => {
    expect(isAlwaysBlockedIp(ip)).toBe(blocked);
  });

  it("字面私网 IP 返回可 pin 值，普通 IPv6 ULA 仍放行", async () => {
    const opts = { ...DEFAULT_GUARD, allowPrivateNetworks: true };
    await expect(resolveAndCheck(new URL("http://127.0.0.1/"), opts)).resolves.toEqual(["127.0.0.1"]);
    await expect(resolveAndCheck(new URL("http://[fd12:3456::1]/"), opts)).resolves.toEqual(["fd12:3456::1"]);
    await expect(resolveAndCheck(new URL("http://[fd00:ec2::254]/"), opts)).rejects.toMatchObject({
      name: "SsrfBlockedError",
      reason: "blocked-ip",
    });
    for (const ip of ["::a9fe:a9fe", "64:ff9b::a9fe:a9fe", "64:ff9b:1::a9fe:a9fe"]) {
      await expect(resolveAndCheck(new URL(`http://[${ip}]/`), opts)).rejects.toMatchObject({
        name: "SsrfBlockedError",
        reason: "blocked-ip",
      });
    }
  });

  it("域名仍解析，全部普通私网结果通过并返回 pin 清单", async () => {
    answers.set("private.example.test", [
      { address: "127.0.0.1", family: 4 },
      { address: "fd12:3456::1", family: 6 },
    ]);
    await expect(resolveAndCheck(new URL("http://private.example.test/"), {
      ...DEFAULT_GUARD,
      allowPrivateNetworks: true,
    })).resolves.toEqual(["127.0.0.1", "fd12:3456::1"]);
  });

  it.each(["169.254.169.254", "fd00:ec2::254", "fe80::1"])(
    "任一 DNS 结果命中 %s 即拒绝整个域名",
    async (blocked) => {
      answers.set("mixed.example.test", [
        { address: "10.0.0.8", family: 4 },
        { address: blocked, family: blocked.includes(":") ? 6 : 4 },
      ]);
      await expect(resolveAndCheck(new URL("http://mixed.example.test/"), {
        ...DEFAULT_GUARD,
        allowPrivateNetworks: true,
      })).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "blocked-ip" });
    },
  );
});

describe("trustedHosts 精确主机名白名单（U-284）", () => {
  // 背景：本机出口网关把外域名解析到合成地址 198.18.246.x（198.18.0.0/15
  // 基准测试段），无白名单时 resolveAndCheck 全拦。白名单只跳过 DNS-IP
  // 校验，协议/端口/凭证/重定向逐跳校验一律保留。
  // 环境无关写法：白名单命中时根本不做 DNS；未命中时只断言抛
  // SsrfBlockedError，不限定 reason（本机是 blocked-ip，外网是 dns-failure）。

  it("isTrustedHost 只认精确主机名（大小写不敏感，无后缀/通配）", () => {
    const list = ["weibo.com"];
    expect(isTrustedHost("weibo.com", list)).toBe(true);
    expect(isTrustedHost("WEIBO.COM", list)).toBe(true);
    expect(isTrustedHost("sub.weibo.com", list)).toBe(false);
    expect(isTrustedHost("evil-weibo.com", list)).toBe(false);
    expect(isTrustedHost("weibo.com.evil.com", list)).toBe(false);
    expect(isTrustedHost("weibo.com", undefined)).toBe(false);
    expect(isTrustedHost("weibo.com", [])).toBe(false);
  });

  it("白名单主机：跳过 DNS-IP 校验，不抛错", async () => {
    const ips = await resolveAndCheck(new URL("https://weibo.com/ajax/side/hotSearch"), {
      ...DEFAULT_GUARD,
      trustedHosts: ["weibo.com"],
    });
    expect(ips).toEqual([]);
  });

  it("未列名主机：仍走 DNS 校验，解析失败也 fail-closed", async () => {
    // .invalid 在干净 DNS 下不可解析（RFC 2606）；被劫持环境由文件顶部的
    // lookup 桩钉成 ENOTFOUND，两种环境都应抛 SsrfBlockedError（fail-closed）
    await expect(
      resolveAndCheck(new URL("https://nonexistent.invalid/"), {
        ...DEFAULT_GUARD,
        trustedHosts: ["weibo.com"],
      }),
    ).rejects.toThrow(SsrfBlockedError);
    await expect(
      resolveAndCheck(new URL("https://nonexistent.invalid/"), { ...DEFAULT_GUARD }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("白名单不适用于字面 IP：198.18.246.9 写进白名单也照拦", async () => {
    await expect(
      resolveAndCheck(new URL("http://198.18.246.9/"), {
        ...DEFAULT_GUARD,
        trustedHosts: ["198.18.246.9"],
      }),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("guardedFetch 全程走白名单：不做 DNS-IP 校验，响应照常返回", async () => {
    // 用 localhost 的精确白名单验证完整调用路径；命中后不执行 dns.lookup，
    // 由 Node 按显式信任的主机名完成连接（不再依赖可被全局桩替换的 fetch）。
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await guardedFetch(`http://localhost:${port}/ajax/side/hotSearch`, {
        ...DEFAULT_GUARD,
        timeoutMs: 2000,
        trustedHosts: new Set(["localhost"]),
      });
      expect(res.status).toBe(200);
      expect(res.body).toContain("ok");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("guardedFetch：白名单外主机不做 DNS 就放行不了（.invalid 抛错）", async () => {
    const stub = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", stub);
    try {
      await expect(
        guardedFetch("https://nonexistent.invalid/", { ...DEFAULT_GUARD }),
      ).rejects.toThrow(SsrfBlockedError);
      expect(stub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
