/**
 * `/graph` 的生态图谱以前对键盘用户**完全不可用**：节点是只有 `onClick` 的 SVG `<g>`，
 * 不能聚焦、不能回车、方向键无效 —— 连一个节点都选不中，右侧详情抽屉里
 * 「关联拓扑」的跳转同样是 `<div onClick>`。
 *
 * 这里守两件事：
 *   1. 几何导航是纯函数：方向键找「该方向上最接近的节点」，规则可穷举、结果稳定；
 *   2. 组件接线：每个可点节点都真的可聚焦、可回车、有可访问名，且全仓不再出现
 *      「可点击但不可聚焦」的 `<g>`。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  directionFromKey,
  isActivationKey,
  nextNodeInDirection,
  nodeAccessibleName,
  rovingNodeId,
} from "../src/lib/graph-nav";

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
const GRAPH = "src/components/ecosystem-graph.tsx";

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

/** 坐标系是 SVG 的：y 向下增长，所以 up 意味着「更小的 y」 */
const BOARD = [
  { id: "center", x: 0, y: 0 },
  { id: "right", x: 100, y: 0 },
  { id: "right-far", x: 300, y: 0 },
  { id: "left", x: -100, y: 0 },
  { id: "up", x: 0, y: -100 },
  { id: "down", x: 0, y: 100 },
  { id: "diag", x: 100, y: 100 },
];

describe("方向键几何导航（纯函数）", () => {
  it("四个方向各自选中该方向上最近的节点", () => {
    expect(nextNodeInDirection(BOARD, "center", "right")?.id).toBe("right");
    expect(nextNodeInDirection(BOARD, "center", "left")?.id).toBe("left");
    expect(nextNodeInDirection(BOARD, "center", "up")?.id).toBe("up");
    expect(nextNodeInDirection(BOARD, "center", "down")?.id).toBe("down");
  });

  it("up 是「更小的 y」（SVG 坐标），不要搞反", () => {
    const picked = nextNodeInDirection(BOARD, "center", "up");
    expect(picked?.id).toBe("up");
    expect(picked!.y).toBeLessThan(0);
    expect(nextNodeInDirection(BOARD, "center", "down")!.y).toBeGreaterThan(0);
  });

  it("不会选到身后的节点（主方向必须为正）", () => {
    const points = [
      { id: "here", x: 0, y: 0 },
      { id: "behind", x: -500, y: 0 },
      { id: "ahead", x: 10, y: 0 },
    ];
    expect(nextNodeInDirection(points, "here", "right")?.id).toBe("ahead");
  });

  it("几乎同 y 的节点不算「右/左」（0.2 的偏移在容差内）", () => {
    const points = [
      { id: "here", x: 0, y: 0 },
      { id: "almost-same", x: 0.2, y: 0 },
    ];
    expect(nextNodeInDirection(points, "here", "right")).toBeNull();
  });

  it("直走优先于斜穿（侧向偏移有权重）", () => {
    const points = [
      { id: "here", x: 0, y: 0 },
      { id: "slightly-right", x: 100, y: 20 },
      { id: "down-right", x: 90, y: 200 },
    ];
    expect(nextNodeInDirection(points, "here", "right")?.id).toBe("slightly-right");
  });

  it("该方向没有节点时返回 null（而不是绕到别的方向）", () => {
    expect(nextNodeInDirection(BOARD, "right-far", "right")).toBeNull();
    expect(nextNodeInDirection(BOARD, "up", "up")).toBeNull();
    expect(nextNodeInDirection(BOARD, "down", "down")).toBeNull();
  });

  it("边界：未知当前节点、空列表、只有一个节点", () => {
    expect(nextNodeInDirection(BOARD, "nope", "right")).toBeNull();
    expect(nextNodeInDirection([], "center", "right")).toBeNull();
    expect(nextNodeInDirection([{ id: "only", x: 0, y: 0 }], "only", "right")).toBeNull();
  });

  it("同样输入永远同样输出（漫游导航不能随机跳）", () => {
    const first = nextNodeInDirection(BOARD, "center", "right")?.id;
    for (let i = 0; i < 5; i++) {
      expect(nextNodeInDirection(BOARD, "center", "right")?.id).toBe(first);
    }
  });
});

describe("按键 → 语义", () => {
  it("四个方向键才映射方向，其它键不劫持", () => {
    expect(directionFromKey("ArrowLeft")).toBe("left");
    expect(directionFromKey("ArrowRight")).toBe("right");
    expect(directionFromKey("ArrowUp")).toBe("up");
    expect(directionFromKey("ArrowDown")).toBe("down");
    for (const key of ["Enter", " ", "Tab", "a", "Escape", ""]) {
      expect(directionFromKey(key), `${key} 不该被当成方向键`).toBeNull();
    }
  });

  it("Enter 与空格都算「激活」（空格在浏览器里还会滚页，调用方要 preventDefault）", () => {
    expect(isActivationKey("Enter")).toBe(true);
    expect(isActivationKey(" ")).toBe(true);
    expect(isActivationKey("Spacebar")).toBe(true);
    expect(isActivationKey("ArrowDown")).toBe(false);
    expect(isActivationKey("")).toBe(false);
  });
});

describe("漫游 tabindex 的落点", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("保留当前焦点，避免方向键移动后 Tab 又跳回开头", () => {
    expect(rovingNodeId(nodes, "b")).toBe("b");
  });

  it("当前焦点被筛选掉（换分类/搜索）时回落第一个可见节点", () => {
    expect(rovingNodeId(nodes, "gone")).toBe("a");
    expect(rovingNodeId(nodes, null)).toBe("a");
    expect(rovingNodeId(nodes, undefined)).toBe("a");
  });

  it("没有可见节点时返回 null —— 此时不该有任何节点能 Tab 进去", () => {
    expect(rovingNodeId([], "a")).toBeNull();
  });
});

describe("节点的可访问名", () => {
  it("不能只有名字：带上分类才有信息量", () => {
    const name = nodeAccessibleName("Next.js", "开发基建");
    expect(name).toContain("Next.js");
    expect(name).toContain("开发基建");
  });
});

describe("图谱组件接线", () => {
  function nodeLayer(): string {
    const src = overlaySource(GRAPH);
    const start = src.indexOf("{filteredNodes.map((n) => {");
    expect(start, "找不到节点渲染层").toBeGreaterThan(-1);
    const end = src.indexOf("})}", start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it("每个节点都是可聚焦的按钮语义（role + tabIndex + aria-label + 键盘处理）", () => {
    const layer = nodeLayer();
    expect(layer).toContain('role="button"');
    expect(layer).toContain("tabIndex={rovingId === n.id ? 0 : -1}");
    expect(layer).toContain("onKeyDown={(event) => handleNodeKeyDown(event, n)}");
    expect(layer).toContain("onFocus={() => setFocusedNodeId(n.id)}");
    expect(layer).toContain("aria-label={nodeAccessibleName(");
    expect(layer).toContain("ref={(el) => {");
  });

  it("只有一个节点在 Tab 序列里（漫游 tabindex，而不是几十个 Tab 停靠点）", () => {
    const layer = nodeLayer();
    const tabStops = (layer.match(/tabIndex=\{rovingId === n\.id \? 0 : -1\}/g) || []).length;
    expect(tabStops).toBe(1);
    expect((layer.match(/role="button"/g) || []).length).toBe(1);
  });

  it("键盘焦点环只在真正聚焦时出现（鼠标用户不会看到多余装饰）", () => {
    const layer = nodeLayer();
    expect(layer).toContain("group-focus:opacity-100");
    expect(layer).toContain("group cursor-pointer");
  });

  it("详情抽屉的关闭按钮有名字（原来只有一个 ✕ 字符）", () => {
    const src = overlaySource(GRAPH);
    expect(src).toContain('aria-label="关闭节点详情"');
    expect(src).toContain('title="关闭节点详情"');
  });

  it("「关联拓扑」的跳转是真正的按钮，不是可点的 div", () => {
    const src = overlaySource(GRAPH);
    const start = src.indexOf("{relatedEdges.map((e, idx) => {");
    expect(start).toBeGreaterThan(-1);
    const section = src.slice(start, src.indexOf("</div>", start));
    expect(section).toContain("<button");
    expect(section).toContain('type="button"');
    expect(section).toContain("onClick={() => setSelectedNode(otherNode)}");
    expect(/<div[^>]*onClick/.test(section)).toBe(false);
    // 按钮里不许塞块级元素（无效嵌套）
    expect(/<button[^>]*>\s*<div/.test(section)).toBe(false);
  });
});

/** 去掉注释再扫描：文档里可以引用旧写法做反例，不该被当成真实代码 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** 取出某个 JSX 标签的所有开标签整体文本（跳过 `{}` 与引号内部，箭头函数的 `>` 不会截断） */
function findOpeningTags(src: string, name: string): string[] {
  const tags: string[] = [];
  const needle = `<${name}`;
  let i = src.indexOf(needle);
  while (i !== -1) {
    const after = src[i + needle.length];
    if (after === undefined || /[\s>/]/.test(after)) {
      let depth = 0;
      let quote: string | null = null;
      let j = i;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
          continue;
        }
        if (ch === "{") {
          depth++;
          continue;
        }
        if (ch === "}") {
          depth--;
          continue;
        }
        if (ch === ">" && depth === 0) {
          j++;
          break;
        }
      }
      tags.push(src.slice(i, j));
      i = src.indexOf(needle, j);
    } else {
      i = src.indexOf(needle, i + needle.length);
    }
  }
  return tags;
}

describe("全仓：可点击的 <g> 必须可聚焦", () => {
  function clickableGroups(): Array<{ file: string; tag: string }> {
    const found: Array<{ file: string; tag: string }> = [];
    for (const rel of listSources(join(ROOT, "src"))) {
      const tags = findOpeningTags(stripComments(overlaySource(rel)), "g");
      for (const tag of tags) {
        if (tag.includes("onClick")) found.push({ file: rel, tag });
      }
    }
    return found;
  }

  it("先确认扫描确实看到了可点击的 <g>（否则空数组会假装通过）", () => {
    expect(clickableGroups().length).toBeGreaterThan(0);
  });

  it("凡带 onClick 的 <g> 都必须有 role/tabIndex/onKeyDown", () => {
    const missing = clickableGroups()
      .filter(
        ({ tag }) =>
          !tag.includes('role="button"') || !tag.includes("tabIndex=") || !tag.includes("onKeyDown="),
      )
      .map(({ file, tag }) => `${file} :: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
    expect(missing).toEqual([]);
  });
});
