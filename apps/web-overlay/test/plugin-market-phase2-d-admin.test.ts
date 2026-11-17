/**
 * Phase 2 批 D（管理台）守卫：审查差异吞错 + 全局 loading + 焦点 + 精选乐观更新
 * + 搜索框 + 趋势重试 + 举报 chip 选中态 + 上架确认。
 *
 * 复现基底（origin/main 23ca700f，真机探针 phase2d-repro2~5）：
 *   1. 审查差异 versions 500 时弹窗仍显示「该插件暂无已发布的历史版本」——
 *      handleOpenAudit 空 catch + fetchPluginVersions 内部吞错，失败被渲染成
 *      「无历史版本」。修后：失败走 auditFailed 失败态（带重试），与首发真
 *      无历史分开渲染。
 *   2. 评价区「刷新」加载态只有 disabled（无转圈、无文案变）；行操作共用一个
 *      全局 actionLoading，点一行时同页 45 个按钮一起禁用（真机实测
 *      disabledCount 45/45）；操作结束焦点落到 body 不回来；精选开关等请求
 *      回来才翻转。修后：行级 rowBusy（只禁用当前行 + 转圈 + 文案变）、
 *      刷新「刷新中…」+ 焦点归还、精选乐观更新（先翻转、失败回滚）。
 *   3. 管理台有 search state（接 q 参数）却没有输入框。修后：补手动搜索
 *      输入框（300ms 防抖）。
 *   4. 安装趋势失败只有一行文字、无重试按钮；举报 chip 无选中态。
 *   5. 「通过并上架」无二次确认（评估结论见 handleApprove 注释：行内一键
 *      直发加 confirm，审查弹窗内不加——弹窗本身就是审查步骤）。
 *   6. D5 评价治理隐藏/恢复：机制已在（confirm + moderate 接口 + 两 Tab），
 *      本文件不重复钉源码，由真机/e2e 探针验证（见批 D 报告）。
 *
 * 断言风格沿用本仓既有守卫（plugin-admin-paging-a34.test.ts 的源码断言 +
 * fetch 桩断言）。测试经 mirror:web 镜像到 apps/web/test/ 后跑。
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchPluginVersions } from "../src/lib/navhub-api";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ADMIN_PAGE = read("src/app/admin/plugins/page.tsx");
const TREND = read("src/components/plugins/plugin-install-trend.tsx");
const REPORT_MODAL = read("src/components/plugins/plugin-report-modal.tsx");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 把 fetch 换成固定状态码的响应。 */
function stubFetchStatus(status: number) {
  globalThis.fetch = (async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify({ error: "boom" }),
    } as unknown as Response;
  }) as typeof fetch;
}

function sliceBetween(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

/* ------------------------------------------------------------------ *
 * 1. 审查差异：失败态与真无历史分开
 * ------------------------------------------------------------------ */

describe("审查差异失败态（批 D-1）", () => {
  it("handleOpenAudit 不再空 catch：catch 里记 auditFailed", () => {
    const fn = sliceBetween(ADMIN_PAGE, "const handleOpenAudit", "const loadList");
    expect(fn).not.toContain("容错降级");
    expect(fn).toContain("setAuditFailed(true)");
    // 失败信号来自 onDegraded 回调（500/断网），不是 catch 兜底
    expect(fn).toContain("fetchPluginVersions(item.slug, () => setAuditFailed(true))");
  });

  it("弹窗有独立的失败态文案 + 重试按钮，与真无历史文案不同", () => {
    expect(ADMIN_PAGE).toContain("历史版本这次没能取回");
    expect(ADMIN_PAGE).toContain("重新取回历史版本");
    // 真无历史的文案仍在，且与失败文案是两段不同的文字
    expect(ADMIN_PAGE).toContain("该插件暂无已发布的历史版本（首次提交或首发版本），无需比对历史增量。");
    expect(ADMIN_PAGE).toContain("auditFailed ? (");
  });

  it("fetchPluginVersions：500 触发 onDegraded，404 不触发（首发空态约定）", async () => {
    stubFetchStatus(500);
    let degraded500 = 0;
    const r500 = await fetchPluginVersions("phase2d-probe-500", () => {
      degraded500++;
    });
    expect(r500.versions).toEqual([]);
    expect(degraded500).toBe(1);

    stubFetchStatus(404);
    let degraded404 = 0;
    const r404 = await fetchPluginVersions("phase2d-probe-404", () => {
      degraded404++;
    });
    expect(r404.versions).toEqual([]);
    expect(degraded404).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 2. 行级 loading + 焦点归还 + 精选乐观更新
 * ------------------------------------------------------------------ */

describe("行级 loading 与焦点（批 D-2/3/4，K1/K11）", () => {
  it("全局 actionLoading 已移除：全文件无 disabled={actionLoading}", () => {
    expect(ADMIN_PAGE).not.toContain("disabled={actionLoading}");
    expect(ADMIN_PAGE).not.toContain("setActionLoading");
    expect(ADMIN_PAGE).not.toContain("const [actionLoading");
  });

  it("行级 rowBusy：key 按行按操作拆分，按钮只禁用当前行", () => {
    for (const key of [
      "plugin:${plugin.slug}:approve",
      "plugin:${plugin.slug}:featured",
      "plugin:${plugin.slug}:delist",
      "plugin:${plugin.slug}:quarantine",
      "review:${review.id}:${action}",
      "review:${review.id}:${review.status === 'hidden' ? 'restore' : 'hide'}",
      "review:${review.id}:delete",
      "reject:${rejectPluginItem.slug}",
    ]) {
      expect(ADMIN_PAGE).toContain(key);
    }
    expect(ADMIN_PAGE).toContain("const [rowBusy, setRowBusy] = useState<Record<string, string>>({})");
  });

  it("进行中按钮文案变 + 转圈（K1）：上架/下架/隔离/隐藏/删除/刷新都有忙碌文案", () => {
    for (const label of ["上架中…", "下架中…", "隔离中…", "隐藏中…", "恢复中…", "删除中…", "提交中…", "刷新中…"]) {
      expect(ADMIN_PAGE).toContain(label);
    }
    expect(ADMIN_PAGE).toContain("animate-spin");
  });

  it("焦点归还（K11）：状态会变的行直接送目标 Tab，行留下的操作回原按钮", () => {
    expect(ADMIN_PAGE).toContain("focusStatusTab('published')");
    expect(ADMIN_PAGE).toContain("focusStatusTab('delisted')");
    expect(ADMIN_PAGE).toContain("focusStatusTab('quarantined')");
    expect(ADMIN_PAGE).toContain("focusStatusTab('rejected')");
    expect(ADMIN_PAGE).toContain("focusReviewTab(action === 'hide' ? 'hidden' : 'visible')");
    expect(ADMIN_PAGE).toContain("data-status-tab={tab.key}");
    expect(ADMIN_PAGE).toContain("data-review-tab={tab}");
    // 刷新按钮：刷新结束把焦点还给自己
    expect(ADMIN_PAGE).toContain('id="admin-reviews-refresh"');
  });
});

describe("精选乐观更新（批 D-5，K12）", () => {
  it("先本地翻转、再发请求：setPlugins 翻转在 await setPluginFeatured 之前", () => {
    const fn = sliceBetween(ADMIN_PAGE, "const handleToggleFeatured", "const handleModerateReview");
    const flipAt = fn.indexOf("setPlugins((prevList)");
    const awaitAt = fn.indexOf("await setPluginFeatured");
    expect(flipAt).toBeGreaterThanOrEqual(0);
    expect(awaitAt).toBeGreaterThan(flipAt);
  });

  it("失败回滚：catch 里把 featured 翻回操作前的值", () => {
    const fn = sliceBetween(ADMIN_PAGE, "const handleToggleFeatured", "const handleModerateReview");
    expect(fn).toContain("featured: prevFeatured");
    expect(fn).toContain("精选设置失败");
  });
});

/* ------------------------------------------------------------------ *
 * 3. 搜索框 / 4. 趋势重试 / 5. 举报 chip / 6. 上架确认
 * ------------------------------------------------------------------ */

describe("管理台搜索框（批 D-6）", () => {
  it("有手动搜索输入框（aria-label 搜索插件），接防抖后的查询", () => {
    expect(ADMIN_PAGE).toContain('aria-label="搜索插件"');
    expect(ADMIN_PAGE).toContain('placeholder="搜索插件名称 / 标识…"');
    expect(ADMIN_PAGE).toContain("setTimeout(() => setDebouncedSearch(search.trim()), 300)");
    expect(ADMIN_PAGE).toContain("q: debouncedSearch || undefined");
    expect(ADMIN_PAGE).toContain('aria-label="清除搜索"');
  });
});

describe("安装趋势重试（批 D-7）", () => {
  it("失败态有可点的重试按钮（aria-label 重新加载安装趋势），点后重拉", () => {
    expect(TREND).toContain('aria-label="重新加载安装趋势"');
    expect(TREND).toContain("重试");
    expect(TREND).toContain("setAttempt((n) => n + 1)");
    expect(TREND).toContain("[slug, attempt]");
    // 失败文案本身不变，不编造数据
    expect(TREND).toContain("安装趋势暂不可用，请稍后刷新重试。");
  });

  it("趋势接口已在网关策略中登记：否则 BFF 以 HUB_ROUTE_UNCLASSIFIED 拒绝，图表永远拉不到、重试按钮只是摆设", () => {
    // 根因（真机实测）：GET /api/plugins/:slug/trend 在 API 侧存在（D 批后端
    // 8884185d），但 hub-route-policy.generated.ts 自 B 批后再没重新生成，
    // 导致 /api/hub/plugins/:slug/trend 被网关拒绝、图表恒失败。
    // 修法是 sanctioned 的重新生成：node scripts/gen-hub-route-policy.mjs
    // （CI 另有 --check 守卫生成物过期）。
    const policy = read("src/lib/hub-route-policy.generated.ts");
    expect(policy).toContain('{ method: "GET", path: "/api/plugins/:slug/trend", scope: "public" }');
    // 同一次重新生成顺带补上的另三条 D 批后端路由（同一批缺口，同一份过期）
    expect(policy).toContain('{ method: "POST", path: "/api/plugins/:slug/disable", scope: "public" }');
    expect(policy).toContain('{ method: "POST", path: "/api/plugins/:slug/enable", scope: "public" }');
    expect(policy).toContain('{ method: "POST", path: "/api/plugins/author/profile", scope: "public" }');
  });
});

describe("举报 chip 选中态（批 D-8）", () => {
  it("选中的 chip 高亮 + aria-pressed，再点取消选择", () => {
    expect(REPORT_MODAL).toContain("aria-pressed={selected}");
    expect(REPORT_MODAL).toContain("const selected = reason === item");
    expect(REPORT_MODAL).toContain("bg-primary/10");
    expect(REPORT_MODAL).toContain("setReason(selected ? '' : item)");
  });
});

describe("通过并上架确认（批 D-9，评估后定）", () => {
  it("行内一键上架有 confirm；审查弹窗内跳过（弹窗本身就是审查步骤）", () => {
    expect(ADMIN_PAGE).toContain("确定要通过审核并上架插件");
    expect(ADMIN_PAGE).toContain("handleApprove(auditPluginItem, { skipConfirm: true })");
    const fn = sliceBetween(ADMIN_PAGE, "const handleApprove", "const handleSyncOfficialCatalog");
    expect(fn).toContain("opts?: { skipConfirm?: boolean }");
    expect(fn).toContain("if (!opts?.skipConfirm && !confirm(");
  });
});
