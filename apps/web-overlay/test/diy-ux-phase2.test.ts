import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * DIY UX Phase 2（W3）回归锁。
 *
 * 锁的是本轮改动的“别回退”点，不是行为全覆盖：对话框单挂载、Esc 归属、
 * 命中尺寸、空态、键盘缩放、确认/撤销与文案诚实度。纯源码断言（与
 * touch-keyboard-hints.test.ts 同款做法），不渲染组件。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

function count(src: string, re: RegExp): number {
  return (src.match(re) ?? []).length;
}

describe("分享确认对话框只挂载一个", () => {
  it("工具栏（编排态）只挂新版 HomeDiyShareConfirmDialog，不挂旧版", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(count(src, /<HomeDiyShareConfirmDialog/g)).toBe(1);
    expect(src).not.toContain("<HomeDIYShareDialog");
    expect(src).not.toContain("from '@/components/home-diy-share-dialog'");
    expect(src).not.toContain("pendingShare={pendingShare}");
  });

  it("触发器（静息态）同样只挂新版，两态各一个、不叠加", () => {
    const src = overlayFile("src/components/home-diy-trigger.tsx");
    expect(count(src, /<HomeDiyShareConfirmDialog/g)).toBe(1);
    expect(src).not.toContain("<HomeDIYShareDialog");
  });
});

describe("工具栏 Esc 与快捷键归属", () => {
  it("工具栏 Esc 退出编排前先看有没有对话框/菜单开着", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain('[role="dialog"]:not([aria-hidden="true"])');
    expect(src).toContain('[role="menu"]:not([aria-hidden="true"])');
    expect(src).toContain("overlayOpen");
  });

  it("全局单字符快捷键不在输入/下拉/自定义输入框/组字时触发", () => {
    const src = overlayFile("src/components/keyboard-shortcuts-dialog.tsx");
    expect(src).toContain("tagName === 'SELECT'");
    expect(src).toContain("getAttribute('role') === 'textbox'");
    expect(src).toContain("getAttribute('role') === 'combobox'");
    expect(src).toContain("e.isComposing");
    expect(src).toContain("document.activeElement");
  });
});

describe("工具栏文案与无障碍", () => {
  it("大纲/回收站/新建三个图标按钮都有 aria-label", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain('aria-label="大纲与功能矩阵管理器"');
    expect(src).toContain('aria-label="回收站：恢复已删减模块或站点"');
    expect(src).toContain('aria-label="新建专属分类"');
  });

  it("不再写死 18 大主分类（根类目数会变，硬编码必过期）", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).not.toContain("18大主分类");
  });

  it("一键重置明说会同时恢复已删减功能", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain("同时恢复所有已删减功能");
  });

  it("存储配额横幅有恢复动作：导出备份", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain("导出备份");
    expect(src).toContain("setIsBackupOpen(true)");
  });

  it("完成按钮不在横向滚动区里：滚动只发生在左侧控制簇", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain("overflow-x-auto no-scrollbar min-w-0 flex-1");
    expect(src).not.toContain(
      "'flex items-center justify-between gap-2 overflow-x-auto no-scrollbar'",
    );
  });

  it("强调色圆点 36px 视觉 + ::after 扩至 44px 命中区，且带 aria-pressed（P1 #10 2026-11-13 升级）", () => {
    const src = overlayFile("src/components/home-diy-toolbar.tsx");
    expect(src).toContain("aria-pressed={accentColor === item.id}");
    // P1 #10：24px（h-6 w-6）升级为 36px 视觉 + ::after -inset-1 扩至 44px 命中区
    expect(src).toContain(
      "relative h-9 w-9 rounded-full transition-transform hover:scale-110 flex items-center justify-center after:absolute after:-inset-1 after:content-['']",
    );
  });
});

describe("看板删除：确认 + 历史 + 提示", () => {
  it("deleteBoard 删前压历史快照并返回被删看板信息", () => {
    const src = overlayFile("src/lib/modular/use-modular-layout.ts");
    expect(src).toContain("widgetCount: deleted.widgets.length");
    expect(src).toContain("return { id: deleted.id, name: deleted.name, widgetCount:");
  });

  it("画布删看板先确认、删完报撤销退路，按钮 44px 且键盘聚焦可见（P1 #10 2026-11-13 升级）", () => {
    const src = overlayFile("src/components/modular/modular-canvas.tsx");
    expect(src).toContain("handleDeleteBoard");
    expect(src).toContain("window.confirm(");
    expect(src).toContain("按 Ctrl/Cmd+Z 可撤销恢复");
    // P1 #10：24px（min-h-6 min-w-6）升级为 44px（min-h-11 min-w-11）
    expect(src).toContain("min-h-11 min-w-11");
    expect(src).toContain("group-focus-within/tab:opacity-100");
    expect(src).toContain("focus-visible:opacity-100");
  });
});

describe("画布背景 / 导入 / 空态", () => {
  it("画布背景四个切换按钮带 aria-pressed 且不低于 44px（P1 #10 2026-11-13 升级）", () => {
    const src = overlayFile("src/components/modular/modular-canvas.tsx");
    expect(count(src, /aria-pressed=\{canvasBg ===/g)).toBe(4);
    // P1 #10：24px（min-h-6）升级为 44px（min-h-11）
    expect(src).toContain("px-1.5 py-1 min-h-11 rounded-lg");
  });

  it("画布导出/导入/重置三个图标按钮都有 aria-label", () => {
    const src = overlayFile("src/components/modular/modular-canvas.tsx");
    expect(src).toContain('aria-label="导出为 JSON 备份"');
    expect(src).toContain('aria-label="导入 JSON 配置文件"');
    expect(src).toContain('aria-label="重置为默认模版"');
  });

  it("画布导入 FileReader 有 onerror（与备份弹窗同口径）", () => {
    const src = overlayFile("src/components/modular/modular-canvas.tsx");
    expect(src).toContain("reader.onerror");
    expect(src).toContain("读取文件失败");
  });

  it("空画布有真实的套用模版按钮，不再只靠文案承诺", () => {
    const src = overlayFile("src/components/modular/modular-canvas.tsx");
    expect(src).toContain("套用预设模版");
    expect(src).toContain("setIsTemplateOpen(true)");
  });
});

describe("模块库空态与搜索", () => {
  it("零结果有空态、有清空搜索与分类筛选的出口", () => {
    const src = overlayFile("src/components/modular/module-library-modal.tsx");
    expect(src).toContain("没有找到匹配");
    expect(src).toContain("清空搜索与分类筛选");
    expect(src).toContain('aria-label="清空搜索"');
  });

  it("拖拽手柄命中区 24px 宽", () => {
    const src = overlayFile("src/components/modular/module-library-modal.tsx");
    expect(src).toContain("h-6 w-6 rounded-md cursor-grab");
  });
});

describe("缩放手柄是可聚焦控件", () => {
  it("六个手柄都是 role=slider、可聚焦、有键盘操作", () => {
    const src = overlayFile("src/components/modular/module-resize-handles.tsx");
    expect(count(src, /role="slider"/g)).toBe(6);
    expect(count(src, /tabIndex=\{0\}/g)).toBe(6);
    for (const dir of ["w", "e", "n", "s", "sw", "se"]) {
      expect(src).toContain(`onKeyDown={handleHandleKeyDown('${dir}')}`);
      expect(src).toContain(`data-resize-handle="${dir}"`);
    }
    expect(src).toContain("Enter 恢复默认尺寸");
    expect(src).toContain("handleHandleKeyDown");
    expect(src).toContain("endKeyboardSession");
  });

  it("手柄命中区不低于 24px（边 24px 宽/高、角 24×24）", () => {
    const src = overlayFile("src/components/modular/module-resize-handles.tsx");
    expect(src).toContain("left-0 w-6 z-30 cursor-ew-resize");
    expect(src).toContain("right-0 w-6 z-30 cursor-ew-resize");
    expect(src).toContain("top-0 h-6 z-30 cursor-ns-resize");
    expect(src).toContain("bottom-0 h-6 z-30 cursor-ns-resize");
    expect(src).toContain("bottom-0 left-0 w-6 h-6 z-35 cursor-nesw-resize");
    expect(src).toContain("bottom-0 right-0 p-1.5 w-6 h-6 z-35 cursor-nwse-resize");
  });
});

describe("大纲搜索可清空", () => {
  it("大纲搜索框有清空按钮", () => {
    const src = overlayFile("src/components/home-diy-outline-dialog.tsx");
    expect(src).toContain('aria-label="清空搜索"');
    expect(src).toContain("setSearchQuery('')");
  });
});
