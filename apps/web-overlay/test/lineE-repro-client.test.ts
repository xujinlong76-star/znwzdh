/**
 * 临时复现（U-371，跑完即删，不入仓）：
 * 客户端一半：真实 syncFavoritesToCloud()，fake localStorage + stub fetch。
 * 本地收藏 createdAt=1000（t0），离线改备注后同步；喂入与服务端 R1
 * 逐字一致的回包（applied:0 + B 版备注）→ result ok:true、pushed:1，
 * 脏标记落盘 "[]"（永不再重试），且 result 无 skipped 字段。
 * 与 round2 E 路方法一致（客户端一半）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { syncFavoritesToCloud } from "../src/hooks/useFavorites";

const originalFetch = globalThis.fetch;
const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown };
let lastStore: Record<string, string> = {};

function installStorage(entries: Record<string, string>): void {
  const store: Record<string, string> = { ...entries };
  lastStore = store;
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  globals.localStorage = localStorage;
  globals.window = {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

const DIRTY_KEY = "navhub.favorites.dirty.v1";

async function mountedModule(): Promise<typeof import("../src/hooks/useFavorites")> {
  vi.resetModules();
  return import("../src/hooks/useFavorites");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globals.window;
  delete globals.localStorage;
  lastStore = {};
});

describe("U-371 R1 复现（客户端）", () => {
  it("op.at 取 createdAt；喂入 applied:0 回包后 ok:true、脏标记落盘 []、无 skipped", async () => {
    // 本地收藏：createdAt=t0=1000，备注 A 版；脏标记来自离线改备注
    installStorage({
      "navhub.userId": "user-1",
      "navhub.favorites.v1": JSON.stringify([
        { siteId: "siteA", title: "站点 A", href: "https://example.com/siteA", note: "A版备注", createdAt: 1000 },
      ]),
      [DIRTY_KEY]: JSON.stringify(["siteA"]),
    });
    const { syncFavoritesToCloud: sync } = await mountedModule();
    const calls: Array<{ body?: string }> = [];
    globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
      calls.push({ body: init?.body });
      // 与服务端 R1 逐字一致的回包：HTTP 200 + ok:true，applied=0，云端是 B 版
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            applied: 0,
            version: 1700000060000,
            items: [
              {
                siteId: "siteA",
                folderId: null,
                note: "B版备注",
                createdAt: 1000,
                updatedAt: 1700000060000,
                deletedAt: null,
                site: { url: "https://example.com/siteA", title: "站点 A" },
              },
            ],
            folders: [],
          }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await sync();
    const sentOp = JSON.parse(calls[0]?.body ?? "{}").ops?.[0] as { at?: number; note?: string };
    console.log("client repro: sent op =", JSON.stringify(sentOp), "result =", JSON.stringify({ ok: result.ok, pushed: result.pushed, skipped: (result as { skipped?: number }).skipped, nextNote: result.nextItems?.[0]?.note }), "dirty =", lastStore[DIRTY_KEY]);
    // BUG ①：op.at 拿的是 createdAt（1000），不是真正的改动时间
    expect(sentOp.at).toBe(1000);
    // BUG ②：服务端跳过了 op，客户端仍报 ok:true、pushed:1
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(1);
    // BUG ③：结果里没有 skipped，调用方无从知道
    expect((result as { skipped?: number }).skipped).toBeUndefined();
    // BUG ④：脏标记被清空，A 版改动永不再重试；本地值还被 B 版覆盖
    expect(lastStore[DIRTY_KEY]).toBe("[]");
    expect(result.nextItems?.[0]?.note).toBe("B版备注");
  });
});
