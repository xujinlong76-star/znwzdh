/**
 * 安全随机数契约测试（CodeQL #132 不安全的随机性修复）。
 *
 * 锁三件事：
 *   1. `secureRandomInt` 返回值在 [0, max) 内且分布均匀（拒绝采样消除取模偏差）；
 *   2. `generateSecureUuid` 始终生成合法 UUID v4（版本位 4、变体位 8/9/a/b），
 *      且无 `crypto.randomUUID` 时走 `getRandomValues` 回退仍合法；
 *   3. `crypto` 完全不可用时抛错——绝不静默降级到可预测的 `Math.random()`。
 *
 * 本文件在 apps/web-overlay/test/ 编写，经 mirror:web 同步到 apps/web/test/ 后运行
 * （vitest 只收集 apps/web/test/**；`@/` 指向 apps/web/src）。
 */
import { describe, expect, it } from "vitest";
import { generateSecureUuid, secureRandomInt, type SecureRandomSource } from "@/lib/secure-random";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("secureRandomInt：拒绝采样，消除取模偏差", () => {
  it("返回值始终在 [0, max) 内", () => {
    for (const max of [2, 4, 16, 100, 256]) {
      for (let i = 0; i < 50; i++) {
        const v = secureRandomInt(max);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(max);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("分布均匀：16 面骰子 16000 次，卡方在合理范围（拒绝采样无取模偏差）", () => {
    const N = 16_000;
    const counts = new Array<number>(16).fill(0);
    for (let i = 0; i < N; i++) counts[secureRandomInt(16)]++;
    const expected = N / 16;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 自由度 15，99.9% 临界值约 37.7；取 60 作宽松上界（防抖动误报）
    expect(chi2).toBeLessThan(60);
    // 每一面都充分出现（期望 1000 次，800 为下限）
    expect(Math.min(...counts)).toBeGreaterThan(800);
  });

  it("max 非法时抛 RangeError", () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(257)).toThrow(RangeError);
    expect(() => secureRandomInt(1.5)).toThrow(RangeError);
  });

  it("拒绝采样真实发生：max=200 时只接受 <200 的字节（注入确定性源验证）", () => {
    // 确定性源：先吐 250（应被拒绝）、再吐 199（应被接受）
    const values = [250, 199];
    let calls = 0;
    const source: SecureRandomSource = {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        const buf = array as unknown as Uint8Array;
        buf[0] = values[calls++] ?? 0;
        return array;
      },
    };
    expect(secureRandomInt(200, source)).toBe(199);
    expect(calls).toBe(2); // 第一次被拒绝、第二次接受
  });
});

describe("generateSecureUuid：始终合法 v4，永不回退 Math.random", () => {
  it("生成合法的 UUID v4（版本位 4、变体位 8/9/a/b）", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSecureUuid()).toMatch(UUID_V4);
    }
  });

  it("连续生成 100 个互不重复", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSecureUuid()));
    expect(ids.size).toBe(100);
  });

  it("无 crypto.randomUUID 时走 getRandomValues 回退，仍为合法 v4", () => {
    // 注入只有 getRandomValues 的源（模拟老浏览器），覆盖回退分支
    const source: SecureRandomSource = {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        return globalThis.crypto.getRandomValues(array as unknown as Uint8Array) as unknown as T;
      },
    };
    for (let i = 0; i < 20; i++) {
      expect(generateSecureUuid(source)).toMatch(UUID_V4);
    }
  });

  it("crypto 完全不可用时抛错而非静默降级", () => {
    const source: SecureRandomSource = {
      getRandomValues<T extends ArrayBufferView>(): T {
        throw new Error("no crypto");
      },
    };
    // 既无 randomUUID、getRandomValues 又抛错 → 必须抛错
    expect(() => generateSecureUuid(source)).toThrow(/Web Crypto|no crypto/);
  });

  it("回退分支的 y 位只取 8/9/a/b（变体位正确）", () => {
    const source: SecureRandomSource = {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        return globalThis.crypto.getRandomValues(array as unknown as Uint8Array) as unknown as T;
      },
    };
    for (let i = 0; i < 50; i++) {
      const id = generateSecureUuid(source);
      const variant = id.split("-")[3][0];
      expect(["8", "9", "a", "b"]).toContain(variant);
      expect(id.split("-")[2][0]).toBe("4");
    }
  });
});
