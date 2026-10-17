/**
 * 中枢请求失败必须有**去处**，不能悄悄消失。
 *
 * 真实缺陷（/admin/audit）：加载用的是裸的 promise 链
 *
 *     void hubGet<AuditResponse>(url).then((d) => {
 *       setItems(...); setHasMore(...); setActions(...); setLoading(false)
 *     })
 *
 * 没有 `.catch()`。中枢挂掉时 `setLoading(false)` 永远不执行 —— 页面就永远停在
 * 「加载中…」，用户看不到原因、没有重试入口，只能反复刷新。这比「显示暂无数据」
 * 更糟：连「出事了」这个信息都没传达出去。
 *
 * 这里守两件事：
 *   1. 全仓不允许再出现 `hubGet` / `hubSend` 的 `.then()` 链而不带 `.catch()`
 *      —— 统一用 async/await + try/catch/finally，让失败一定落到某个状态里；
 *   2. 审计页的接线正确：失败落到 `loadError`，`finally` 里一定关掉 loading，
 *      界面按「加载中 → 取回失败 → 暂无 → 表格」的顺序判定，并有重试入口。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

const AUDIT = "src/app/admin/audit/page.tsx";

/** 找 `hubGet/hubSend` 的 `.then()` 链，向上看 12 行内是否出现 `.catch(` */
function floatingHubChains(): string[] {
  const offenders: string[] = [];
  for (const rel of listSources(join(ROOT, "src"))) {
    const lines = overlaySource(rel).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\bhub(Get|Send)\b/.test(line)) return;
      if (!/\.then\(/.test(line)) return;
      const around = lines.slice(i, i + 12).join(" ");
      if (/\.catch\(/.test(around)) return;
      offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

describe("中枢 promise 链不允许没有 catch", () => {
  it("扫描确实看到了中枢调用（否则空数组会假装通过）", () => {
    const all = listSources(join(ROOT, "src"))
      .map((rel) => overlaySource(rel))
      .filter((src) => /\bhub(Get|Send)\b/.test(src));
    expect(all.length).toBeGreaterThan(5);
    expect(all.join("\n")).toContain("hubGet");
  });

  it("没有 `hubGet(...).then(...)` 这种会吞掉失败的写法", () => {
    expect(floatingHubChains()).toEqual([]);
  });
});

describe("/admin/audit：失败必须变成可见状态而不是永久「加载中」", () => {
  it("用 async/await 包住，并保证 finally 里关掉 loading", () => {
    const src = overlaySource(AUDIT);
    expect(src).toContain("await hubGet<AuditResponse>");
    expect(src).toContain("catch (error)");
    expect(src).toContain("setLoadError(error)");
    expect(src).toContain("} finally {");
    expect(src).toContain("setLoading(false)");
    // 旧的裸链条不允许回来
    expect(src).not.toContain(").then((d) => {");
  });

  it("成功时清掉上一次的错误", () => {
    const src = overlaySource(AUDIT);
    expect(src).toContain("setLoadError(null)");
  });

  it("提示走统一的 describeDegrade（不自己编一套文案）", () => {
    const src = overlaySource(AUDIT);
    expect(src).toContain("describeDegrade(loadError)");
  });

  it("判定顺序：加载中 → 取回失败 → 暂无 → 表格（失败绝不能落到「暂无」）", () => {
    const src = overlaySource(AUDIT);
    const loadingAt = src.indexOf("加载中…");
    const degradedAt = src.indexOf("notice && items.length === 0");
    const emptyAt = src.indexOf("暂无审计记录");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(degradedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeLessThan(degradedAt);
    expect(degradedAt).toBeLessThan(emptyAt);
    // 降级块必须说清「记录没被删」
    expect(src).toContain("审计记录并未被删除");
  });

  it("有重试入口，且重试先回到加载中再重新请求第一页", () => {
    const src = overlaySource(AUDIT);
    const from = src.indexOf("const retry =");
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf("}, [action, actor])", from));
    expect(body.indexOf("setLoading(true)")).toBeGreaterThan(-1);
    expect(body.indexOf("setItems([])")).toBeGreaterThan(-1);
    expect(body.indexOf("load(0)")).toBeGreaterThan(-1);
    expect(body.indexOf("setLoading(true)")).toBeLessThan(body.indexOf("load(0)"));
    // 界面上真的挂了重试按钮
    expect(src).toContain("onClick={retry}");
  });

  it("翻页失败时保留已加载的记录，并说明「加载更多」可以重试", () => {
    const src = overlaySource(AUDIT);
    expect(src).toContain("已加载的记录仍然可用");
  });
});
