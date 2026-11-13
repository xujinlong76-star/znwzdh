import { describe, expect, it } from "vitest";
import { parseSpeculativeIntent } from "@/lib/speculative";

/**
 * speculative.ts tryCalculateHash：四种算法均为同步纯 JS 实现，
 * 即时返回真实十六进制摘要（此前 SHA-256/512 只返回 "(异步计算中...)"
 * 占位符且 copyValue 也是该占位符，MD5/SHA-1 直接返回 null）。
 * 期望值以 Node crypto 为准事先算出并写死，避免测试本身依赖 crypto。
 */
describe("投机哈希计算：md5/sha1/sha256/sha512 即时出真实摘要", () => {
  const EXPECTED: Record<string, string> = {
    md5: "5d41402abc4b2a76b9719d911017c592",
    sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    sha512:
      "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043",
  };

  it.each(["md5", "sha1", "sha256", "sha512"] as const)(
    "%s 前缀返回真实摘要卡片，copyValue 就是该摘要",
    (algo) => {
      const res = parseSpeculativeIntent(`${algo}:hello`);
      expect(res).not.toBeNull();
      expect(res!.type).toBe("hash_calc");
      expect(res!.previewValue).toBe(EXPECTED[algo]);
      expect(res!.copyValue).toBe(EXPECTED[algo]);
      expect(res!.previewValue).not.toContain("异步计算中");
      expect(res!.actionLabel).toBe("复制哈希值");
      expect(res!.details?.["哈希值"]).toBe(EXPECTED[algo]);
    },
  );

  it("多块输入（跨填充边界）摘要正确", () => {
    const res = parseSpeculativeIntent(`md5:${"a".repeat(100)}`);
    expect(res?.previewValue).toBe("36a92cc94a9e0fa21f625f8bfb007adf");
  });

  it("无前缀不猜测、空 body 返回 null", () => {
    expect(parseSpeculativeIntent("hello")).toBeNull();
    expect(parseSpeculativeIntent("md5:")).toBeNull();
    expect(parseSpeculativeIntent("md5:   ")).toBeNull();
  });
});
