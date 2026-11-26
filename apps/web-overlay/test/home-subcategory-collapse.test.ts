import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 子分类默认折叠（2026-11-25 首屏优化，用户拍板）。
 *
 * 「AI 工具」17 个子分类 96 卡在「全部」视图下整组平铺，单区块 4,645px。
 * 改为：子类数 > 8 的分类默认选中第一个非空子类（既有 tablist 机制，零新 UI），
 * 其余子类收在切换条里。实测 AI 工具区块 4645→1179px，首页 DOM 15696→4409。
 */
const src = readFileSync(resolve(__dirname, "../src/components/navigation-category-section.tsx"), "utf8");

describe("首页：子分类较多的分类默认只展开第一个子类", () => {
  it("阈值常量与 helper 存在，且判定只依赖 props（水合安全）", () => {
    expect(src).toContain("const MANY_SUBCATEGORIES_THRESHOLD = 8");
    expect(src).toContain("function defaultSubCatIdFor(");
    const body = src.slice(src.indexOf("function defaultSubCatIdFor("), src.indexOf("function defaultSubCatIdFor(") + 700);
    // 不读 mount / window / localStorage：服务端与客户端首帧结论必须一致
    expect(body).not.toMatch(/window\.|localStorage|mounted|useEffect/);
  });

  it("selectedSubCatId 初值走 defaultSubCatIdFor，且显式 initialSelectedSubCatId 优先", () => {
    // U-450（2026-11-26）：旧断言按字面钉死 `initialSelectedSubCatId ?? defaultSubCatIdFor(category)`，
    // 与 81f7a3fc 引入时的写法一致；1b363e65（wip 全量快照，「仅存档当前工作树，未逐项验收」）
    // 把默认值抽成 `const defaultSubCatId = defaultSubCatIdFor(category)` 并给同步 effect 加了
    // ref 守卫，却没同步改测试——行为没变（显式 prop 优先，否则首个非空子类），断言先过期了。
    // 下面两处合起来与旧断言等价：初值 = 显式 prop ?? defaultSubCatIdFor(category)。
    expect(src).toContain("const defaultSubCatId = defaultSubCatIdFor(category)");
    expect(src).toContain("initialSelectedSubCatId ?? defaultSubCatId,");
    // 聚焦直达（显式传子类）与编辑态不受默认折叠影响：分类 id 或显式 prop 真变时才重设，
    // 同步表达式仍是显式 prop 优先、否则走默认子类；ref 守卫保证父级重传同 id 对象时
    // 不会把用户已点的子类选择重置掉（旧 effect 无守卫，category 对象引用一变就重设）。
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(prevCatIdRef\.current !== category\.id \|\| prevInitialSubRef\.current !== initialSelectedSubCatId\) \{/);
    expect(src).toContain("setSelectedSubCatId(initialSelectedSubCatId ?? defaultSubCatId)");
    expect(src).toContain("}, [category.id, initialSelectedSubCatId, defaultSubCatId])");
  });
});
