/**
 * 收藏存储：「读不出来」**不能**被当成「没有数据」。
 *
 * 真实缺陷（`hooks/useFavorites.ts`）：
 *
 *     function loadLocal(): LocalFavorite[] {
 *       try {
 *         const raw = localStorage.getItem(KEY)
 *         if (!raw) return []
 *         const parsed = JSON.parse(raw)
 *         return Array.isArray(parsed) ? parsed : []     // ← 读失败 = 空收藏
 *       } catch {
 *         return []                                      // ← 同上
 *       }
 *     }
 *
 * 这个返回值随即被写回去（`toggle` → `[...items]` → `setItem`）：只要本地那条 JSON
 * 坏了（写入中断留下半截、被扩展/脚本改写、老版本结构），用户点一次收藏星标，
 * **整个收藏夹就被覆盖成一条**。
 *
 * 修法分两层，这个文件把两层都钉住：
 *   1. 纯函数 `parseFavorites` 明确返回 `{ items, corrupt }`；`corrupt` 的语义是
 *      「有原始数据但读不出来」，与「真的没有数据」严格区分；
 *   2. 接线守则：hook 必须走这个解析、必须在写入前校验 `storageBlocked`、
 *      必须给用户「先备份再重置」的出口，且所有收藏入口都要把原因显示出来 ——
 *      拒绝写入却不能解释，只会变成「点了没反应」，比原来的静默覆盖更让人困惑。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FAVORITES_STORAGE_KEY,
  corruptBackupKey,
  describeCorruptFavorites,
  parseFavorites,
} from "@/lib/favorites-storage";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("parseFavorites：把「读不出来」和「没有数据」分开", () => {
  it("真的没有数据 → 空收藏，且**不算**损坏", () => {
    for (const raw of [null, undefined, ""]) {
      expect(parseFavorites(raw)).toEqual({ items: [], corrupt: false });
    }
  });

  it("合法的空数组 → 空收藏，且不算损坏（与损坏必须可区分）", () => {
    expect(parseFavorites("[]")).toEqual({ items: [], corrupt: false });
  });

  it("正常数据 → 原样读出", () => {
    const raw = JSON.stringify([{ siteId: "a", title: "A", href: "https://a.example.com", createdAt: 1 }]);
    const r = parseFavorites<{ siteId: string }>(raw);
    expect(r.corrupt).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.siteId).toBe("a");
  });

  it("半截 JSON → 判定为损坏（关键：不能等于空收藏）", () => {
    const r = parseFavorites('[{"siteId":"a"');
    expect(r.corrupt).toBe(true);
    expect(r.items).toEqual([]);
  });

  it("结构不是数组（旧格式 / 被改写）→ 判定为损坏", () => {
    for (const raw of ['{"items":[]}', "null", "123", '"x"', "{}", "true"]) {
      expect(parseFavorites(raw).corrupt, raw).toBe(true);
    }
  });

  it("备份键带时间戳，连续损坏不会互相覆盖", () => {
    expect(corruptBackupKey(1)).toBe(`${FAVORITES_STORAGE_KEY}.corrupt.1`);
    expect(corruptBackupKey(1)).not.toBe(corruptBackupKey(2));
  });

  it("给用户的原因说明必须指出去路（备份 / 重置）", () => {
    const note = describeCorruptFavorites();
    expect(note.length).toBeGreaterThan(20);
    expect(note).toContain("覆盖");
    expect(note).toMatch(/备份|重置/);
  });
});

describe("接线守则：读不出来就拒绝写入，并且要让用户知道", () => {
  const hook = read("src/hooks/useFavorites.ts");

  it("loadLocal 必须走 parseFavorites，不许自己 JSON.parse 后就地吞掉", () => {
    const body = hook.slice(hook.indexOf("function loadLocal"), hook.indexOf("function saveLocal"));
    expect(body).toContain("parseFavorites");
    expect(body).not.toContain("JSON.parse");
    expect(body).toContain("blocked");
  });

  it("persist 必须先校验 storageBlocked，再动 saveLocal", () => {
    const body = hook.slice(hook.indexOf("const persist = useCallback"), hook.indexOf("const resetLocal = useCallback"));
    expect(body).toMatch(/if \(storageBlocked\) return false/);
    expect(body.indexOf("storageBlocked")).toBeLessThan(body.indexOf("saveLocal("));
  });

  it("必须给用户「先备份再重置」的出口，而不是永久拒绝写入", () => {
    expect(hook).toContain("resetLocal");
    expect(hook).toContain("corruptBackupKey");
  });

  it("重置的备份要回读确认并如实返回，界面不能一律说「已备份」", () => {
    const body = hook.slice(
      hook.indexOf("const resetLocal = useCallback"),
      hook.indexOf("const isFavorite = useCallback"),
    );
    expect(body).toContain("{ backedUp: boolean }");
    // 写完立刻读回来比对：setItem 静默失败时不能宣称已留档
    expect(body).toMatch(/window\.localStorage\.getItem\(backupKey\) === raw/);
    expect(body).not.toContain("console.warn");

    const page = read("src/app/favorites/page.tsx");
    expect(page).toContain("const { backedUp } = favorites.resetLocal()");
    expect(page).toMatch(/backedUp\s*\?[\s\S]*没能留档/);
  });

  it("云端同步不能把「读不出来」报成「本地 0 条」", () => {
    const body = hook.slice(
      hook.indexOf("export async function syncFavoritesToCloud"),
      hook.indexOf("let pushed = 0"),
    );
    expect(body).toMatch(/if \(blocked\)/);
    expect(body).toContain("retryable: false");
  });

  it("收藏页要把原因和出口显示出来（否则就是点了没反应）", () => {
    const page = read("src/app/favorites/page.tsx");
    expect(page).toContain("favorites.storageBlocked");
    expect(page).toContain("favorites.resetLocal");
  });

  it("所有能触发收藏写入的入口都要先检查 storageBlocked", () => {
    for (const rel of ["src/components/favorite-button.tsx", "src/components/search-palette.tsx"]) {
      const src = read(rel);
      expect(src, rel).toContain("storageBlocked");
      const checkAt = src.indexOf("storageBlocked");
      const writeAt = src.indexOf("favorites.toggle");
      expect(writeAt, `${rel} 里没有找到 favorites.toggle`).toBeGreaterThan(-1);
      expect(checkAt, `${rel} 的检查必须在写入之前`).toBeLessThan(writeAt);
    }
  });
});
