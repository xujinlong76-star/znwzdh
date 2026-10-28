import { describe, expect, it } from "vitest";
import { readDocResilient } from "@/lib/video-doc-read";

/**
 * 可降级读取的边界。
 *
 * 这里守的是一个真实踩过的坑：`(await fresh()) ?? (await cached())` 里的 `??`
 * 只处理「返回 null」，接不住**抛出的异常** —— 于是降级分支永远不执行，
 * 中枢一次抖动就把只读看板打成 500。
 */
describe("readDocResilient", () => {
  it("新鲜读成功时直接用，不走缓存", async () => {
    let cachedCalled = false;
    const res = await readDocResilient<{ v: number }>({
      fresh: async () => ({ v: 1 }),
      cached: async () => {
        cachedCalled = true;
        return { v: 2 };
      },
    });
    expect(res.source).toBe("fresh");
    expect(res.data).toEqual({ v: 1 });
    expect(res.errors).toEqual([]);
    expect(cachedCalled).toBe(false);
  });

  it("新鲜读抛错时降级到缓存，并留下原因", async () => {
    const res = await readDocResilient<{ v: number }>({
      fresh: async () => {
        throw new Error("hub 503");
      },
      cached: async () => ({ v: 2 }),
    });
    expect(res.source).toBe("cached");
    expect(res.data).toEqual({ v: 2 });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("hub 503");
  });

  it("新鲜读返回 null 也降级（不是抛错，但同样没有数据）", async () => {
    const res = await readDocResilient<{ v: number }>({
      fresh: async () => null,
      cached: async () => ({ v: 3 }),
    });
    expect(res.source).toBe("cached");
    expect(res.data).toEqual({ v: 3 });
    // 返回 null 不是错误，不该污染 errors
    expect(res.errors).toEqual([]);
  });

  it("两层都抛错时返回 none，并把两条原因都留下", async () => {
    const res = await readDocResilient<{ v: number }>({
      fresh: async () => {
        throw new Error("fresh down");
      },
      cached: async () => {
        throw new Error("cached down");
      },
    });
    expect(res.source).toBe("none");
    expect(res.data).toBeNull();
    expect(res.errors).toHaveLength(2);
    expect(res.errors.join(" | ")).toContain("fresh down");
    expect(res.errors.join(" | ")).toContain("cached down");
  });

  it("fresh 为 null 且 cached 抛错 → none", async () => {
    const res = await readDocResilient<{ v: number }>({
      fresh: async () => undefined,
      cached: async () => {
        throw new Error("only cached down");
      },
    });
    expect(res.source).toBe("none");
    expect(res.errors).toHaveLength(1);
  });
});
