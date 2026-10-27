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
import { describe, expect, it } from "vitest";
import { SsrfBlockedError, assertUrlShape, isBlockedIp, isBlockedIpv4, isBlockedIpv6 } from "../src/ssrf.ts";

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
