/**
 * 设计系统契约（P1-4）源码守卫。
 *
 * 锁三件事，防止样板组件「写了但没人用 / 慢慢腐化」：
 *   1. `<EmptyState>` 存在且保留「图标 + 解释 + 行动」三件套；
 *   2. 已迁移页面（/favorites）真的用它，且硬编码色值被消灭；
 *   3. 动效 token 已落在 globals.css（duration / ease），
 *      且 reduced-motion.css 仍在它们之后加载（顺序即覆盖能力）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..", "..", "web-overlay");

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("overlay 缺少文件 " + rel);
  return readFileSync(p, "utf8");
}

describe("EmptyState 样板组件", () => {
  const src = () => overlayFile("src/components/ui/empty-state.tsx");

  it("导出组件且三件套齐全（图标 / 标题 / 主行动）", () => {
    const s = src();
    expect(s).toContain("export function EmptyState");
    expect(s).toContain("icon:");
    expect(s).toContain("title:");
    expect(s).toContain("action?:");
    expect(s).toContain("description?:");
  });

  it("样式全部走 token，不出现裸 palette 色值", () => {
    const s = src();
    expect(s).toContain("text-primary");
    expect(s).toContain("bg-muted/60");
    expect(s).toContain("border-border");
    // 成对出现的暗色适配（emerald/amber）除外，其余裸色值不允许
    const bare = s.match(/text-(red|blue|green|indigo|violet|rose|slate|gray|zinc)-[0-9]/g);
    expect(bare).toBeNull();
  });
});

describe("已迁移页面：/favorites", () => {
  const src = () => overlayFile("src/app/favorites/page.tsx");

  it("两个空态都改用 EmptyState", () => {
    const s = src();
    expect(s).toContain("import { EmptyState } from '@/components/ui/empty-state'");
    expect(s.split("<EmptyState").length - 1).toBe(2);
  });

  it("旧的手写空态结构已移除，且没有未配对暗色的满色度 emerald", () => {
    const s = src();
    // 旧空态的特征：图标框 + 硬编码 text-emerald-500 + 手写 h3 标题
    expect(s).not.toContain('w-6 h-6 text-emerald-500"');
    expect(s).not.toContain("还没有收藏任何站点</h3>");
    // 满色度 text-emerald-500（不含 /NN 透明度写法）必须成对适配暗色
    expect(s).not.toContain(" text-emerald-500 ");
  });
});

describe("已迁移页面：admin 主要列表页", () => {
  // 迁移清单（2026-10-18 第五轮）：页面级空态统一走 <EmptyState>；
  // 面板内嵌的小样本列表（facets 的分面站点样例）按契约允许保持内联。
  const MIGRATED: Array<[string, string]> = [
    ["src/app/admin/audit/page.tsx", "暂无审计记录"],
    ["src/app/admin/categories/page.tsx", "emptyStateText(loadError, '暂无类目')"],
    ["src/app/admin/collections/page.tsx", "emptyStateText(loadError, '暂无专题')"],
    ["src/app/admin/jobs/page.tsx", "暂无匹配任务记录"],
    ["src/app/admin/navigation/page.tsx", "暂无分类"],
    ["src/app/admin/resources/page.tsx", "暂无资源"],
    ["src/app/admin/sitelist/page.tsx", "暂无站点"],
    ["src/app/admin/stats/page.tsx", "暂无巡检记录"],
  ];

  for (const [rel, marker] of MIGRATED) {
    it(`${rel.split("/").slice(-2).join("/")} 使用 EmptyState`, () => {
      const src = overlayFile(rel);
      expect(src, rel + " 未导入 EmptyState").toContain("from '@/components/ui/empty-state'");
      expect(src, rel + " 未出现 <EmptyState").toContain("<EmptyState");
      expect(src, rel + " 空态文案应保留失败/为空区分").toContain(marker);
    });
  }

  it("admin 不再有裸 gray 色值（暗色红线）", () => {
    const files = [
      "src/app/admin/audit/page.tsx",
      "src/app/admin/categories/page.tsx",
      "src/app/admin/collections/page.tsx",
      "src/app/admin/jobs/page.tsx",
      "src/app/admin/navigation/page.tsx",
      "src/app/admin/resources/page.tsx",
      "src/app/admin/sitelist/page.tsx",
      "src/app/admin/stats/page.tsx",
      "src/app/admin/taxonomy/page.tsx",
    ];
    for (const rel of files) {
      const src = overlayFile(rel);
      const bare = src.match(/(text|bg|border)-gray-[0-9]/g);
      expect(bare, rel + " 仍有硬编码灰阶").toBeNull();
    }
  });

  it("导航页乱码已修复（开???创建 → 开始创建）", () => {
    const src = overlayFile("src/app/admin/navigation/page.tsx");
    expect(src).toContain("按钮开始创建");
    expect(src).not.toContain("\ufffd");
  });
});

describe("动效 token", () => {
  it("globals.css 定义四档时长与两档缓动", () => {
    const s = overlayFile("src/styles/globals.css");
    expect(s).toContain("--duration-instant:");
    expect(s).toContain("--duration-fast:");
    expect(s).toContain("--duration-base:");
    expect(s).toContain("--duration-slow:");
    expect(s).toContain("--ease-out:");
    expect(s).toContain("--ease-spring:");
  });

  it("reduced-motion.css 仍统一覆盖动效（用户偏好优先于 token）", () => {
    const s = overlayFile("src/styles/reduced-motion.css");
    expect(s).toContain("prefers-reduced-motion: reduce");
    expect(s).toContain("transition-duration: 0.01ms !important");
    expect(s).toContain("animation-duration: 0.01ms !important");
  });

  it("layout 中 reduced-motion.css 排在 globals.css 之后加载", () => {
    const s = overlayFile("src/app/layout.tsx");
    const globals = s.indexOf("styles/globals.css");
    const reduced = s.indexOf("styles/reduced-motion.css");
    expect(globals).toBeGreaterThan(-1);
    expect(reduced).toBeGreaterThan(globals);
  });
});
