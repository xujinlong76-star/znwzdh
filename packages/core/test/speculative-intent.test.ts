/**
 * speculative-intent/semver.ts + network.ts 覆盖。
 *
 * 这两个文件此前没有任何测试引用：semver 范围判定、CIDR/IP 识别、
 * curl 转 fetch、JWT 离线解码全部没有回归保护。
 */
import { describe, expect, it } from "vitest";
import { tryParseSemver } from "../src/speculative-intent/semver.ts";
import {
  tryDetectIp,
  tryParseCidr,
  tryParseCurl,
  tryParseJwt,
} from "../src/speculative-intent/network.ts";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("tryParseSemver", () => {
  it("版本对比：Patch / Minor / Major / 相同", () => {
    expect(tryParseSemver("1.2.3 vs 1.2.4")?.title).toContain("向后兼容缺陷修复 (Patch)");
    expect(tryParseSemver("1.2.3 vs 1.2.4")?.copyValue).toBe("1.2.3 < 1.2.4 (向后兼容缺陷修复 (Patch))");
    expect(tryParseSemver("1.2.0 vs 1.3.0")?.title).toContain("向后兼容功能增强 (Minor)");
    expect(tryParseSemver("2.0.0 vs 1.9.9")?.title).toContain("破坏性大版本变更 (Major)");
    expect(tryParseSemver("1.2.3 vs 1.2.3")?.title).toContain("相同版本 (Identical)");
    expect(tryParseSemver("1.2.3 vs 1.2.3")?.previewValue).toContain("= (完全一致)");
  });

  it("预发布标识变更与预发布 < 正式版", () => {
    expect(tryParseSemver("1.2.3-alpha vs 1.2.3-beta")?.title).toContain("预发布标识变更 (Prerelease)");
    expect(tryParseSemver("1.2.3-alpha vs 1.2.3")?.copyValue).toContain("<");
  });

  it("caret 范围：0.x 的特殊规则", () => {
    expect(tryParseSemver("^1.2.3 vs 1.5.0")?.copyValue).toBe("true");
    expect(tryParseSemver("^1.2.3 vs 2.0.0")?.copyValue).toBe("false");
    expect(tryParseSemver("^0.2.3 vs 0.2.9")?.copyValue).toBe("true");
    expect(tryParseSemver("^0.2.3 vs 0.3.0")?.copyValue).toBe("false");
    expect(tryParseSemver("^0.0.3 vs 0.0.3")?.copyValue).toBe("true");
    expect(tryParseSemver("^0.0.3 vs 0.0.4")?.copyValue).toBe("false");
  });

  it("tilde 范围：同 major.minor 且 patch 不低于基准", () => {
    expect(tryParseSemver("~1.2.3 vs 1.2.9")?.copyValue).toBe("true");
    expect(tryParseSemver("~1.2.3 vs 1.2.2")?.copyValue).toBe("false");
    expect(tryParseSemver("~1.2.3 vs 1.3.0")?.copyValue).toBe("false");
  });

  it("单版本解析：v 前缀、预发布、构建元数据、显式前缀", () => {
    const single = tryParseSemver("v1.2.3");
    expect(single?.type).toBe("semver");
    expect(single?.title).toBe("Semver 语义化版本: v1.2.3");
    expect(single?.copyValue).toBe("v1.2.3");
    const full = tryParseSemver("semver: 1.2.3-alpha+build.1");
    expect(full?.previewValue).toContain("预发布 (Prerelease): alpha");
    expect(full?.previewValue).toContain("构建元数据 (Build): build.1");
    expect(full?.copyValue).toBe("v1.2.3-alpha");
  });

  it("非法输入返回 null", () => {
    expect(tryParseSemver("1.2")).toBeNull();
    expect(tryParseSemver("hello")).toBeNull();
    expect(tryParseSemver("semver: nope")).toBeNull();
    expect(tryParseSemver(">=1.2.3 vs 1.2.4")).toBeNull();
    expect(tryParseSemver("1.2.3 vs x.y.z")).toBeNull();
  });
});

describe("tryParseCidr", () => {
  it("/24 标准子网：网络/广播/掩码/可用主机", () => {
    const res = tryParseCidr("192.168.1.0/24");
    expect(res?.type).toBe("cidr");
    expect(res?.title).toBe("CIDR 子网计算: 192.168.1.0/24");
    expect(res?.details["子网掩码"]).toBe("255.255.255.0");
    expect(res?.details["广播地址"]).toBe("192.168.1.255");
    expect(res?.details["可用主机范围"]).toBe("192.168.1.1 - 192.168.1.254");
    expect(res?.details["可用主机数"]).toBe("254");
    expect(res?.copyValue).toBe("192.168.1.1-192.168.1.254");
  });

  it("主机位非零时归一化到网络地址；显式 cidr: 前缀", () => {
    expect(tryParseCidr("10.0.5.9/16")?.title).toBe("CIDR 子网计算: 10.0.0.0/16");
    expect(tryParseCidr("cidr: 10.0.0.0/8")?.details["标准 CIDR"]).toBe("10.0.0.0/8");
  });

  it("/31 与 /32：无保留地址扣除；/0 全网段", () => {
    const s31 = tryParseCidr("192.168.1.0/31");
    expect(s31?.details["可用主机数"]).toBe("2");
    expect(s31?.details["可用主机范围"]).toBe("192.168.1.0 - 192.168.1.1");
    const s32 = tryParseCidr("192.168.1.5/32");
    expect(s32?.details["可用主机数"]).toBe("1");
    const s0 = tryParseCidr("0.0.0.0/0");
    expect(s0?.details["子网掩码"]).toBe("0.0.0.0");
    expect(s0?.details["广播地址"]).toBe("255.255.255.255");
  });

  it("非法 CIDR 返回 null", () => {
    expect(tryParseCidr("999.1.1.1/24")).toBeNull();
    expect(tryParseCidr("192.168.1.1/33")).toBeNull();
    expect(tryParseCidr("192.168.1.1")).toBeNull();
    expect(tryParseCidr("not cidr")).toBeNull();
    expect(tryParseCidr("192.168.1.1/-1")).toBeNull();
  });
});

describe("tryDetectIp", () => {
  it("公网 IP 识别", () => {
    expect(tryDetectIp("8.8.8.8")?.subtitle).toBe("公网 IP 目标地址");
    expect(tryDetectIp("172.32.0.1")?.subtitle).toBe("公网 IP 目标地址");
    expect(tryDetectIp("1.1.1.1")?.copyValue).toBe("1.1.1.1");
  });

  it("私有/保留地址识别：10/8、172.16/12、192.168/16、回环、CGNAT、链路本地、特殊保留", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.5", "127.0.0.1", "100.64.0.1", "169.254.1.1", "192.0.2.1", "192.0.0.1", "0.0.0.0"]) {
      expect(tryDetectIp(ip)?.subtitle).toBe("私有网络 / 本地保留地址 (LAN/Loopback)");
    }
  });

  it("非法 IP 返回 null", () => {
    expect(tryDetectIp("999.1.1.1")).toBeNull();
    expect(tryDetectIp("256.1.1.1")).toBeNull();
    expect(tryDetectIp("example.com")).toBeNull();
    expect(tryDetectIp("1.2.3")).toBeNull();
  });
});

describe("tryParseCurl", () => {
  it("最简 GET 转换", () => {
    const res = tryParseCurl("curl https://example.com/api");
    expect(res?.type).toBe("curl_to_fetch");
    expect(res?.subtitle).toBe("目标: GET https://example.com/api");
    expect(res?.copyValue).toContain('fetch("https://example.com/api"');
    expect(res?.copyValue).toContain('method: "GET"');
  });

  it("-X 指定方法、-H 请求头、-d 请求体", () => {
    const res = tryParseCurl(
      `curl -X POST -H "Authorization: Bearer x" -H "X-A: 1" -d 'a=1&b=2' https://example.com/api`,
    );
    expect(res?.subtitle).toBe("目标: POST https://example.com/api");
    expect(res?.copyValue).toContain('"Authorization": "Bearer x"');
    expect(res?.copyValue).toContain('body: "a=1&b=2"');
  });

  it("-d 体含内层双引号时只取到第一个内层引号前（简易解析的已知局限）", () => {
    // -d '{"a":1}' 里 [^"']* 在第一个内层 " 处截断，只得到 "{"
    const res = tryParseCurl(`curl -d '{"a":1}' https://example.com/api`);
    expect(res?.copyValue).toContain('body: "{"');
  });

  it("含 --data 时默认 POST；curl.exe 前缀同样识别", () => {
    expect(tryParseCurl('curl --data "x=1" https://example.com')?.subtitle).toContain("POST");
    expect(tryParseCurl("curl.exe https://example.com")?.type).toBe("curl_to_fetch");
  });

  it("非 curl、缺 URL 时返回 null", () => {
    expect(tryParseCurl("fetch https://example.com")).toBeNull();
    expect(tryParseCurl("curl")).toBeNull();
    expect(tryParseCurl("curl -X GET")).toBeNull();
    expect(tryParseCurl("")).toBeNull();
  });
});

describe("tryParseJwt", () => {
  it("有效期内：状态与算法、签发者展示", () => {
    const token = [
      b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: "user-1", iss: "navhub", exp: Math.floor(Date.now() / 1000) + 3600 }),
      "sig",
    ].join(".");
    const res = tryParseJwt(token);
    expect(res?.type).toBe("jwt");
    expect(res?.title).toContain("✅ 有效期内");
    expect(res?.subtitle).toContain("算法: HS256");
    expect(res?.subtitle).toContain("navhub");
    expect(res?.details["到期时间"]).toContain("过期");
  });

  it("已过期 / 无 exp / 含 nbf", () => {
    const expired = [b64url({ alg: "none" }), b64url({ sub: "u", exp: 1000 }), "s"].join(".");
    expect(tryParseJwt(expired)?.title).toContain("⚠️ 已过期");
    const noExp = [b64url({ alg: "RS256" }), b64url({ sub: "u" }), "s"].join(".");
    const res = tryParseJwt(noExp);
    expect(res?.title).toContain("有效");
    expect(res?.details["到期时间"]).toBe("未设置过期时间");
    const withNbf = [
      b64url({ alg: "HS256" }),
      b64url({ sub: "u", nbf: Math.floor(Date.now() / 1000) - 60 }),
      "s",
    ].join(".");
    expect(tryParseJwt(withNbf)?.subtitle).toContain("nbf:");
  });

  it("非 JWT 输入返回 null", () => {
    expect(tryParseJwt("notajwt")).toBeNull();
    expect(tryParseJwt("eyJx.y")).toBeNull();
    expect(tryParseJwt("eyJ.invalid!base64.x")).toBeNull();
    expect(tryParseJwt("")).toBeNull();
  });
});
