/**
 * speculative-intent/hash-calc.ts 覆盖：纯 JS 的 MD5 / SHA-1 / SHA-256 / SHA-512
 * 实现与 tryCalculateHash 前缀解析。
 *
 * 该文件此前没有任何测试引用（4% 行覆盖）：四个手写哈希实现
 * 与 Node crypto 的一致性完全没有回归保护。
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { tryCalculateHash } from "../src/speculative-intent/hash-calc.ts";

function digest(algo: string, body: string): string {
  return createHash(algo).update(body, "utf8").digest("hex");
}

describe("tryCalculateHash", () => {
  it.each([
    ["md5", "hello", "MD5 (128-bit)"],
    ["sha1", "hello", "SHA-1 (160-bit)"],
    ["sha256", "hello", "SHA-256 (256-bit)"],
    ["sha512", "hello", "SHA-512 (512-bit)"],
  ])("%s 前缀返回与 Node crypto 一致的摘要", (prefix, body, label) => {
    const res = tryCalculateHash(`${prefix}:${body}`);
    expect(res).not.toBeNull();
    expect(res!.type).toBe("hash_calc");
    expect(res!.title).toBe(`${label} 哈希计算`);
    expect(res!.previewValue).toBe(digest(prefix, body));
    expect(res!.copyValue).toBe(digest(prefix, body));
    expect(res!.details["算法"]).toBe(label);
    expect(res!.details["输入长度"]).toBe("5 字符");
    expect(res!.details["哈希值"]).toBe(digest(prefix, body));
    expect(res!.actionLabel).toBe("复制哈希值");
  });

  it("前缀大小写不敏感，冒号后空白被忽略", () => {
    expect(tryCalculateHash("MD5:  hello")?.previewValue).toBe(digest("md5", "hello"));
    expect(tryCalculateHash("Sha256:\thello")?.previewValue).toBe(digest("sha256", "hello"));
  });

  it("多块输入（跨 64/128 字节填充边界）摘要正确", () => {
    const body = "a".repeat(100);
    expect(tryCalculateHash(`md5:${body}`)?.previewValue).toBe(digest("md5", body));
    expect(tryCalculateHash(`sha1:${body}`)?.previewValue).toBe(digest("sha1", body));
    expect(tryCalculateHash(`sha256:${body}`)?.previewValue).toBe(digest("sha256", body));
    expect(tryCalculateHash(`sha512:${body}`)?.previewValue).toBe(digest("sha512", body));
    // 恰好落在填充边界附近的长度
    const edge = "b".repeat(55);
    expect(tryCalculateHash(`md5:${edge}`)?.previewValue).toBe(digest("md5", edge));
    const edge2 = "c".repeat(56);
    expect(tryCalculateHash(`sha256:${edge2}`)?.previewValue).toBe(digest("sha256", edge2));
  });

  it("中文输入按 UTF-8 编码计算", () => {
    expect(tryCalculateHash("md5:你好世界")?.previewValue).toBe(digest("md5", "你好世界"));
    expect(tryCalculateHash("sha256:你好世界")?.previewValue).toBe(digest("sha256", "你好世界"));
  });

  it("超过 40 字符的输入在 subtitle 里截断", () => {
    const body = "x".repeat(50);
    const res = tryCalculateHash(`sha256:${body}`);
    expect(res!.subtitle).toBe("x".repeat(40) + "...");
    expect(res!.details["输入长度"]).toBe("50 字符");
    const short = tryCalculateHash("sha256:short");
    expect(short!.subtitle).toBe("short");
  });

  it("无前缀、未知前缀、空体、空白输入一律返回 null", () => {
    expect(tryCalculateHash("hello")).toBeNull();
    expect(tryCalculateHash("sha999: hello")).toBeNull();
    expect(tryCalculateHash("md5:")).toBeNull();
    expect(tryCalculateHash("md5:   ")).toBeNull();
    expect(tryCalculateHash("")).toBeNull();
    expect(tryCalculateHash("   ")).toBeNull();
    expect(tryCalculateHash("md5")).toBeNull();
  });
});
