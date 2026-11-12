/**
 * 皮肤选择器（Item 3b）：
 *
 *  1. 主题 icon 可能是图片 URL 不只是 emoji：URL 渲染 <img>，其余当文字。
 *     isThemeIconUrl 是纯函数，直接单测；渲染分支用源码守卫钉住。
 *  2. 点选后菜单立刻关闭、看不到任何反馈：改为点选不关菜单（onSelect +
 *     preventDefault），菜单里留着「正在应用…」，成功后才关菜单。
 *  3. 安装 / 取详情失败：错误文案已在位，且 finally 一定清掉 applying，
 *     不把全部菜单项永久 disabled（失败时菜单留着，错误可见）。
 *
 * 注意：本仓库 vitest 是 node 环境、无 jsdom / Testing Library，
 * 组件本身无法渲染挂载；交互分支（菜单开关、失败留菜单）用与
 * theme-dark-suspend.test.ts 同款的源码守卫覆盖。isThemeIconUrl 已
 * 抽到纯函数模块 src/lib/theme-icon.ts，直接 import 测真函数。
 *
 * 2026-11-12 复核（P1-9）：已确证仓库仍无 jsdom / happy-dom /
 * @testing-library/react（根 vitest.config.ts:56 environment:"node"；
 * 根与 overlay 的 package.json 均无上述 devDependency；node_modules
 * 里无 jsdom/happy-dom/@testing-library；pnpm-lock 里两者只以
 * vitest 的 optional peer 出现，未安装）。因此本轮仍写不出真实挂载
 * 的交互测试（菜单打开、点选见「正在应用…」、失败留菜单带错误），
 * 只能补 node 可诚实覆盖的部分 + 更严的源码守卫；挂载测试缺什么、
 * 要加什么 setup，见本文件末尾的「未覆盖」说明与报告。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// isThemeIconUrl 已抽到纯函数模块 src/lib/theme-icon.ts：直接 import 测真函数，
// 不再用 new Function 从 .tsx 源码抠函数体（见文件头）。
import { isThemeIconUrl } from "../src/lib/theme-icon";

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
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** 取 source 中从 marker 起的第一个完整花括号块（含嵌套），避免切到内层右括号 */
function braceBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`未找到标记：${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`花括号未闭合：${marker}`);
}

describe("皮肤 icon：URL 渲染图片，emoji 渲染文字", () => {
  it("isThemeIconUrl 识别 http/https、/-开头路径、data:image", () => {
    expect(isThemeIconUrl("https://cdn.example.com/icon.png")).toBe(true);
    expect(isThemeIconUrl("http://cdn.example.com/icon.png")).toBe(true);
    expect(isThemeIconUrl("/icons/skin-1.png")).toBe(true);
    expect(isThemeIconUrl("//cdn.example.com/icon.png")).toBe(true);
    expect(isThemeIconUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isThemeIconUrl("  https://cdn.example.com/icon.png  ")).toBe(true);
  });

  it("isThemeIconUrl 不把 emoji / 空值当 URL", () => {
    expect(isThemeIconUrl("🎨")).toBe(false);
    expect(isThemeIconUrl("🌙")).toBe(false);
    expect(isThemeIconUrl("")).toBe(false);
    expect(isThemeIconUrl(null)).toBe(false);
    expect(isThemeIconUrl(undefined)).toBe(false);
    // 非 URL 的相对路径、非图片 data URI 也不当图片
    expect(isThemeIconUrl("icons/skin-1.png")).toBe(false);
    expect(isThemeIconUrl("data:text/plain,hello")).toBe(false);
  });

  it("渲染分支：URL 走 <img>，其余走文字、缺失回退 🎨", () => {
    const picker = read("src/components/skin-picker.tsx");
    // 判定函数已抽到 lib/theme-icon.ts：组件只 import + re-export，不再本地定义
    expect(picker).toContain("export { isThemeIconUrl } from '@/lib/theme-icon'");
    expect(read("src/lib/theme-icon.ts")).toContain("export function isThemeIconUrl(");
    expect(picker).toContain("isThemeIconUrl(theme.icon)");
    expect(picker).toContain("<img");
    expect(picker).toContain("src={theme.icon}");
    // 图标 URL 已死（onError）时回退 🎨，不画破图框；URL 本身绝不当文字画
    expect(picker).toContain("isThemeIconUrl(theme.icon) ? '🎨' : (theme.icon ?? '🎨')");
    // 旧写法：不管什么 icon 都当文本画
    expect(picker).not.toContain("{theme.icon ?? '🎨'}\n              </span>\n              <span className=\"min-w-0 flex-1\">");
  });
});

describe("皮肤应用中状态：点选后菜单不关，正在应用…可见", () => {
  it("菜单受控 open：点选不关菜单，成功后才关", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("const [open, setOpen] = React.useState(false)");
    expect(picker).toContain("open={open}");
    // Radix 默认点选即关菜单；onSelect 里 preventDefault 才能把
    // 「正在应用…」留在菜单里给用户看见
    expect(picker).toContain("onSelect={(event) => {");
    expect(picker).toContain("event.preventDefault()");
    expect(picker).not.toContain("onClick={() => void choose(theme.slug)}");
    expect(picker).not.toContain("onClick={() => void choose('')}");
  });

  it("应用中菜单项显示「正在应用…」，其余项 disabled", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("applying === theme.slug");
    expect(picker).toContain("'正在应用…'");
    expect(picker).toContain("disabled={applying !== null}");
  });

  it("成功应用后关菜单（choose 成功分支调 setOpen(false)）", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody).toContain("setActiveTheme({");
    expect(chooseBody).toContain("setOpen(false)");
  });
});

describe("皮肤应用失败：报错可见，不留卡死的 applying", () => {
  it("installPlugin / fetchPluginDetail 抛错时 setError 且 finally 清 applying", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody).toContain("await installPlugin(slug)");
    expect(chooseBody).toContain("await fetchPluginDetail(slug)");
    // 失败文案先拼进 message 再 setError（拼完还要在菜单关掉时 toast 补发，
    // 见 notifyFailureIfMenuClosed）；模板本身不变
    expect(chooseBody).toContain("const message = `皮肤应用失败：${err instanceof Error ? err.message : String(err)}`");
    expect(chooseBody).toContain("setError(message)");
    expect(chooseBody).toContain("finally");
    // finally 里必须清 applying：不清会把全部菜单项永久 disabled，
    // 错误文案在、按钮全死，用户只能关菜单重进
    const finallyBody = chooseBody.slice(chooseBody.indexOf("finally"));
    expect(finallyBody).toContain("setApplying(null)");
  });

  it("清单取不到 payload 也报错、同样走 finally 清 applying", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody).toContain("setError('无法启用皮肤：未能加载清单配置')");
    expect(chooseBody).toContain("finally");
  });

  it("错误文案画在菜单里（失败时菜单不关才看得见）", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("{error && (");
    expect(picker).toContain("text-destructive");
    // 失败分支不关菜单：setOpen(false) 只出现在成功分支与「系统默认」
    // 立即生效分支，不出现在 catch 里。choose 里现在有两个 catch（默认
    // 分支的 resetTheme try/catch 在前、走网络的 try/catch 在后），
    // 取最后一个才是网络失败分支。
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    const catchBody = chooseBody.slice(chooseBody.lastIndexOf("} catch (err) {"));
    expect(catchBody).not.toContain("setOpen(false)");
  });
});

describe("isThemeIconUrl 边界：带查询串、svg data URI、危险协议", () => {
  it("带查询串/锚点的 https URL、svg data URI 仍识别为图片", () => {
    expect(isThemeIconUrl("https://cdn.example.com/icon.png?v=2")).toBe(true);
    expect(isThemeIconUrl("https://cdn.example.com/icon.png#frag")).toBe(true);
    expect(isThemeIconUrl("data:image/svg+xml,<svg/>")).toBe(true);
    expect(isThemeIconUrl("data:image/gif;base64,R0lGODlh")).toBe(true);
    expect(isThemeIconUrl("\nhttps://cdn.example.com/icon.png\n")).toBe(true);
    expect(isThemeIconUrl(" /icons/skin-1.png")).toBe(true);
  });

  it("非图片协议不当图片：javascript:/ftp:/无斜杠的 https: 都返回 false", () => {
    // javascript: 若被当成图片 URL 塞进 <img src>，虽不执行脚本，
    // 也属不该出现的渲染面：必须走文字分支
    expect(isThemeIconUrl("javascript:alert(1)")).toBe(false);
    expect(isThemeIconUrl("ftp://cdn.example.com/icon.png")).toBe(false);
    expect(isThemeIconUrl("https:cdn.example.com/icon.png")).toBe(false);
    expect(isThemeIconUrl("   ")).toBe(false);
    expect(isThemeIconUrl("🎨https://cdn.example.com/icon.png")).toBe(false);
  });

  it("协议头大小写不敏感：HTTPS://、Data:image/ 也识别为图片", () => {
    // 之前实现是大小写敏感的 startsWith，大写协议头会误判为 emoji；
    // 判定已改为小写后再比对（lib/theme-icon.ts）
    expect(isThemeIconUrl("HTTPS://cdn.example.com/icon.png")).toBe(true);
    expect(isThemeIconUrl("Data:image/png;base64,xxx")).toBe(true);
    expect(isThemeIconUrl("HTTP://cdn.example.com/icon.png")).toBe(true);
  });
});

describe("皮肤 choose() 的分支顺序与开关守卫（源码守卫，见文件头）", () => {
  it("先亮「正在应用…」再走网络：setApplying 在 installPlugin 之前", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    const applyingAt = chooseBody.indexOf("setApplying(slug)");
    const installAt = chooseBody.indexOf("await installPlugin(slug)");
    expect(applyingAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(-1);
    expect(applyingAt).toBeLessThan(installAt);
  });

  it("未安装先安装、再取详情：installPlugin 在 fetchPluginDetail 之前", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody.indexOf("await installPlugin(slug)")).toBeLessThan(
      chooseBody.indexOf("await fetchPluginDetail(slug)"),
    );
  });

  it("没拿到清单不激活：payload 为空先报错返回，setActiveTheme 在 payload 检查之后", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody.indexOf("if (!payload)")).toBeLessThan(chooseBody.indexOf("setActiveTheme({"));
  });

  it("「系统默认」分支立即生效：resetTheme + 同步状态 + 马上关菜单", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    const defaultBranch = chooseBody.slice(chooseBody.indexOf("if (!slug) {"), chooseBody.indexOf("setApplying(slug)"));
    expect(defaultBranch).toContain("resetTheme()");
    expect(defaultBranch).toContain("syncActive()");
    expect(defaultBranch).toContain("setOpen(false)");
  });

  it("「系统默认」分支 resetTheme 包在 try/catch：抛错不关菜单、不留空白", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    const defaultBranch = chooseBody.slice(chooseBody.indexOf("if (!slug) {"), chooseBody.indexOf("setApplying(slug)"));
    expect(defaultBranch).toContain("try {");
    expect(defaultBranch).toContain("} catch (err) {");
    expect(defaultBranch).toContain("恢复系统默认失败");
    // 失败分支 return，不走到 setOpen(false)
    expect(defaultBranch.indexOf("return")).toBeLessThan(defaultBranch.indexOf("setOpen(false)"));
  });

  it("setOpen(false) 全文件只出现两次：默认分支 + 成功分支，失败/加载中绝不关菜单", () => {
    const picker = read("src/components/skin-picker.tsx");
    const hits = picker.split("setOpen(false)").length - 1;
    expect(hits).toBe(2);
  });
});

describe("皮肤菜单的加载态、暂停态与触发器文案（源码守卫，见文件头）", () => {
  it("打开菜单才加载列表：onOpenChange 为 true 时调 load", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("onOpenChange={(next: boolean) => {");
    expect(picker).toContain("if (next) void load()");
  });

  it("加载中与取不到列表都有菜单内文案，不画空菜单", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("正在加载皮肤列表…");
    expect(picker).toContain("皮肤列表暂时取不到（中枢未连接），稍后再试。");
    expect(picker).toContain("去插件市场查看全部皮肤 →");
  });

  it("深色模式暂停时明说：标题与菜单项都带「深色模式下暂停」", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("（深色模式下暂停，回到浅色自动恢复）");
    expect(picker).toContain("（深色模式下暂停）");
  });

  it("触发器按钮带当前皮肤的无障碍文案，错误项是 disabled（点它不关菜单）", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("aria-label={`皮肤切换：当前为${active?.name ?? '系统默认'}`}");
    expect(picker).toContain('<DropdownMenuItem disabled className="text-xs text-destructive-text">');
  });
});

/**
 * 未覆盖（node 环境诚实边界，P1-9 复核结论）：
 *
 * 以下行为没有也不可能有 vitest 覆盖——它们要真实挂载 SkinPicker /
 * ElderModeToggle（Radix DropdownMenu 的 open/close、点击菜单项、
 * 「正在应用…」出现又消失、失败后菜单仍开着且错误可见、长辈模式
 * 开关点按后 <html> 属性与字号即时变化）。本仓库 vitest 是 node
 * 环境（根 vitest.config.ts:56 environment:"node"），且没有
 * jsdom / happy-dom / @testing-library/react（根与 overlay 的
 * package.json 均无；node_modules 里无；pnpm-lock 里只以 vitest
 * 的 optional peer 出现，未安装）；overlay 下连 node_modules 都
 * 没有，直接 import .tsx 会报 Cannot find package
 * 'react/jsx-dev-runtime'。源码守卫能钉住「写了什么」，钉不住
 * 「跑起来对不对」——例如 Radix 的 onSelect preventDefault 是否
 * 真拦住了关闭、setOpen(false) 是否真在成功后才执行。
 *
 * 要补齐，独立决策（二选一，不在本任务内安装）：
 *  1. vitest 侧：加 jsdom（或 happy-dom）+ @testing-library/react，
 *     给 apps/web/test 下的组件测试单独配 environment:"jsdom"
 *     的 vitest project（根配置目前全局 environment:"node"，
 *     且 include 排除 apps/web-overlay/test/**，镜像同步仍要走
 *     vendor-web 链）；或
 *  2. Playwright 侧（仓内已有先例，见 e2e/admin-sitelist.spec.ts
 *     的注释）：写 e2e spec 覆盖菜单开关与应用成功/失败旅程。
 * 另：isThemeIconUrl 已抽到 src/lib/theme-icon.ts（2026-11-12 合并时），
 * 本文件改为直接 import 测真函数，不再用 new Function 取函数体。
 */

describe("皮肤加载降级不缓存成功态（P0）：失败可重试，已装不误标", () => {
  it("load() 只在两路都真正成功时置 loaded：降级不缓存，下次打开重拉", () => {
    const picker = read("src/components/skin-picker.tsx");
    const loadBody = braceBlock(picker, "const load = React.useCallback(async () => {");
    // 降级回调只记本地旗标：setLoadFailed 是异步 state，await 后读不到
    expect(loadBody).toContain("let listDegraded = false");
    expect(loadBody).toContain("let installedDegraded = false");
    expect(loadBody).toContain("if (!listDegraded && !installedDegraded) {");
    expect(loadBody).toContain("setLoaded(true)");
    // setLoaded(true) 全函数只出现一次，且在降级守卫里（旧写法无条件置 true）
    expect(loadBody.split("setLoaded(true)").length - 1).toBe(1);
  });

  it("已装列表降级时不拿空集覆盖 installed：立 unknown 旗标，渲染说「安装状态未知」", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("const [installedUnknown, setInstalledUnknown] = React.useState(false)");
    const loadBody = braceBlock(picker, "const load = React.useCallback(async () => {");
    expect(loadBody).toContain("if (installedDegraded) {");
    expect(loadBody).toContain("setInstalledUnknown(true)");
    expect(picker).toContain("'安装状态未知'");
    expect(picker).toContain("? '安装状态未知'");
  });

  it("降级后菜单里有重试入口：点「重试」重新拉取", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("重试加载皮肤列表");
    expect(picker).toContain("loadFailed && !loading");
    // 重试入口走同一条 load：loaded 仍是 false 才进得去（见上一例）
    expect(picker).toContain("void load()");
  });

  it("加载成功但返回 0 套皮肤时说「暂无皮肤」，不再说「从插件市场读取」", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("loaded ? '暂无皮肤' : '从插件市场读取'");
  });
});

describe("皮肤应用反馈：成功/失败都有 toast，触发器应用中禁用，失败不丢", () => {
  it("成功应用 toast：已启用哪套皮肤", () => {
    const picker = read("src/components/skin-picker.tsx");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody).toContain("toast({ title: '皮肤已应用'");
    expect(chooseBody).toContain("已启用「${name}」");
  });

  it("失败时若菜单已关，toast 补发：错误不只画在菜单里", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("openRef");
    expect(picker).toContain("if (!openRef.current) {");
    expect(picker).toContain("toast({ title: '皮肤应用失败'");
    const chooseBody = braceBlock(picker, "const choose = async (slug: string)");
    expect(chooseBody).toContain("notifyFailureIfMenuClosed(message)");
  });

  it("触发器按钮应用中禁用：点它不会在应用途中重开/重复触发", () => {
    const picker = read("src/components/skin-picker.tsx");
    // 菜单项（默认项 + 主题项）与触发器三处都是 disabled={applying !== null}
    const hits = picker.split("disabled={applying !== null}").length - 1;
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it("图标 URL 已死时 onError 回退 🎨，不留破图框", () => {
    const picker = read("src/components/skin-picker.tsx");
    expect(picker).toContain("brokenIcons");
    expect(picker).toContain("onError={() =>");
    expect(picker).toContain("!brokenIcons.has(theme.slug)");
    // 坏掉的 URL 不许当文字画出来（会露出一串链接）
    expect(picker).toContain("isThemeIconUrl(theme.icon) ? '🎨' : (theme.icon ?? '🎨')");
  });
});
