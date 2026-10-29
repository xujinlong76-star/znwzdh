/**
 * 视频分类条目编辑页（一对孪生页面）：**拉取失败不许说成「分类不存在」或「这里本来就没条目」**。
 *
 * 改前两处都是「catch 里只弹一个 5 秒的 toast」：
 *
 *   admin/videos/[id]/items/page.tsx
 *     } catch (error) {
 *       console.error(error)
 *       toast({ title: "错误", description: "获取数据失败", variant: "destructive" })
 *     }
 *     …
 *     if (!navigation) {
 *       return <p>视频分类不存在</p>          // ← 请求失败 = 「分类真的不存在」
 *     }
 *
 *   admin/videos/[id]/categories/[categoryId]/items/page.tsx
 *     … 同样是 catch 里只 toast …
 *     render 用 subCategory?.items 渲染，失败时列表为空 = 「这个子分类下面是空的」
 *
 * toast 只活 5 秒；之后页面的唯一表述就是「不存在」/「空的」。而且这两个页面
 * 各自都有一条**真正**的「不存在」路径（`!navigation` / 找不到子分类后跳回），
 * 混在一起之后没法区分「真的没有」和「没拿到」。
 *
 * 现在：失败记进 `loadError`，渲染时**先于**「不存在」/空列表判断，
 * 显示失败态 + 真实原因（`describeDegrade`）+ 重试。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
const ITEMS = "src/app/admin/videos/[id]/items/page.tsx";
const SUB_ITEMS = "src/app/admin/videos/[id]/categories/[categoryId]/items/page.tsx";

function raw(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 剥注释但保留行列位置（注释里正当地写着旧的「获取数据失败」） */
function code(rel: string): string {
  const noBlock = raw(rel).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

describe("视频分类条目页：失败必须能被「一直看见」", () => {
  for (const rel of [ITEMS, SUB_ITEMS]) {
    const name = rel.includes("/categories/") ? "子分类条目页" : "分类条目页";

    it(`${name}：失败被记录（既有错误、也有清除）`, () => {
      const src = code(rel);
      expect(src).toContain("setLoadError(error)");
      expect(src).toContain("setLoadError(null)");
      expect(src).toContain("const [loadError, setLoadError] = useState<unknown>(null)");
    });

    it(`${name}：toast 说的是真实原因，不再是笼统的「获取数据失败」`, () => {
      const src = code(rel);
      expect(src).toContain("description: describeDegrade(error).message");
      expect(src).not.toContain('description: "获取数据失败"');
    });

    it(`${name}：失败态给真实原因和重试入口，且不混用「不存在 / 空的」那套文案`, () => {
      const src = code(rel);
      const anchor = rel.includes("/categories/") ? "if (loadError && !subCategory)" : "if (loadError && !navigation)";
      const at = src.indexOf(anchor);
      expect(at).toBeGreaterThan(-1);
      // 失败分支到它自己的收尾大括号为止（不要误取到后面「不存在」那个分支）
      const end = src.indexOf("\n    }", at);
      expect(end).toBeGreaterThan(at);
      const block = src.slice(at, end);
      expect(block).toContain("describeDegrade(loadError)");
      expect(block).toContain("notice.message");
      expect(block).toContain("重试");
      expect(block).toContain("fetchNavigation()");
      expect(block).not.toContain("视频分类不存在");
      expect(block).not.toContain("Inbox");
    });
  }
});

describe("失败分支必须排在「不存在 / 空列表」之前", () => {
  it("分类条目页：失败分支早于「视频分类不存在」与空列表", () => {
    const src = code(ITEMS);
    const failAt = src.indexOf("if (loadError && !navigation)");
    const notFoundAt = src.indexOf("视频分类不存在");
    // 该页后来加了分页：空态判断从 `filteredItems.length === 0` 变成
    // `pagedItems.length > 0 ? 列表 : 空态`（先切片再判断）。守卫要守的是
    // 「失败分支排在空态之前」，不是某个具体变量名，所以跟着改符号。
    const emptyAt = src.indexOf("pagedItems.length > 0", failAt);
    expect(failAt).toBeGreaterThan(-1);
    expect(notFoundAt).toBeGreaterThan(failAt);
    expect(emptyAt, "空态分支没找到（分页后再改名就要同步这里）").toBeGreaterThan(failAt);
  });

  it("子分类条目页：失败分支早于条目列表与空列表", () => {
    const src = code(SUB_ITEMS);
    const failAt = src.indexOf("if (loadError && !subCategory)");
    const listAt = src.indexOf("subCategory?.items && subCategory.items.length > 0", failAt);
    const emptyAt = src.indexOf("filteredItems.length === 0", failAt);
    expect(failAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(failAt);
    expect(emptyAt).toBeGreaterThan(failAt);
  });
});

describe("真正「不存在」的那条路径没有被吃掉", () => {
  it("分类条目页仍然保留「视频分类不存在」", () => {
    expect(code(ITEMS)).toContain("视频分类不存在");
  });

  it("子分类条目页仍然保留「子分类不存在」并跳回分类列表", () => {
    const src = code(SUB_ITEMS);
    expect(src).toContain("子分类不存在");
    expect(src).toContain("router.push(`/admin/videos/${params.id}/categories`)");
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了两个真实页面源码", () => {
    const a = raw(ITEMS);
    const b = raw(SUB_ITEMS);
    expect(a.length).toBeGreaterThan(8000);
    expect(b.length).toBeGreaterThan(8000);
    expect(a).toContain("fetchNavigation");
    expect(b).toContain("fetchNavigation");
  });
});
