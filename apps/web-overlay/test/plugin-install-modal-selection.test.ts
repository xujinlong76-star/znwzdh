/**
 * A-2 守卫：安装弹窗选集（换插件重置 / 0 选拦截 / 错选不报成功）。
 *
 * 背景：`plugin-install-modal.tsx` 的 `selectedUrls` state 换插件时不重置，
 * 空集仍为 truthy 照常发 `{ selectedSites: [] }`，服务端空数组按「不过滤」
 * 处理（见 `packages/store/src/repository/plugins.ts`）；确认按钮对 0 选
 * 无拦截，错选（旧包 URL 装新包）0 新增 0 跳过仍走成功 toast。
 *
 * 本仓库无 DOM 渲染测试基建（vitest environment 为 node），按仓库惯用
 * 的源码守卫模式断言（同 `highlight.test.ts` / 各 `*-guard.test.ts`）：
 * 行为本身由 `apps/api/test/plugin-install-selected-sites.test.ts`
 * （服务端诚实计数）与 E2E 旅程覆盖；这里锁死三处前端结构，
 * 防止有人把重置/拦截/诚实 toast 顺手改回去。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 定位 overlay 里的源码文件。
 * 测试文件有两份（overlay 源 + apps/web 里的镜像），相对路径不同，
 * 因此按「路径里必须含 web-overlay」消歧 —— 镜像副本若误指向 apps/web/src，
 * 就会去校验上游底座那份文件，断言失去意义。
 */
function overlaySource(rel: string): string {
  const candidates = [`../${rel}`, `../../web-overlay/${rel}`].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error(`无法定位 overlay 的 ${rel}（候选：${candidates.join(" | ")}）`);
  return hit;
}

const src = readFileSync(
  overlaySource("src/components/plugins/plugin-install-modal.tsx"),
  "utf8",
);

describe("A-2：安装弹窗选集", () => {
  it("换插件时清空旧勾选：selectedUrls 随 plugin slug / open 重置为 null（默认全选）", () => {
    expect(src).toContain("setSelectedUrls(null)");
    // 重置必须挂在以插件 slug 为依赖的 effect 上，而不是只在某个点击回调里
    expect(src).toMatch(/useEffect\(\(\) => \{\s*setSelectedUrls\(null\)\s*\}, \[pluginSlug, open\]\)/);
  });

  it("0 选拦截：确认按钮禁用，且 handleConfirm 未发请求就弹错", () => {
    // 空集判定：null = 未自定义（默认全选），非 null 空集才是用户「全不选」
    expect(src).toContain("selectedUrls.size === 0");
    expect(src).toContain('toast.error("请至少选择一个站点"');
    expect(src).toMatch(/disabled=\{loading \|\| emptySiteSelection/);
  });

  it("错选不报成功：显式勾选 0 新增 0 跳过时走 error toast、不关弹窗", () => {
    expect(src).toContain("explicitSelectionMatchedNothing");
    // 诚实分支必须在成功 toast 之前 return（不关弹窗、不调 onSuccess）
    const branch = src.slice(
      src.indexOf("explicitSelectionMatchedNothing"),
      src.indexOf("toast.success("),
    );
    expect(branch).toContain('toast.error("未安装任何站点"');
    expect(branch).toContain("return");
  });
});
