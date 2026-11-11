/**
 * `/graph` 图谱口径守卫（DEV_BACKLOG A5）：
 *
 * 此前 live 分支把抽样到的真实站点与内置预设集（DEFAULT_NODES/DEFAULT_EDGES）
 * 恒定混排：页面标着 live，图里却永远掺着 27 个写死的技术预设节点，
 * 与预设同 URL 的真实站还会被预设版本顶替——访客分不清哪些是本站真数据。
 *
 * 这里守两件事：
 *   1. 拿到真实数据时，节点与边只来自真实站点（不再 spread 预设、不再连预设边）；
 *   2. 预设集只保留为「拿不到数据」时的示例兜底，且必须保留 sample 角标路径。
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

const SRC = readFileSync(join(overlayRoot(), "src/components/ecosystem-graph.tsx"), "utf8");

describe("/graph live 口径：只出真实站点与真实推导边", () => {
  it("live 分支不再把预设节点 spread 进节点集", () => {
    expect(SRC).not.toContain("[...DEFAULT_NODES, ...dynamicNodes]");
    expect(SRC).toContain("const positioned = dynamicNodes.map(");
  });

  it("live 分支的边只来自真实节点间的推导，不再并入预设边", () => {
    expect(SRC).not.toContain("setEdges([...DEFAULT_EDGES");
    expect(SRC).toContain("setEdges(extraEdges)");
  });

  it("不再生成连向预设节点的「同域生态」边", () => {
    expect(SRC).not.toContain("matchPreset");
  });

  it("真实站点不再因与预设同 URL 被顶替（去重集合不以预设集播种）", () => {
    expect(SRC).not.toMatch(/new Set\(DEFAULT_NODES\.map/);
  });

  it("live 角标只宣称真实站点，不再宣称混排预设", () => {
    expect(SRC).toContain("实时抽样 {liveCount} 站（真实站点，非全量）");
    expect(SRC).not.toContain("预设示例 {DEFAULT_NODES.length} 节点");
  });

  it("预设集仍只作无数据时的示例兜底，且保留 sample 标注路径", () => {
    expect(SRC).toContain("setDataSource('sample')");
    expect(SRC).toContain("示例数据（未接入站点库）");
    // 初始/兜底节点仍来自预设集（保证断网时可视化不空白）
    expect(SRC).toContain("useState<GraphNode[]>(() => {");
    expect(SRC).toContain("DEFAULT_NODES.map((n, i)");
  });
});
