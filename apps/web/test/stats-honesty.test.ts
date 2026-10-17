/**
 * 运营与搜索洞察看板（`/admin/stats`）：**拉取失败不许说成「没有数据」**。
 *
 * 改前（`admin/stats/page.tsx`）：
 *
 *     .catch((err) => {
 *       console.error('Failed to load stats trends:', err)   // ← 只写控制台
 *     })
 *
 * `data` 就此停在 `null`，于是三块卡片各自渲染自己的空态：
 *
 *   - 「暂无搜索统计记录」
 *   - 「太棒了！近期没有任何未命中的零结果搜索。」   ← 拿故障当成绩恭喜管理员
 *   - 「暂无热度数据（可运行 recompute_rank 任务生成）」← 怂恿为一次失败跑一个重排任务
 *
 * 巡检趋势那张图更直接：`health || []` 把「没拿到」喂给图表，画出一条空的趋势线。
 *
 * 现在：失败记进 `loadError`，页面上有一条持续可见的失败条（含真实原因与重试）；
 * 所有「暂无…」都经过 `emptyHint()`，在「加载失败且没有可用数据」时改口说
 * 「没能加载出来」；巡检图也不再拿空数组冒充「趋势是零」。
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
const STATS = "src/app/admin/stats/page.tsx";

function raw(): string {
  return readFileSync(join(ROOT, STATS), "utf8");
}

/** 剥注释但保留行列位置（注释里正当地写着「太棒了」这样的反例） */
function code(): string {
  const noBlock = raw().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

describe("拉取失败：必须有持续可见的失败态", () => {
  it("失败被记录（既有错误、也有清除）", () => {
    const src = code();
    // 统计趋势请求现在过闸门，错误对象叫 out.error；两种写法都算「失败被记录」
    expect(
      src.includes("setLoadError(err)") || src.includes("setLoadError(out.error)"),
    ).toBe(true);
    expect(src).toContain("setLoadError(null)");
    expect(src).toContain("const degradeNotice = loadError ? describeDegrade(loadError) : null");
  });

  it("失败条区分「首次没拿到」与「刷新失败，下面是上次数据」，并给重试", () => {
    const src = code();
    expect(src).toContain("没能取回统计趋势。");
    expect(src).toContain("本次刷新失败，下面是上一次成功获取的统计趋势。");
    expect(src).toContain("degradeNotice.retryable");
    expect(src).toMatch(/role="status"/);
  });
});

describe("空态文案：失败时改口，不许把故障说成没数据", () => {
  it("emptyHint 的判定就是「加载失败且没有可用数据」", () => {
    const src = code();
    const hintAt = src.indexOf("const emptyHint = (normal: string) =>");
    expect(hintAt).toBeGreaterThan(-1);
    const hintBlock = src.slice(hintAt, src.indexOf("emptyHint('暂无搜索统计记录')"));
    expect(hintBlock).toContain("loadError && !data");
    expect(hintBlock).toContain("统计趋势没能加载出来（见上方说明）");
    // 失败措辞里不许出现「暂无 / 太棒了」这类「其实没事」的说法
    expect(hintBlock).not.toContain("暂无");
    expect(hintBlock).not.toContain("太棒了");
  });

  it("三处空态全部改走 emptyHint（包括那句「太棒了」）", () => {
    const src = code();
    expect(src).toContain("emptyHint('暂无搜索统计记录')");
    expect(src).toContain("emptyHint('太棒了！近期没有任何未命中的零结果搜索。')");
    expect(src).toContain("emptyHint('暂无热度数据（可运行 recompute_rank 任务生成）')");
    // 恰好三处调用，避免有人漏改或多改（定义写的是 `emptyHint = (`，不含在内）
    expect(src.match(/emptyHint\(/g) || []).toHaveLength(3);
  });

  it("巡检趋势图不再拿空数组冒充「趋势为零」", () => {
    const src = code();
    const failAt = src.indexOf("loadError && !data");
    const chartAt = src.indexOf("<HealthTrendChart");
    expect(failAt).toBeGreaterThan(-1);
    expect(chartAt).toBeGreaterThan(failAt);
    expect(src).toContain("巡检趋势没能加载出来（见上方说明）。");
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了真实页面源码", () => {
    const src = raw();
    expect(src.length).toBeGreaterThan(8000);
    expect(src).toContain("运营与搜索洞察看板");
    expect(src).toContain("HealthTrendChart");
  });
});
