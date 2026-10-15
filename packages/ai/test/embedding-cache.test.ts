/**
 * Embedding 缓存：键归一化、LRU、Singleflight 并发合并。
 *
 * 这三个行为都对应真实发生过或可预期的浪费：
 *   - 没有归一化，"iPhone " 与 "iphone" 各占一个条目、各跑一次 ONNX；
 *   - 没有 singleflight，一次并发突发对同一个冷词跑 N 次前向；
 *   - 没有 LRU 淘汰，长跑进程缓存无界增长。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createEmbeddingCache,
  normalizeEmbeddingKey,
} from "../src/embedding.ts";

function fakeVec(seed: number): Float32Array {
  const v = new Float32Array(512);
  v[0] = seed;
  return v;
}

describe("normalizeEmbeddingKey", () => {
  it("NFKC 归一化全角/兼容字符", () => {
    // 全角字母与空格
    expect(normalizeEmbeddingKey("ｉＰｈｏｎｅ")).toBe("iphone");
    // 全角空格 U+3000 -> 普通空格再被压缩
    expect(normalizeEmbeddingKey("天气\u3000预报")).toBe("天气 预报");
  });

  it("去首尾空白并压缩连续空白", () => {
    expect(normalizeEmbeddingKey("  Docker   容器 \n")).toBe("docker 容器");
  });

  it("大小写折叠", () => {
    expect(normalizeEmbeddingKey("Vercel")).toBe("vercel");
    expect(normalizeEmbeddingKey("VERCEL")).toBe(normalizeEmbeddingKey("vercel"));
  });
});

describe("createEmbeddingCache", () => {
  it("命中返回同一个 Float32Array 实例（零拷贝复用）", async () => {
    const cache = createEmbeddingCache(8);
    const compute = vi.fn(async () => fakeVec(1));

    const a = await cache.getOrCompute("q", compute);
    const b = await cache.getOrCompute("q", compute);

    expect(b).toBe(a);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ size: 1, hits: 1, misses: 1 });
  });

  it("归一化后同一查询只算一次（大小写/空白/全角不敏感）", async () => {
    const cache = createEmbeddingCache(8);
    const compute = vi.fn(async () => fakeVec(1));

    await cache.getOrCompute("iPhone", compute);
    await cache.getOrCompute("  iphone  ", compute);
    await cache.getOrCompute("ｉＰｈｏｎｅ", compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith("iphone"); // 模型看到的也是归一化输入
  });

  it("Singleflight：并发冷词只触发一次推理", async () => {
    const cache = createEmbeddingCache(8);
    let calls = 0;
    const compute = () =>
      new Promise<Float32Array>((resolve) => {
        calls++;
        setTimeout(() => resolve(fakeVec(7)), 20);
      });

    const results = await Promise.all([
      cache.getOrCompute("并发词", compute),
      cache.getOrCompute("并发词", compute),
      cache.getOrCompute("并发词", compute),
    ]);

    expect(calls).toBe(1);
    // 三个调用拿到同一条向量
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it("推理失败不写缓存，下一次重新尝试", async () => {
    const cache = createEmbeddingCache(8);
    let attempt = 0;
    const compute = async () => {
      attempt++;
      if (attempt === 1) throw new Error("onnx runtime 崩了");
      return fakeVec(3);
    };

    await expect(cache.getOrCompute("坏词", compute)).rejects.toThrow("onnx runtime 崩了");
    expect(cache.stats().size).toBe(0);

    const v = await cache.getOrCompute("坏词", compute);
    expect(v[0]).toBe(3);
    expect(attempt).toBe(2);
  });

  it("满载后淘汰最久未用（LRU），且命中会续期", async () => {
    const cache = createEmbeddingCache(2);
    await cache.getOrCompute("a", async () => fakeVec(1));
    await cache.getOrCompute("b", async () => fakeVec(2));

    // 命中 a -> a 续期，b 成为最久未用（命中不重算）
    const computeHit = vi.fn(async () => fakeVec(1));
    await cache.getOrCompute("a", computeHit);
    expect(computeHit).not.toHaveBeenCalled();

    // 插入 c -> 淘汰的是 b 而不是 a（续期生效）
    await cache.getOrCompute("c", async () => fakeVec(3));
    expect(cache.stats().size).toBe(2);

    // a 仍然命中（必须在重插 b 之前验证，否则容量 2 下 a 会让位给 b）
    const computeA = vi.fn(async () => fakeVec(1));
    await cache.getOrCompute("a", computeA);
    expect(computeA).not.toHaveBeenCalled(); // a 还在

    // b 确实被淘汰了，重新推理
    const computeB = vi.fn(async () => fakeVec(2));
    await cache.getOrCompute("b", computeB);
    expect(computeB).toHaveBeenCalledTimes(1);
  });
});
