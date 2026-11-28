/**
 * B 方案（健康巡检 DNS 改造）契约测试：可注入解析器 + 金丝雀自检。
 *
 * 全部用假解析器，不触网、不 mock `node:dns`（ssrf-policy.test.ts 的
 * vi.mock 会跨文件泄漏，这里刻意不用模块 mock）。
 *
 * 锁三件事：
 *   1. 注入解析器真的被 resolveAndCheck 使用（而不是悄悄走系统解析器）；
 *   2. 坏解析器返回 198.18.x 时仍按 blocked-ip 拦截（SSRF 规则一行没动）；
 *   3. 金丝雀能分辨“解析器可信 / 返回受保护网段 / 解析失败”三种状态。
 */
import { describe, expect, it } from "vitest";
import {
  createExternalDnsResolver,
  DEFAULT_GUARD,
  isDnsResolverFailure,
  PATROL_DNS_CANARY_HOST,
  PATROL_DNS_SERVERS,
  resolveAndCheck,
  SsrfBlockedError,
  verifyPatrolDnsResolver,
  type DnsResolverLike,
} from "../src/ssrf.ts";

const goodResolver: DnsResolverLike = {
  lookup: async () => [{ address: "93.184.215.14" }],
};

/** 复现本机故障形态：解析器把公网域名解析到 198.18/15。 */
const poisonedResolver: DnsResolverLike = {
  lookup: async () => [{ address: "198.18.92.130" }],
};

const failingResolver: DnsResolverLike = {
  lookup: async () => {
    throw new Error("resolver down");
  },
};

const hangingResolver: DnsResolverLike = {
  lookup: () => new Promise<Array<{ address: string }>>(() => {}),
};

describe("注入解析器", () => {
  it("返回真实 IP 时 resolveAndCheck 采用注入结果", async () => {
    const ips = await resolveAndCheck(new URL("https://example.com/"), {
      ...DEFAULT_GUARD,
      dnsResolver: goodResolver,
    });
    expect(ips).toEqual(["93.184.215.14"]);
  });

  it("返回 198.18.x 时仍按 blocked-ip 拦截（SSRF 规则不动）", async () => {
    await expect(
      resolveAndCheck(new URL("https://example.com/"), {
        ...DEFAULT_GUARD,
        dnsResolver: poisonedResolver,
      }),
    ).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "blocked-ip" });
  });

  it("解析器抛错时包成 dns-failure（fail-closed，不放行）", async () => {
    await expect(
      resolveAndCheck(new URL("https://example.com/"), {
        ...DEFAULT_GUARD,
        dnsResolver: failingResolver,
      }),
    ).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "dns-failure" });
  });

  it("解析器超时时报 dns-timeout（dnsTimeoutMs 生效）", async () => {
    await expect(
      resolveAndCheck(new URL("https://example.com/"), {
        ...DEFAULT_GUARD,
        dnsResolver: hangingResolver,
        dnsTimeoutMs: 50,
      }),
    ).rejects.toMatchObject({ name: "SsrfBlockedError", reason: "dns-timeout" });
  });

  it("不传解析器时不改变默认行为（系统解析器）", () => {
    // 只断言选项可省：不传 dnsResolver 时 resolveAndCheck 仍接受调用，
    // 真实解析行为由 ssrf-policy.test.ts 覆盖。
    expect(DEFAULT_GUARD.dnsResolver).toBeUndefined();
  });
});

describe("金丝雀自检 verifyPatrolDnsResolver", () => {
  it("解析器返回公网 IP 时 ok", async () => {
    const result = await verifyPatrolDnsResolver(goodResolver);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.addresses).toEqual(["93.184.215.14"]);
  });

  it("解析器返回 198.18.x 时失败并点名受保护网段", async () => {
    const result = await verifyPatrolDnsResolver(poisonedResolver);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("受保护网段");
  });

  it("解析器抛错时失败", async () => {
    const result = await verifyPatrolDnsResolver(failingResolver);
    expect(result.ok).toBe(false);
  });

  it("解析器超时时失败", async () => {
    const result = await verifyPatrolDnsResolver(hangingResolver, PATROL_DNS_CANARY_HOST, 50);
    expect(result.ok).toBe(false);
  });
});

describe("isDnsResolverFailure（跳过条件）", () => {
  it("只认 dns-failure / dns-timeout", () => {
    expect(isDnsResolverFailure(new SsrfBlockedError("x", "dns-failure"))).toBe(true);
    expect(isDnsResolverFailure(new SsrfBlockedError("x", "dns-timeout"))).toBe(true);
    expect(isDnsResolverFailure(new SsrfBlockedError("x", "blocked-ip"))).toBe(false);
    expect(isDnsResolverFailure(new Error("boom"))).toBe(false);
    expect(isDnsResolverFailure(null)).toBe(false);
  });
});

describe("createExternalDnsResolver", () => {
  it("默认服务器是 8.8.8.8，返回带 lookup 的解析器", () => {
    expect(PATROL_DNS_SERVERS).toEqual(["8.8.8.8"]);
    const resolver = createExternalDnsResolver();
    expect(typeof resolver.lookup).toBe("function");
  });
});
