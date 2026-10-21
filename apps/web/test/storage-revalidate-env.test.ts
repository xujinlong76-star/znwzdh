/**
 * revalidateFromEnv：读缓存时效的环境解析。
 *
 * 与 cooldownFromEnv 同一契约：脏环境值一律回退默认 60，绝不抛错——
 * 取数链路在模块加载期抛错会让首屏直接 500。置 0 = 禁用缓存（实时读）。
 */
import { describe, expect, it, vi } from "vitest";

// github.ts 顶层 import 了 @/lib/auth（next-auth v5 beta），Node ESM 下缺
 // "next/server" 扩展名会解析失败；按接口外形 mock 掉，聚焦本纯函数。
vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(null),
}));

import { revalidateFromEnv } from "@/lib/github";

describe("revalidateFromEnv", () => {
  it("缺省 60 秒", () => {
    expect(revalidateFromEnv({})).toBe(60);
  });

  it("接受合法正整数（含字符串）", () => {
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "300" })).toBe(300);
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "1" })).toBe(1);
  });

  it("0 = 显式禁用缓存（实时读中枢）", () => {
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "0" })).toBe(0);
  });

  it("脏值回退默认：非数字 / 负数 / 小数 / 空串", () => {
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "abc" })).toBe(60);
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "-5" })).toBe(60);
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "1.5" })).toBe(1); // 向下取整
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "" })).toBe(60);
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "   " })).toBe(60);
  });

  it("Infinity / NaN 回退默认", () => {
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "Infinity" })).toBe(60);
    expect(revalidateFromEnv({ NAVHUB_STORAGE_REVALIDATE_S: "NaN" })).toBe(60);
  });
});
