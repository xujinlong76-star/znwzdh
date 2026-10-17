/**
 * 管理端实时遥测面板：**不许把「解析失败」显示成「就绪」**。
 *
 * 改前的两个真实缺陷（`admin/AdminDashboardClient.tsx`）：
 *
 * 1. `tick` / `init` 的 `JSON.parse` 失败时是空 catch —— 连接还是通的，
 *    于是徽标一直是绿色的「SSE 遥测就绪」，而 `setData` 根本没执行，
 *    面板上的「实时」数字**冻在旧值**。
 * 2. `fetchFullDashboard` 失败时只 `console.error` —— 首屏拉取失败时，
 *    页面会永远停在「正在加载…」，用户既不知道原因也没有重试入口。
 *
 * 这里既测纯函数（`lib/telemetry-status.ts`），也用源码守卫确认组件
 * 真的按这套状态渲染、并且那两处失败都被如实承接。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeTelemetry, telemetryState } from "../src/lib/telemetry-status";

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

/** 剥注释但保留行列位置：文档注释里会正当提到 `sseStatus === 'connected'` 这类反例 */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

const DASHBOARD = "src/app/admin/AdminDashboardClient.tsx";

describe("连接状态 + 解析失败条数 → 面板状态", () => {
  it("连接断了就是离线（跟解析失败多少条无关）", () => {
    expect(telemetryState("disconnected", 0)).toBe("offline");
    expect(telemetryState("disconnected", 5)).toBe("offline");
  });

  it("还没连上就是连接中", () => {
    expect(telemetryState("connecting", 0)).toBe("connecting");
    expect(telemetryState("connecting", 3)).toBe("connecting");
  });

  it("只有「连着 + 一条都没解析失败」才算实时正常", () => {
    expect(telemetryState("connected", 0)).toBe("live");
  });

  it("连着但有消息解析失败 → 冻结态（不是 live）", () => {
    expect(telemetryState("connected", 1)).toBe("stale");
    expect(telemetryState("connected", 99)).toBe("stale");
  });
});

describe("每种状态都要说清后果", () => {
  it("正常态才可以说「就绪」", () => {
    const live = describeTelemetry("connected", 0);
    expect(live.state).toBe("live");
    expect(live.label).toContain("就绪");
    expect(live.detail).toContain("更新");
  });

  it("冻结态必须承认数值可能停在旧值，且绝不含「就绪」", () => {
    const stale = describeTelemetry("connected", 4);
    expect(stale.state).toBe("stale");
    expect(stale.label).toContain("失败");
    expect(stale.label).toContain("4");
    expect(stale.label).not.toContain("就绪");
    expect(stale.detail).toContain("停在旧值");
  });

  it("离线态也不许说「就绪」，并给出刷新退路", () => {
    const offline = describeTelemetry("disconnected", 0);
    expect(offline.label).toBe("离线");
    expect(offline.detail).toContain("停在旧值");
    expect(offline.detail).toContain("刷新");
    expect(offline.label).not.toContain("就绪");
    expect(offline.detail).not.toContain("就绪");
  });

  it("连接中不会宣称已经正常", () => {
    const connecting = describeTelemetry("connecting", 0);
    expect(connecting.label).toBe("连接中");
    expect(connecting.label).not.toContain("就绪");
    expect(connecting.detail).not.toContain("遥测正常");
  });

  it("失败条数取整、负数当作 0（不出现「-3 条」这种胡话）", () => {
    expect(describeTelemetry("connected", 2.7).label).toContain("2");
    expect(describeTelemetry("disconnected", -3).label).toBe("离线");
  });
});

describe("组件真的按这套状态渲染，且失败被如实承接", () => {
  const code = stripComments(overlaySource(DASHBOARD));

  it("两处实时消息解析失败都会计数（init + tick），成功时清零", () => {
    expect(code.match(/setSseParseFailures\(\(n\) => n \+ 1\)/g) || []).toHaveLength(2);
    expect(code.match(/setSseParseFailures\(0\)/g) || []).toHaveLength(2);
    // 回归保护：这两个 catch 块不许再退回空的
    expect(code).not.toMatch(/catch\s*\{\s*\}/);
  });

  it("徽标文案与配色都来自状态函数，不再自己写死「就绪」", () => {
    expect(code).toContain("describeTelemetry(sseStatus, sseParseFailures)");
    expect(code).toContain("TELEMETRY_BADGE[telemetry.state]");
    expect(code).toContain("TELEMETRY_DOT[telemetry.state]");
    expect(code).toContain("title={telemetry.detail}");
    // 硬编码的绿色「就绪」必须消失（否则解析失败时还是绿的）
    expect(code).not.toContain("SSE 遥测就绪'");
    expect(code).not.toContain("? 'SSE 遥测就绪'");
  });

  it("首屏拉取失败不再只写控制台：有失败态、有原因、有重试", () => {
    expect(code).toContain("setLoadError(err)");
    expect(code).toContain("setLoadError(null)");
    expect(code).toContain("describeDegrade(loadError)");
    expect(code).toContain("onClick={() => fetchFullDashboard(true)}");
    expect(code).toMatch(/role="status"/);
  });

  it("失败态文案区分「首次没拿到」与「刷新失败，下面是上次数据」", () => {
    expect(code).toContain("本次刷新失败，下面是上一次成功获取的数据。");
    expect(code).toContain("没能取回监控数据。");
    // 「正在加载」只能是初始状态，不能在没有数据时永远挂着而没有任何提示
    expect(code).toContain("degradeNotice && (");
  });
});

describe("守卫不是空跑", () => {
  it("确实读到了真实组件源码", () => {
    const raw = overlaySource(DASHBOARD);
    expect(raw.length).toBeGreaterThan(20000);
    expect(raw).toContain("export function AdminDashboardClient");
  });
});
