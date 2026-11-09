/**
 * navhub-api 并发去重（single-flight）回归。
 *
 * 背景：`searchSites` / `fetchCategories` 等被多个组件在 mount 时各自拉取，
 * 同一路径在同一瞬间会发重复请求（切路由更明显）。这里锁两件事：
 *   1. 无自定义 signal、无额外头时，同 path 的**并发** GET 只发一次；
 *   2. 去重窗口只在「在途期间」——settle 后下一次调用必须重新发（这不是缓存，
 *      不能把陈旧数据喂给用户）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { fetchCategories } from "../src/lib/navhub-api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 打桩 fetch，返回「已发次数」读取器；delayMs 用来制造真实的并发窗口 */
function stubFetch(delayMs: number): () => number {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return () => calls;
}

describe("navhub-api 并发去重（single-flight）", () => {
  it("同路径的并发 GET 只发一次", async () => {
    const calls = stubFetch(30);
    const [a, b, c] = await Promise.all([fetchCategories(), fetchCategories(), fetchCategories()]);
    expect(calls()).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("settle 后不再共享（不是缓存）", async () => {
    const calls = stubFetch(0);
    await fetchCategories();
    await fetchCategories();
    expect(calls()).toBe(2);
  });
});