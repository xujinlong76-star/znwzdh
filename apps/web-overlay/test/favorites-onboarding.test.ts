/**
 * 0 收藏破冰空态 + 手动新建弹窗 + 文件夹整理效率（2026-11-21）。
 *
 * 钉死三块改造：
 *  1. 空态三卡（导入 / 探索 / 手动新建）——不再让用户抬头找按钮；
 *  2. 手动新建弹窗：URL + 标题 + 文件夹，Schema 兼容 LocalFavorite（siteId/href/title/folderId）；
 *  3. 桌面左侧文件夹树 + 移动端下拉；首次导入/首次加密备份的成长记账与克制 Toast。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("0 收藏破冰空态：三选一快速起步卡片组", () => {
  const page = overlaySource("src/app/favorites/page.tsx");
  const quickstart = overlaySource("src/components/user-center/favorites-quickstart.tsx");

  it("页面在 0 收藏分支渲染三卡组件，不再用纯文字空态", () => {
    expect(page).toContain("FavoritesQuickStartEmpty");
    expect(page).toContain("onImportClick={() => setShowUniversalImport(true)}");
    expect(page).toContain("onManualAddClick={() => setShowManualAdd(true)}");
    // 旧纯文字空态已下线（FAVORITES_EMPTY_COPY 不再被收藏页引用）
    expect(page).not.toContain("FAVORITES_EMPTY_COPY");
  });

  it("三张卡都有可点击目标与键盘可达的 button/Link 语义", () => {
    expect(quickstart).toContain('data-testid="quickstart-import"');
    expect(quickstart).toContain('data-testid="quickstart-explore"');
    expect(quickstart).toContain('data-testid="quickstart-manual"');
    // 探索卡是 Link 直达 /，另两卡是 button 原地触发
    expect(quickstart).toMatch(/<Link[^>]*href="\/"/);
    // 焦点环可见（键盘无障碍）
    expect(quickstart).toContain("focus-visible:ring-2");
  });

  it("一键搬家卡唤起现有书签导入弹层，探索卡附标签云/趋势榜快捷入口", () => {
    expect(quickstart).toContain("onImportClick");
    expect(quickstart).toContain("标签云");
    expect(quickstart).toContain("趋势榜");
    // 主推荐标记
    expect(quickstart).toContain("推荐");
  });
});

describe("手动新建自定义收藏弹窗", () => {
  const page = overlaySource("src/app/favorites/page.tsx");
  const modal = overlaySource("src/components/user-center/favorites-quickstart.tsx");

  it("弹窗挂载在收藏页，支持 URL + 标题 + 文件夹三段输入", () => {
    expect(page).toContain("FavoritesManualAddModal");
    expect(page).toContain("showManualAdd");
    expect(modal).toContain('id="manual-add-url"');
    expect(modal).toContain('id="manual-add-title"');
    expect(modal).toContain('id="manual-add-folder"');
  });

  it("URL 校验只放行 http/https，标题留空时回退域名", () => {
    expect(modal).toContain("normalizeManualUrl");
    expect(modal).toContain("http:");
    expect(modal).toContain("https:");
    expect(modal).toContain("hostname");
  });

  it("落库走 favorites.toggle（与星标同入口），Schema 兼容 LocalFavorite", () => {
    expect(page).toContain("favorites.toggle({");
    expect(page).toContain("siteId: item.siteId");
    expect(page).toContain("folderId: item.folderId");
    // siteId 生成复用导入链路同款函数
    expect(modal).toContain("generateBookmarkId");
  });

  it("支持在弹窗内新建收藏夹（createFolderDirectly）", () => {
    expect(modal).toContain("onCreateFolder");
    expect(modal).toContain('__new__');
    expect(page).toContain("onCreateFolder={createFolderDirectly}");
  });
});

describe("桌面左侧文件夹树 + 移动端下拉（整理效率）", () => {
  const page = overlaySource("src/app/favorites/page.tsx");

  it("桌面端有竖排文件夹树：全部收藏 / 自定义文件夹 / 新建入口", () => {
    expect(page).toContain('aria-label="收藏夹树"');
    expect(page).toContain("hidden lg:block lg:w-52");
    expect(page).toContain("lg:sticky");
    expect(page).toContain("全部收藏");
    expect(page).toContain('aria-label="新建收藏夹名称"');
  });

  it("移动端折叠为顶部下拉选择器（lg:hidden）", () => {
    expect(page).toContain("favorites-folder-select");
    expect(page).toContain("lg:hidden");
    expect(page).toContain("选择收藏夹");
  });

  it("右侧站点卡片区含搜索 + 批量整理（min-w-0 flex-1）", () => {
    expect(page).toContain("min-w-0 flex-1");
    expect(page).toContain('aria-label="筛选收藏"');
    expect(page).toContain("batchMode");
  });
});

describe("成长系统微激励联动", () => {
  const page = overlaySource("src/app/favorites/page.tsx");

  it("首次导入书签与首次加密备份触发成长记账 + 克制 Toast", () => {
    expect(page).toContain("celebrateFirstMilestone");
    expect(page).toContain("firstImportCelebrated");
    expect(page).toContain("firstVaultExportCelebrated");
    // 成长事件走 growth-lazy（首屏预算约束）
    expect(page).toContain("recordGrowthEvent('favorite_add'");
    expect(page).toContain("recordCustomSiteAddedAction()");
  });

  it("手动新建落库成功后给 Toast 正向反馈", () => {
    expect(page).toContain("已收进私密书签");
    expect(page).toContain("数字方舟进度 +1");
  });
});

describe("匿名警告合并 + 小猫挂件安全定位", () => {
  const page = overlaySource("src/app/favorites/page.tsx");
  const cat = overlaySource("public/xiaomaomao/xiaomaomao.js");

  it("匿名警告只保留 1 条且可关闭，底部不再复读", () => {
    expect(page).toContain("anonymousNoteDismissed");
    expect(page).toContain("关闭本次会话的匿名提示");
    // 底部复读文案已移除
    expect(page).not.toContain("当前为匿名身份：收藏只保存在本机浏览器");
  });

  it("/favorites 纳入小猫挂件底部安全锚点（bottom-6 right-5）", () => {
    expect(cat).toContain("onFavorites");
    expect(cat).toContain("xm-me-safe");
  });
});

describe("工作区 Tab 切换（?view= 同步）+ Header 紧凑化", () => {
  const page = overlaySource("src/app/favorites/page.tsx");

  it("Header 收口为 1 主动作 + 2 下拉菜单，删除面包屑与 9 个零散按钮", () => {
    expect(page).toContain("DropdownMenu");
    expect(page).toContain("备份与导出");
    // 面包屑已删（顶栏已有返回首页）
    expect(page).not.toContain("私密书签与 E2EE 金库");
    expect(page).not.toContain("更多导入导出");
    // JSON 保真说明移入下拉菜单底部注脚
    expect(page).toContain("JSON 是唯一保真格式");
  });

  it("0 条时主动作是高亮「导入书签」，导出菜单置灰 + Tooltip", () => {
    expect(page).toContain("导入书签");
    expect(page).toContain("收藏至少 1 个站点后可导出");
  });

  it("四个 Tab 走 ?view= 同步，星标插件与公开页由 Tab 承接", () => {
    expect(page).toContain("role=\"tablist\"");
    expect(page).toContain("activeView");
    expect(page).toContain("sites");
    expect(page).toContain("plugins");
    expect(page).toContain("annotations");
    expect(page).toContain("public");
    // 星标插件 / 公开页不再是首屏常驻卡
    expect(page).toContain("activeView === 'plugins'");
    expect(page).toContain("activeView === 'public'");
    expect(page).toContain("activeView === 'sites'");
  });

  it("加密技术说明收进 ? 展开（不铺满大段说明文字）", () => {
    expect(page).toContain("showCryptoHint");
    expect(page).toContain("密码不上云");
  });
});
