/**
 * 任务调度面板：**拉取失败不许渲染成「暂无匹配任务记录」**，
 * SSE 解析失败也不许继续宣称「实时推流已就绪」。
 *
 * 改前（`admin/jobs/page.tsx`）三处都在把失败说成事实：
 *
 *   1. `load()` 失败只 `console.error` → `jobs` 保持 `[]`，
 *      页面渲染「暂无匹配任务记录」：中枢挂了看起来像「没有任务」。
 *   2. `enqueue()` 失败只 `console.error` → 点「触发」后列表毫无变化，
 *      用户只能以为按钮坏了（同一个页面的「取消 / 重试」是会 alert 的）。
 *   3. SSE 事件解析失败被「忽略格式解析抖动」→ 徽标一直是绿色
 *      「SSE 实时推流已就绪」，而列表悄悄停止更新。
 *
 * 这个文件用源码守卫把这些行为钉住（状态机本身在 telemetry-status.test.ts 里测）。
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
const JOBS = "src/app/admin/jobs/page.tsx";

function raw(): string {
  return readFileSync(join(ROOT, JOBS), "utf8");
}

/** 剥注释但保留行列位置（注释里正当地写着「不许退回」的反例） */
function code(): string {
  const noBlock = raw().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

describe("拉取失败：不能显示成「暂无匹配任务记录」", () => {
  it("失败被记下来了（既有错误、也有清除）", () => {
    const src = code();
    expect(src).toContain("setLoadError(err)");
    expect(src).toContain("setLoadError(null)");
    expect(src).toContain("const degradeNotice = loadError ? describeDegrade(loadError) : null");
  });

  it("失败态排在「暂无」前面 —— 否则故障还是会被说成「没有任务」", () => {
    const src = code();
    const failureAt = src.indexOf("filteredJobs.length === 0 && degradeNotice");
    const emptyAt = src.indexOf("暂无匹配任务记录");
    expect(failureAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(failureAt).toBeLessThan(emptyAt);
  });

  it("失败态给出真实原因与重试入口，而不是「暂无」那套文案", () => {
    const src = code();
    const failureAt = src.indexOf("filteredJobs.length === 0 && degradeNotice");
    const failureBlock = src.slice(failureAt, src.indexOf("暂无匹配任务记录"));
    expect(failureBlock).toContain("degradeNotice.message");
    expect(failureBlock).toContain("没能取到任务列表");
    expect(failureBlock).toContain("重试");
    expect(failureBlock).not.toContain("暂无");
  });

  it("刷新失败但列表还有内容时，明说这是旧数据", () => {
    const src = code();
    expect(src).toContain("degradeNotice && jobs.length > 0");
    expect(src).toContain("本次刷新失败，下面是上一次成功获取的任务列表。");
  });
});

describe("SSE 解析失败：不许再说「实时推流已就绪」", () => {
  it("解析失败会计数，成功会清零", () => {
    const src = code();
    expect(src.match(/setSseParseFailures\(\(n\) => n \+ 1\)/g) || []).toHaveLength(1);
    expect(src.match(/setSseParseFailures\(0\)/g) || []).toHaveLength(1);
    // 回归保护：那个 catch 不许再退回「忽略格式解析抖动」式的空块
    expect(src).not.toMatch(/catch\s*\{\s*\}/);
  });

  it("徽标状态来自共享状态机，且「已就绪」只在 live 时出现", () => {
    const src = code();
    expect(src).toContain("telemetryState(sseConnected ? 'connected' : 'connecting', sseParseFailures)");
    const liveAt = src.indexOf("jobTelemetry === 'live'");
    const readyAt = src.indexOf("SSE 实时推流已就绪");
    expect(liveAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(liveAt);
    // 旧的写法（只看连接与否就报「已就绪」）必须消失
    expect(src).not.toContain("sseConnected ? 'SSE 实时推流已就绪'");
  });

  it("解析失败时徽标要说出条数，并说明轮询仍在兜底", () => {
    const src = raw();
    expect(src).toContain("SSE 消息解析失败（${sseParseFailures} 条）· 轮询兜底");
    expect(src).toContain("20 秒轮询仍在兜底");
  });
});

describe("入队失败：不能毫无反馈", () => {
  it("触发任务失败会告诉用户（与同页面的取消 / 重试一致）", () => {
    const src = code();
    expect(src).toContain("alert('触发任务失败: '");
    // 三层失败反馈必须都在：加载、入队、取消 / 重试
    expect((src.match(/alert\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了真实页面源码", () => {
    const src = raw();
    expect(src.length).toBeGreaterThan(12000);
    expect(src).toContain("任务调度与自动化中心");
    expect(src).toMatch(/role="status"/);
  });
});
