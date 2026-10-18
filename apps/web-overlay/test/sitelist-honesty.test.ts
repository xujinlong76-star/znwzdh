/**
 * 站点管理页（`/admin/sitelist`，管理端最核心的一页）：**拉取失败不许渲染成
 * 「暂无站点 · 开始添加您的第一个站点吧」**。
 *
 * 改前（`admin/sitelist/page.tsx` 的 `fetchSites`）：
 *
 *     } catch (error) {
 *       toast({ title: "错误", description: "获取数据失败", variant: "destructive" })
 *       setSites([])          // ← 把已有列表清空
 *     }
 *
 * 于是：拉取失败时弹一个 5 秒的 toast（姑且算通知到了），但 toast 一过，页面就
 * 停在「暂无站点 · 开始添加您的第一个站点吧」—— 运维看到的是「一个站点都没有」，
 * 甚至会怀疑数据被清空了；刷新失败时还会把**已经加载好的列表**一并抹掉。
 *
 * 现在：失败记进 `loadError`；列表非空时保留旧数据并明说「本次刷新失败，下面是
 * 上一次成功获取的站点列表」；列表为空时显示失败态 + 真实原因 + 重试。
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
const SITELIST = "src/app/admin/sitelist/page.tsx";

function raw(): string {
  return readFileSync(join(ROOT, SITELIST), "utf8");
}

/** 剥注释但保留行列位置（注释里正当地写着「以前会 setSites([])」这样的反例） */
function code(): string {
  const noBlock = raw().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

describe("拉取失败：不许说成「暂无站点」", () => {
  it("失败被持续记录下来（既有错误、也有清除）", () => {
    const src = code();
    expect(src).toContain("setLoadError(error)");
    expect(src).toContain("setLoadError(null)");
    expect(src).toContain("const degradeNotice = loadError ? describeDegrade(loadError) : null");
  });

  it("刷新失败不再清空已加载的列表", () => {
    // 这是本次最实质的行为改动：失败时保留旧数据，只标注「这是上一次成功的数据」
    expect(code()).not.toContain("setSites([])");
    expect(code()).toContain("degradeNotice && sites.length > 0");
    expect(code()).toContain("本次刷新失败，下面是上一次成功获取的站点列表。");
  });

  it("失败态排在「暂无站点」前面 —— 否则故障还是会被说成「一个站点都没有」", () => {
    const src = code();
    const failureAt = src.indexOf("degradeNotice && sites.length === 0");
    const emptyAt = src.indexOf("暂无站点");
    expect(failureAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(failureAt).toBeLessThan(emptyAt);
  });

  it("失败态给真实原因和重试入口，且不混用「暂无」那套文案", () => {
    const src = code();
    const failureAt = src.indexOf("degradeNotice && sites.length === 0");
    const failureBlock = src.slice(failureAt, src.indexOf("暂无站点"));
    expect(failureBlock).toContain("站点列表没能加载出来");
    expect(failureBlock).toContain("degradeNotice.message");
    expect(failureBlock).toContain("重试");
    expect(failureBlock).not.toContain("暂无");
    expect(failureBlock).not.toContain("开始添加您的第一个站点吧");
  });

  it("失败 toast 说的是真实原因，不再是笼统的「获取数据失败」", () => {
    const src = code();
    expect(src).toContain("description: notice.message");
    expect(src).not.toContain('description: "获取数据失败"');
  });
});

describe("顺带清理：调试日志不许留在生产里", () => {
  it("这个页面的 console.log 全部清掉", () => {
    // 改前这里每次渲染都会打「Component rendering」/「Making API request」等
    expect(code()).not.toContain("console.log(");
    // 但真正的失败日志要保留
    expect(code()).toContain("console.error('Fetch error:', error)");
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了真实页面源码", () => {
    const src = raw();
    expect(src.length).toBeGreaterThan(40000);
    expect(src).toContain("export default function SiteListPage");
    expect(src).toMatch(/role="status"/);
  });
});
