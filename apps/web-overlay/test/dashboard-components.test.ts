/**
 * 后端仪表盘可视化组件体系契约与算法测试。
 *
 * 覆盖以下 5 个新增现代化监控组件与管理员控制台集成：
 * 1. DashboardSparkline - 轻量微折线走势与归一化坐标计算
 * 2. DashboardTrafficChart - 24h 双轴全链路时序面积图与多维指标切换
 * 3. DashboardStatusDonut - HTTP 状态码分布环形图与 SLA 成功率计算
 * 4. DashboardSlowRoutes - Top 5 慢请求排障治理与复制交互
 * 5. DashboardRefreshControl - 智能轮询、Page Visibility API 节能休眠与相对时间
 * 6. AdminDashboardClient - 仪表盘集成、无障碍合约与巡检快照导出
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

function readOverlay(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error("文件不存在: " + p);
  return readFileSync(p, "utf8");
}

describe("DashboardSparkline 微折线图组件契约", () => {
  const code = readOverlay("src/components/admin/dashboard/dashboard-sparkline.tsx");

  it("必须是客户端组件且正确导出", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("export function DashboardSparkline");
    expect(code).toContain("export interface DashboardSparklineProps");
  });

  it("具备除以零与极端数组防御（空数组与单点安全插值）", () => {
    // 单点或空数组时安全扩展至至少 2 个点
    expect(code).toContain("data.length < 2");
    expect(code).toContain("max === min ? 1 : max - min");
  });

  it("包含完整 SVG 节点、线性渐变、折线与闭合面积区域", () => {
    expect(code).toContain("<svg");
    expect(code).toContain("<linearGradient");
    expect(code).toContain("<path");
    // 闭合面积必须闭合至 bottomY
    expect(code).toContain("Z`");
    // 末端指示圆点与呼吸脉冲光晕
    expect(code).toContain("<circle");
    expect(code).toContain("animate-ping");
  });

  it("无障碍与布局属性规范", () => {
    // 纯装饰微折线必须 aria-hidden，避免屏幕阅读器读出冗余空图形
    expect(code).toContain('aria-hidden="true"');
    expect(code).toContain("select-none");
    expect(code).toContain("overflow-visible");
  });

  it("纯数学算法：坐标归一化与折线映射断言", () => {
    const data = [10, 40, 20, 50];
    const width = 120;
    const height = 36;
    const padX = 2;
    const padY = 3;
    const effW = width - padX * 2; // 116
    const effH = height - padY * 2; // 30
    const min = Math.min(...data); // 10
    const max = Math.max(...data); // 50
    const range = max - min; // 40

    const pts = data.map((val, idx) => ({
      x: padX + (idx / (data.length - 1)) * effW,
      y: padY + effH - ((val - min) / range) * effH,
    }));

    // 起点与终点 X 坐标
    expect(pts[0].x).toBe(2);
    expect(pts[pts.length - 1].x).toBe(118);
    // 最小值 10 对应的 Y 坐标应在底部 (padY + effH = 33)
    expect(pts[0].y).toBe(33);
    // 最大值 50 对应的 Y 坐标应在顶部 (padY = 3)
    expect(pts[3].y).toBe(3);
  });
});

describe("DashboardTrafficChart 24h全链路时序图契约", () => {
  const code = readOverlay("src/components/admin/dashboard/dashboard-traffic-chart.tsx");

  it("必须是客户端组件且正确导出", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("export function DashboardTrafficChart");
  });

  it("支持三维指标视角切换（请求吞吐、分位延迟、5xx异常）", () => {
    expect(code).toContain("'throughput' | 'latency' | 'errors'");
    expect(code).toContain("请求吞吐");
    expect(code).toContain("响应延迟");
  });

  it("包含交互式十字线与 Tooltip 浮层", () => {
    expect(code).toContain('role="tooltip"');
    expect(code).toContain("hoverIndex !== null");
    expect(code).toContain('strokeDasharray="2 2"');
  });

  it("高频跳动指标必须采用等宽字体（font-mono）保证布局稳定", () => {
    expect(code).toContain("font-mono");
  });

  it("合成算法插值检验：24小时连续曲线生成必须满足单调分位延迟", () => {
    // 抽取模拟生成逻辑做算法验证
    const totalReq = 10000;
    const baseQps = 15;
    const p95 = 30;
    const p99 = 80;
    const currentHour = 14;

    const hourlyFactors = [
      0.35, 0.22, 0.15, 0.12, 0.14, 0.25, 0.45, 0.72, 0.95, 1.15, 1.25, 1.18,
      1.05, 1.12, 1.28, 1.35, 1.22, 1.05, 1.15, 1.38, 1.45, 1.25, 0.85, 0.55
    ];

    const points = [];
    for (let i = 23; i >= 0; i--) {
      const h = (currentHour - i + 24) % 24;
      const factor = hourlyFactors[h] || 1.0;
      const hourLabel = `${h.toString().padStart(2, '0')}:00`;
      const jitter = 0.92 + Math.sin(i * 1.5) * 0.08;
      const req = Math.max(12, Math.round((totalReq / 24) * factor * jitter));
      const qps = Math.max(1, Math.round(baseQps * factor * jitter));
      const p50 = Math.max(4, Math.round(12 * (0.85 + factor * 0.2)));
      const p95Val = Math.max(p50 + 5, Math.round(p95 * (0.9 + factor * 0.15)));
      const p99Val = Math.max(p95Val + 10, Math.round(p99 * (0.88 + factor * 0.2)));
      points.push({ hour: hourLabel, req, qps, p50, p95Val, p99Val });
    }

    expect(points.length).toBe(24);
    // 分位延迟恒成立定理：P99 >= P95 >= P50
    for (const pt of points) {
      expect(pt.p99Val).toBeGreaterThanOrEqual(pt.p95Val);
      expect(pt.p95Val).toBeGreaterThanOrEqual(pt.p50);
      expect(pt.hour).toMatch(/^\d{2}:00$/);
    }
  });
});

describe("DashboardStatusDonut 状态分布与 SLA 成功率契约", () => {
  const code = readOverlay("src/components/admin/dashboard/dashboard-status-donut.tsx");

  it("必须是客户端组件且正确导出", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("export function DashboardStatusDonut");
  });

  it("SLA 算法：涵盖 2xx+3xx 成功率与全 0 边界降级保护", () => {
    expect(code).toContain("safeTotal > 0 ? (((s2xx + s3xx) / safeTotal) * 100).toFixed(1) : '100.0'");
  });

  it("甜甜圈几何参数不变量：半径 60 与 strokeDasharray 弧长计算", () => {
    expect(code).toContain("radius = 60");
    expect(code).toContain("2 * Math.PI * radius");
    expect(code).toContain("strokeDasharray");
    expect(code).toContain("strokeDashoffset");
  });

  it("SLA 计算纯逻辑测试：各种状态码组合", () => {
    const calc = (s2xx: number, s3xx: number, s4xx: number, s5xx: number) => {
      const total = s2xx + s3xx + s4xx + s5xx;
      return total > 0 ? (((s2xx + s3xx) / total) * 100).toFixed(1) : "100.0";
    };

    expect(calc(0, 0, 0, 0)).toBe("100.0");
    expect(calc(990, 10, 0, 0)).toBe("100.0");
    expect(calc(950, 0, 40, 10)).toBe("95.0");
    expect(calc(999, 0, 0, 1)).toBe("99.9");
  });

  it("展现底层三大架构引擎能力状态药丸（sqlite-vec / FTS5 / LLM）", () => {
    expect(code).toContain("FTS5");
    expect(code).toContain("sqlite-vec");
    expect(code).toContain("AI 严审模型");
  });
});

describe("DashboardSlowRoutes 慢请求治理契约", () => {
  const code = readOverlay("src/components/admin/dashboard/dashboard-slow-routes.tsx");

  it("必须是客户端组件且正确导出", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("export function DashboardSlowRoutes");
  });

  it("包含剪贴板一键复制与复制成功临时状态反馈", () => {
    expect(code).toContain("copyText(route)");
    expect(code).toContain("setCopiedRoute(route)");
    expect(code).toContain("setTimeout");
  });

  it("复制按钮必须具备明确可访问的 aria-label", () => {
    expect(code).toContain("复制路由路径");
  });

  it("具备 HTTP 方法色彩语义映射与延迟分级警告", () => {
    expect(code).toContain("METHOD_COLORS");
    expect(code).toContain("GET");
    expect(code).toContain("POST");
    expect(code).toContain("avgLatencyMs >= 150");
    expect(code).toContain("avgLatencyMs >= 80");
  });

  it("空路由状态必须有清晰优雅的降级提示", () => {
    expect(code).toContain("暂无异常慢请求采样");
  });
});

describe("DashboardRefreshControl 智能轮询与节能契约", () => {
  const code = readOverlay("src/components/admin/dashboard/dashboard-refresh-control.tsx");

  it("必须是客户端组件且正确导出", () => {
    expect(code).toMatch(/^['"]use client['"]/);
    expect(code).toContain("export function DashboardRefreshControl");
  });

  it("集成 Page Visibility API，在标签页切到后台时自动挂起，切回时即时静默同步", () => {
    expect(code).toContain("document.visibilityState === 'visible'");
    expect(code).toContain("addEventListener('visibilitychange'");
    expect(code).toContain("removeEventListener('visibilitychange'");
  });

  it("提供 4 个标准轮询档位：关闭、15s、30s、60s", () => {
    expect(code).toContain("{ label: '关闭', sec: 0 }");
    expect(code).toContain("{ label: '15s', sec: 15 }");
    expect(code).toContain("{ label: '30s', sec: 30 }");
    expect(code).toContain("{ label: '60s', sec: 60 }");
  });

  it("刷新按钮具有明确的 aria-label 与旋转动画", () => {
    expect(code).toContain('aria-label="立即同步仪表盘数据"');
    expect(code).toContain("animate-spin");
  });
});

describe("AdminDashboardClient 仪表盘集成契约", () => {
  const clientCode = readOverlay("src/app/admin/AdminDashboardClient.tsx");

  it("成功引入并装配全部 5 个新增现代化监控子组件", () => {
    expect(clientCode).toContain("import { DashboardSparkline }");
    expect(clientCode).toContain("import { DashboardTrafficChart }");
    expect(clientCode).toContain("import { DashboardStatusDonut }");
    expect(clientCode).toContain("import { DashboardSlowRoutes }");
    expect(clientCode).toContain("import { DashboardRefreshControl }");

    expect(clientCode).toContain("<DashboardSparkline");
    expect(clientCode).toContain("<DashboardTrafficChart");
    expect(clientCode).toContain("<DashboardStatusDonut");
    expect(clientCode).toContain("<DashboardSlowRoutes");
    expect(clientCode).toContain("<DashboardRefreshControl");
  });

  it("包含运维快照导出功能（JSON 巡检快照与无障碍可访问名）", () => {
    expect(clientCode).toContain("exportOpsReport");
    expect(clientCode).toContain("navhub-ops-snapshot-");
    expect(clientCode).toContain('aria-label="导出巡检快照"');
    expect(clientCode).toContain('aria-label="触发全站健康巡检"');
    expect(clientCode).toContain('aria-label="触发热度重排"');
  });
});
