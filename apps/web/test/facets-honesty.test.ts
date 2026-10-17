/**
 * 多维分面治理页（`/admin/facets`）：**两个请求失败都不许说成「本来就是空的」**。
 *
 * 改前（`admin/facets/page.tsx`）：
 *
 *     void hubGet<FacetsResponse>('/api/facets')
 *       .then((res) => …)
 *       .catch(() => setData(null))          // ← 分面失败 = 空
 *       .finally(() => setLoading(false))
 *
 *     void hubGet<SiteSample[]>(`/api/sites?facets=…`)
 *       .then((sites) => setSiteSamples(…))
 *       .catch(() => setSiteSamples([]))     // ← 样例失败 = 空
 *
 * 后果：
 *   - 分面加载失败：`data` 为 null，Tabs（`data?.facets.map`）和选项矩阵
 *     （`filteredOptions` 为空）**什么都不画** —— 页面看起来只是「没有分面」，
 *     连一句解释都没有；
 *   - 样例站点加载失败：渲染成「暂无匹配站点（可使用 AI 富化或在站点编辑页手动
 *     标注该分面）」—— 拿一次网络失败去**建议管理员重做分类**。
 *
 * 现在：两个失败各自记进状态，页面上有持续可见的失败条（真实原因 + 重试），
 * 样例面板的失败分支排在「暂无匹配站点」之前，并且可以原地重试。
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
const FACETS = "src/app/admin/facets/page.tsx";

function raw(): string {
  return readFileSync(join(ROOT, FACETS), "utf8");
}

/** 剥注释但保留行列位置（注释里正当地写着旧的 `.catch(() => setData(null))`） */
function code(): string {
  const noBlock = raw().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

describe("分面请求失败：不再是一个「什么也不画」的空页面", () => {
  it("失败被记录（两个请求各自的错误与清除）", () => {
    const src = code();
    expect(src).toContain("setLoadError(err)");
    expect(src).toContain("setLoadError(null)");
    // 样例站点请求现在过闸门，错误对象叫 out.error；两种写法都算「失败被记录」
    expect(
      src.includes("setSamplesError(err)") || src.includes("setSamplesError(out.error)"),
    ).toBe(true);
    expect(src).toContain("setSamplesError(null)");
    expect(src).toContain("const degradeNotice = loadError ? describeDegrade(loadError) : null");
    expect(src).toContain("const samplesNotice = samplesError ? describeDegrade(samplesError) : null");
  });

  it("旧的静默 catch 必须消失", () => {
    const src = code();
    expect(src).not.toContain(".catch(() => setData(null))");
    expect(src).not.toContain(".catch(() => setSiteSamples([]))");
  });

  it("失败条区分「首次没拿到」与「刷新失败，下面是上次数据」，并给重试", () => {
    const src = code();
    expect(src).toContain("分面数据没能加载出来。");
    expect(src).toContain("本次刷新失败，下面是上一次成功获取的分面数据。");
    expect(src).toContain("degradeNotice.retryable");
    expect(src).toMatch(/role="status"/);
  });
});

describe("样例站点失败：不许再建议管理员去重做分类", () => {
  it("失败分支排在「暂无匹配站点」之前", () => {
    const src = code();
    const failAt = src.indexOf("samplesNotice ? (");
    const emptyAt = src.indexOf("暂无匹配站点");
    expect(failAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failAt);
  });

  it("失败时说清原因，且不得混入「暂无匹配站点 / 去手动标注」那套建议", () => {
    const src = code();
    const failAt = src.indexOf("samplesNotice ? (");
    const failBlock = src.slice(failAt, src.indexOf("暂无匹配站点"));
    expect(failBlock).toContain("样例站点没能加载出来。");
    expect(failBlock).toContain("samplesNotice.message");
    expect(failBlock).not.toContain("暂无匹配站点");
    expect(failBlock).not.toContain("AI 富化");
    expect(failBlock).not.toContain("手动标注");
  });

  it("失败时可以原地重试（样例请求抽成了 useCallback）", () => {
    const src = code();
    expect(src).toContain("const loadSamples = useCallback(");
    expect(src).toContain("onClick={() => loadSamples(activeTab, selectedOption)}");
    // 仍然由选中项驱动，选中/切换分面照常触发
    expect(src).toContain("loadSamples(activeTab, selectedOption)");
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了真实页面源码", () => {
    const src = raw();
    expect(src.length).toBeGreaterThan(8000);
    expect(src).toContain("多维分面体系治理");
    expect(src).toContain("命中站点样例");
  });
});
