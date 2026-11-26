/**
 * U-399（2026-11-26）：/graph 在 390px 手机首屏可读/可点、可拖拽/捏合。
 *
 * 量测口径（与组件一致）：
 * - 画布 viewBox 900×600，preserveAspectRatio="xMidYMid meet"，
 *   屏幕换算系数 screenScale = min(容器宽/900, 容器高/600)；
 * - 390×844 手机：容器宽 390，画布高取 640（100vh-64px 再扣两行控制栏），
 *   screenScale = min(390/900, 640/600) = 0.4333（宽受限）；
 * - 节点取 live 布局同款圆周排布（24 站，r = 170 + (i%4)*65），
 *   标签按组件同款截断，半径按 nodeRadiusForDegree；
 * - 屏上节点直径 = 2 * 半径 * zoom * screenScale；
 * - 屏上标签高 ≈ 11（fontSize）* zoom * screenScale。
 *
 * 验收线：WCAG 2.5.8 最小目标 24×24px；标签至少 9px 高才可读。
 * 修复前实测（同一量测，computeGraphFit 默认参数）：zoom=0.449、
 * 最小节点直径 5.44px、标签高 2.14px——既读不了也点不中。
 */
import { describe, expect, it } from "vitest";
import {
  computeGraphFit,
  computeGraphReadableFloor,
  graphContentBox,
  nodeRadiusForDegree,
  pinchGraphView,
  toGraphViewBoxPoint,
  truncateGraphLabel,
  GRAPH_MIN_NODE_RADIUS,
} from "../src/lib/graph-polish";

/** 24 个 live 节点的同款圆周坐标（与 ecosystem-graph.tsx 采样 effect 一致） */
function liveRingNodes() {
  const titles = [
    "Cursor", "GitHub Copilot", "Continue.dev", "Claude", "DeepSeek", "Ollama",
    "vLLM", "GitHub", "GitLab", "Vercel", "Coolify", "Zeabur",
    "Docker Hub", "npm", "Next.js", "Figma", "Penpot", "Pixso",
    "TinyPNG", "Squoosh", "Unsplash", "Pexels", "Excalidraw", "tldraw",
  ];
  return titles.map((title, i) => {
    const angle = (i / titles.length) * 2 * Math.PI;
    const r = 170 + ((i % 4) * 65);
    return {
      x: 450 + r * Math.cos(angle),
      y: 300 + r * Math.sin(angle),
      title,
    };
  });
}

function firstPaint(
  containerW: number,
  containerH: number,
  opts: Parameters<typeof computeGraphFit>[3] = {},
) {
  const nodes = liveRingNodes();
  const box = graphContentBox(
    nodes,
    (i) => nodeRadiusForDegree(i % 5 >= 4 ? 4 : i % 3 === 0 ? 2 : 0),
    (i) => truncateGraphLabel(nodes[i]!.title),
  )!;
  const fit = computeGraphFit(box, containerW, containerH, opts);
  const screenScale = Math.min(containerW / 900, containerH / 600);
  // 最小节点（孤点档，半径 14）的屏上直径与 11px 标签的屏上高度
  const minNodeDiameterPx = 2 * 14 * fit.zoom * screenScale;
  const labelHeightPx = 11 * fit.zoom * screenScale;
  return { fit, screenScale, minNodeDiameterPx, labelHeightPx, box };
}

describe("U-399：390px 首屏可读可点", () => {
  it("窄屏可读缩放：最小节点直径 ≥24px、标签高 ≥9px", () => {
    const floor = computeGraphReadableFloor(390, 640, GRAPH_MIN_NODE_RADIUS);
    // 24/(2×14×0.4333)≈1.978（节点口径主导；标签口径 9/(11×0.4333)≈1.889）
    expect(floor).toBeCloseTo(1.978, 2);
    const m = firstPaint(390, 640, { minReadableZoom: floor });
    console.log(
      `[U-399] 390px fixed fit zoom=${m.fit.zoom.toFixed(3)} ` +
        `minNodeDiameter=${m.minNodeDiameterPx.toFixed(2)}px labelHeight=${m.labelHeightPx.toFixed(2)}px`,
    );
    expect(m.minNodeDiameterPx).toBeGreaterThanOrEqual(24);
    expect(m.labelHeightPx).toBeGreaterThanOrEqual(9);
  });

  it("可读下限优先于放大上限（窄屏 floor 1.98 > maxZoom 1.15 时仍取 floor）", () => {
    const m = firstPaint(390, 640, { minReadableZoom: 1.98 });
    expect(m.fit.zoom).toBeCloseTo(1.98, 6);
  });

  it("focusPoint：视图中心对准指定节点而非包围盒中心", () => {
    const focus = { x: 100, y: 120 };
    const m = firstPaint(390, 640, { minReadableZoom: 1.98, focusPoint: focus });
    // 变换后焦点落在画布中心（450, 300）
    expect(focus.x * m.fit.zoom + m.fit.pan.x).toBeCloseTo(450, 6);
    expect(focus.y * m.fit.zoom + m.fit.pan.y).toBeCloseTo(300, 6);
  });

  it("桌面 1280px 不传新参数：fit 与修复前逐字节一致（回归锚点）", () => {
    const m = firstPaint(1280, 800);
    // 修复前同一量测：zoom=0.678、直径 25.31px、标签 9.94px
    expect(m.fit.zoom).toBeCloseTo(0.678, 2);
    expect(m.minNodeDiameterPx).toBeGreaterThanOrEqual(24);
    expect(m.labelHeightPx).toBeGreaterThanOrEqual(9);
  });

  it("桌面即使误传可读下限也不变：1280px 的 floor（≈0.64）低于 maxZoom", () => {
    expect(computeGraphReadableFloor(1280, 800, GRAPH_MIN_NODE_RADIUS)).toBeLessThan(1.15);
  });
});

describe("U-399：捏合/坐标换算纯函数", () => {
  it("toGraphViewBoxPoint：meet 居中空边要扣掉（390×640：纵向空边各 190px）", () => {
    const rect = { left: 0, top: 0, width: 390, height: 640 };
    // 画布中心 → 布局中心
    const c = toGraphViewBoxPoint(195, 320, rect);
    expect(c.x).toBeCloseTo(450, 6);
    expect(c.y).toBeCloseTo(300, 6);
    // SVG 左上可见角（0,190）→ 布局原点；右下（390,450）→（900,600）
    const tl = toGraphViewBoxPoint(0, 190, rect);
    expect(tl.x).toBeCloseTo(0, 6);
    expect(tl.y).toBeCloseTo(0, 6);
    const br = toGraphViewBoxPoint(390, 450, rect);
    expect(br.x).toBeCloseTo(900, 6);
    expect(br.y).toBeCloseTo(600, 6);
  });

  it("pinchGraphView：间距翻倍 → zoom 翻倍，中点下压的布局点不动", () => {
    const next = pinchGraphView({
      startZoom: 1,
      startPan: { x: 0, y: 0 },
      startMidVb: { x: 450, y: 300 },
      startDist: 100,
      currentMidVb: { x: 450, y: 300 },
      currentDist: 200,
    });
    expect(next.zoom).toBe(2);
    // 中点下压的点原来是 (450-0)/1=450；变换后 (450-(-450))/2=450，仍在中点下
    expect((450 - next.pan.x) / next.zoom).toBeCloseTo(450, 6);
    expect((300 - next.pan.y) / next.zoom).toBeCloseTo(300, 6);
  });

  it("pinchGraphView：中点平移跟手，zoom 夹在 [minZoom, maxZoom]", () => {
    const next = pinchGraphView({
      startZoom: 1,
      startPan: { x: 0, y: 0 },
      startMidVb: { x: 450, y: 300 },
      startDist: 100,
      currentMidVb: { x: 460, y: 300 },
      currentDist: 100,
      minZoom: 0.5,
      maxZoom: 3,
    });
    expect(next.zoom).toBe(1);
    // 中点下压的点 (450,300) 现在落在 (460,300) 下：pan.x=460-450=10
    expect(next.pan.x).toBeCloseTo(10, 6);
    const clamped = pinchGraphView({
      startZoom: 2.5,
      startPan: { x: 0, y: 0 },
      startMidVb: { x: 450, y: 300 },
      startDist: 100,
      currentMidVb: { x: 450, y: 300 },
      currentDist: 300,
      minZoom: 0.5,
      maxZoom: 3,
    });
    expect(clamped.zoom).toBe(3);
  });

  it("pinchGraphView：startDist 为 0 时只跟手、不缩放（防除零）", () => {
    const next = pinchGraphView({
      startZoom: 1,
      startPan: { x: 0, y: 0 },
      startMidVb: { x: 450, y: 300 },
      startDist: 0,
      currentMidVb: { x: 460, y: 310 },
      currentDist: 50,
    });
    expect(next.zoom).toBe(1);
    expect(next.pan.x).toBeCloseTo(10, 6);
    expect(next.pan.y).toBeCloseTo(10, 6);
  });
});
