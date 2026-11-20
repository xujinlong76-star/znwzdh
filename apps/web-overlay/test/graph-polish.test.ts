/**
 * `/graph` 视觉打磨轮（2026-11-21）的纯函数守卫：
 *
 * 1. 长名称智能截断：不许再出现「UK AI Safety Institute (」这类
 *    截断后残留半截括号的标签；
 * 2. fitView 数学：内容包围盒（含文字）+ 安全边距 → 居中缩放，
 *    任何节点都不许被画布边界裁切；
 * 3. 连接度分档、边胶囊文案：hover 才浮现的标签内容可核对。
 */
import { describe, expect, it } from "vitest";
import {
  capsuleTextWidth,
  computeGraphFit,
  computeNodeDegrees,
  edgeCapsuleText,
  graphContentBox,
  nodeRadiusForDegree,
  truncateGraphLabel,
} from "../src/lib/graph-polish";

describe("长名称智能截断", () => {
  it("短名原样返回，不加省略号", () => {
    expect(truncateGraphLabel("Hugging Face")).toBe("Hugging Face");
    expect(truncateGraphLabel("Cursor")).toBe("Cursor");
    expect(truncateGraphLabel("")).toBe("");
  });

  it("恰好等于上限时不截断", () => {
    // 15 个字符：U K + 空格 + A I + 空格 + S a f e t y + 空格 + I n = 15
    expect(truncateGraphLabel("UK AI Safety In")).toBe("UK AI Safety In");
  });

  it("超长时截断并拼 …，不留残缺括号", () => {
    expect(truncateGraphLabel("UK AI Safety Institute")).toBe("UK AI Safety In…");
    // 原 bug：slice(0, 24) 切出 "UK AI Safety Institute ("，末尾剩一个 "("
    expect(truncateGraphLabel("UK AI Safety Institute (")).toBe("UK AI Safety In…");
    expect(truncateGraphLabel("UK AI Safety Institute (")).not.toContain("(");
  });

  it("截断点落在残缺标点上时把标点一并去掉", () => {
    expect(truncateGraphLabel("Something-Else Tool Name Here")).toBe("Something-Else…");
    expect(truncateGraphLabel("Alpha/Beta Gamma Delta Tool")).toBe("Alpha/Beta Gamm…");
    // 截到 15 字符正好是 "-"：去掉再拼 …
    expect(truncateGraphLabel("12345678901234-xyz")).toBe("12345678901234…");
  });

  it("中文按字符计，不按字节", () => {
    expect(truncateGraphLabel("这是一个非常长的中文工具名称测试")).toBe(
      "这是一个非常长的中文工具名称测…",
    );
  });

  it("上限可调", () => {
    expect(truncateGraphLabel("UK AI Safety Institute", 16)).toBe("UK AI Safety Ins…");
  });
});

describe("fitView 数学", () => {
  it("内容居中：变换后包围盒中心落在画布中心", () => {
    const box = { minX: 100, minY: 100, maxX: 500, maxY: 400 };
    const t = computeGraphFit(box, 1440, 900);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    expect(cx * t.zoom + t.pan.x).toBeCloseTo(450, 6);
    expect(cy * t.zoom + t.pan.y).toBeCloseTo(300, 6);
  });

  it("四周留出安全边距：变换后包围盒不贴画布边界", () => {
    const box = { minX: 0, minY: 0, maxX: 900, maxY: 600 };
    const t = computeGraphFit(box, 1440, 900, { paddingPx: 56 });
    const left = box.minX * t.zoom + t.pan.x;
    const top = box.minY * t.zoom + t.pan.y;
    const right = box.maxX * t.zoom + t.pan.x;
    const bottom = box.maxY * t.zoom + t.pan.y;
    // 56px 屏幕边距换算到 viewBox 单位：meet 系数 min(1440/900, 900/600)=1.5，56/1.5≈37.3
    expect(left).toBeGreaterThanOrEqual(37);
    expect(top).toBeGreaterThanOrEqual(37);
    expect(right).toBeLessThanOrEqual(900 - 37);
    expect(bottom).toBeLessThanOrEqual(600 - 37);
  });

  it("内容超大时缩小而不是裁切", () => {
    const box = { minX: -500, minY: -500, maxX: 1500, maxY: 1200 };
    const t = computeGraphFit(box, 1440, 900);
    expect(t.zoom).toBeLessThan(1);
    const left = box.minX * t.zoom + t.pan.x;
    const right = box.maxX * t.zoom + t.pan.x;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(900);
  });

  it("节点很少时不把图吹得过大（上限 1.15）", () => {
    const box = { minX: 400, minY: 250, maxX: 500, maxY: 350 };
    const t = computeGraphFit(box, 1440, 900);
    expect(t.zoom).toBeLessThanOrEqual(1.15);
  });

  it("内容包围盒含文字宽度：长标签不被算漏", () => {
    const nodes = [
      { x: 450, y: 300 },
      { x: 100, y: 100 },
    ];
    const box = graphContentBox(nodes, () => 16, (i) => (i === 0 ? "UK AI Safety In…" : "Cursor"));
    expect(box).not.toBeNull();
    // 第一个节点标签半宽约 (15×6.6)/2+3 ≈ 52.5，大于半径 16
    expect(box!.minX).toBeLessThan(450 - 40);
    expect(box!.maxY).toBeGreaterThan(300 + 16);
  });

  it("空节点集返回 null（调用方不拟合）", () => {
    expect(graphContentBox([], () => 16, () => "")).toBeNull();
  });
});

describe("连接度与节点尺寸分档", () => {
  it("无向计数：两端各 +1，只计可见边", () => {
    const edges = [
      { source: "a", target: "b", type: "alternative" as const },
      { source: "a", target: "c", type: "ecosystem" as const },
      { source: "a", target: "gone", type: "ecosystem" as const },
    ];
    const degrees = computeNodeDegrees(edges, new Set(["a", "b", "c"]));
    expect(degrees.get("a")).toBe(2);
    expect(degrees.get("b")).toBe(1);
    expect(degrees.get("gone")).toBeUndefined();
  });

  it("三档半径：孤点 14、2–3 度 17、4 度以上 20；选中 +4", () => {
    expect(nodeRadiusForDegree(0)).toBe(14);
    expect(nodeRadiusForDegree(1)).toBe(14);
    expect(nodeRadiusForDegree(2)).toBe(17);
    expect(nodeRadiusForDegree(3)).toBe(17);
    expect(nodeRadiusForDegree(4)).toBe(20);
    expect(nodeRadiusForDegree(9)).toBe(20);
    expect(nodeRadiusForDegree(2, true)).toBe(21);
    expect(nodeRadiusForDegree(4, true)).toBe(24);
  });
});

describe("边胶囊文案", () => {
  it("共享标签边：去掉「共享:」前缀，拼类型名", () => {
    expect(
      edgeCapsuleText({ source: "a", target: "b", type: "alternative", label: "共享:视频生成" }),
    ).toBe("平替 · 视频生成");
    expect(
      edgeCapsuleText({ source: "a", target: "b", type: "alternative", label: "共享:自动化" }),
    ).toBe("平替 · 自动化");
    expect(
      edgeCapsuleText({ source: "a", target: "b", type: "ecosystem", label: "共享:MCP" }),
    ).toBe("生态 · MCP");
  });

  it("预设边自带文案原样展示", () => {
    expect(
      edgeCapsuleText({ source: "a", target: "b", type: "alternative", label: "开源平替" }),
    ).toBe("开源平替");
    expect(
      edgeCapsuleText({ source: "a", target: "b", type: "ecosystem", label: "原生部署" }),
    ).toBe("原生部署");
  });

  it("无文案时只显示类型名；空标签不拼出「平替 · 」", () => {
    expect(edgeCapsuleText({ source: "a", target: "b", type: "alternative" })).toBe("平替");
    expect(edgeCapsuleText({ source: "a", target: "b", type: "ecosystem" })).toBe("生态");
    expect(
      edgeCapsuleText({ source: "a", target: "b", type: "alternative", label: "共享:" }),
    ).toBe("平替");
  });

  it("胶囊宽度：中文比拉丁宽，且随文字变长", () => {
    const shortEn = capsuleTextWidth("MCP");
    const longEn = capsuleTextWidth("alternative tool");
    const zh = capsuleTextWidth("平替 · 视频生成");
    expect(longEn).toBeGreaterThan(shortEn);
    expect(zh).toBeGreaterThan(shortEn);
    expect(zh).toBeGreaterThan(0);
  });
});
