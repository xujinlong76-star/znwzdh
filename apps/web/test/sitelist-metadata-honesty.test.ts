/**
 * 站点列表「自动获取网站信息」的三条诚实性约束。
 *
 * 真实缺陷（由 `e2e/admin-sitelist-write.spec.ts` 测出）：
 *
 *   用户填 URL → 1 秒后自动抓取 → `forceUpdate=true` 无条件
 *   `updates.name = metadata.title`。而抓不到标题的站点很常见（JS 渲染页、
 *   反爬、超时降级都返回空串），于是用户正在输入的名称被清空、或已填好的
 *   名称在提交时变成空值 —— 界面报「请填写必填字段」，看起来像表单校验
 *   不讲道理，实际是自动抓取把内容抹掉了。
 *
 * 三条约束：
 *   1. 自动抓取只填空（forceUpdate=false），不覆盖用户输入；
 *   2. 即使 forceUpdate=true（用户点了刷新），空值也不能覆盖已有内容；
 *   3. 什么都没抓到时不能说「已是最新」——那会让人以为抓取成功了。
 *
 * 做成源码守卫而不是只留 E2E：E2E 要起整套 dev 栈（本机 3 分钟以上），
 * 这三条是纯字符串级的事实，守卫秒级可查，能在每次提交时都跑到。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const PAGE = overlaySource("src/app/admin/sitelist/page.tsx");
const DIALOGS = overlaySource("src/app/admin/sitelist/sitelist-dialogs.tsx");
const SITELIST_ALL = PAGE + "\n" + DIALOGS;

describe("站点列表：自动获取元信息的诚实性", () => {
  it("自动抓取（URL change 触发的两处）必须传 forceUpdate=false", () => {
    // 断言的是「调用点传了 false」，不绑定中间注释的行数/措辞
    expect(PAGE).toMatch(/lastFetchedAddUrl\.current = newSite\.url[\s\S]{0,400}?fetchWebsiteMetadata\(newSite\.url, false, false\)/);
    expect(PAGE).toMatch(/lastFetchedEditUrl\.current = editSite\.url[\s\S]{0,400}?fetchWebsiteMetadata\(editSite\.url, true, false\)/);
  });

  it("手动点刷新/重新获取时才允许覆盖（forceUpdate=true 仍然存在）", () => {
    // 两个按钮各一处：添加与编辑（弹窗组件已抽到 sitelist-dialogs.tsx）。若哪天被一并改成 false，用户就没有显式覆盖入口了
    const manualCalls = SITELIST_ALL.match(/onClick=\{\(\) => fetchWebsiteMetadata\([^)]*true\)\}/g) ?? [];
    expect(manualCalls.length).toBe(2);
  });

  it("名称覆盖带非空判断，空标题不会抹掉用户输入", () => {
    expect(PAGE).toContain("const fetchedTitle =");
    expect(PAGE).toContain("if ((forceUpdate || !site.name) && fetchedTitle)");
    // 旧写法必须消失。用行首锚定排除注释（注释行以 * 或 // 开头）
    expect(PAGE).not.toMatch(/^\s*updates\.name = metadata\.title/m);
  });

  it("描述同样只在非空时覆盖", () => {
    expect(PAGE).toContain("if (fetchedDescription) updates.description = fetchedDescription");
    expect(PAGE).not.toMatch(/^\s*updates\.description = metadata\.description/m);
  });

  it("什么都没抓到时不说「已是最新」", () => {
    expect(PAGE).toContain("fetchedAnything");
    expect(PAGE).toContain("未获取到网站信息，请手动填写");
  });
});
