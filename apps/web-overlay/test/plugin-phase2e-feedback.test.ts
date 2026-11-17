/**
 * Phase 2 批 E 反馈与交互快打磨的守卫。
 *
 * 守三件事：
 * 1. 失败 toast 三类指导语模板（K7）：网络→检查网络、401/403→重新登录、
 *    409/422→刷新确认、5xx→稍后重试；err.message 只做括号补充；同一操作
 *    连续失败两次文案一致（纯函数，无服务端依赖）。
 * 2. 失败 toast 统一配置（K5）：8 秒停留 + 「重试」入口。
 * 3. 本批 UI 改动的静态存在性：回滚确认（K4）、评价/安装/举报/星标重试、
 *    已安装横幅常驻+重试+role="status"、停用撤销、主题加载态、体检复制/导出
 *    反馈、一键净网确认、手机点按区规则、卡片无障碍与按下态、详情骨架屏、
 *    alogo.webp 404 根除。
 *
 * 证伪方法（R7）：本文件对基底（23ca700f）应全红——每条守卫都锚定一次
 * 真实旧错（复现见批 E 任务书 §1）；修后全绿。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FAILURE_TOAST_DURATION_MS,
  failureDescription,
  failureGuidance,
  failureToastOptions,
} from "../src/lib/failure-guidance";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) =>
    p.replace(/\\/g, "/").includes("/web-overlay/") || p.replace(/\\/g, "/").endsWith("/web-overlay");
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

function readOverlay(rel: string): string {
  return readFileSync(join(overlayRoot(), "src", rel), "utf8");
}

describe("K7 失败指导语三类模板", () => {
  it("网络类失败给「请检查网络后重试」", () => {
    expect(failureGuidance(new Error("fetch failed"))).toContain("请检查网络后重试");
    expect(failureGuidance(new Error("Failed to fetch"))).toContain("请检查网络后重试");
    expect(failureGuidance(new Error("NetworkError"))).toContain("请检查网络后重试");
    expect(failureGuidance(new Error("请求超时"))).toContain("请检查网络后重试");
    expect(failureGuidance(new Error("503 Service Unavailable"))).toContain("请检查网络后重试");
  });

  it("401/403 给「请重新登录后重试」", () => {
    const err = new Error("Unauthorized") as Error & { status?: number };
    err.status = 401;
    expect(failureGuidance(err)).toContain("请重新登录后重试");
    const forbidden = new Error("Forbidden") as Error & { status?: number };
    forbidden.status = 403;
    expect(failureGuidance(forbidden)).toContain("请重新登录后重试");
  });

  it("409/422 给「刷新页面确认最新状态」", () => {
    const err = new Error("conflict") as Error & { status?: number };
    err.status = 409;
    expect(failureGuidance(err)).toContain("请刷新页面确认最新状态");
  });

  it("5xx 与默认给「请稍后重试」", () => {
    const err = new Error("boom") as Error & { status?: number };
    err.status = 500;
    expect(failureGuidance(err)).toContain("请稍后重试");
    expect(failureGuidance(new Error("boom"))).toBe("请稍后重试。");
    expect(failureGuidance(null)).toBe("请稍后重试。");
  });

  it("err.message 只做括号补充，不做主文案", () => {
    const desc = failureDescription(new Error("fetch failed"));
    expect(desc.startsWith("请检查网络后重试")).toBe(true);
    expect(desc).toContain("（fetch failed）");
    // 同一操作连续失败两次文案一致：指导语部分不因服务端文案漂移
    expect(failureDescription(new Error("fetch failed"))).toBe(failureDescription(new Error("fetch failed")));
    expect(failureGuidance(new Error("fetch failed"))).toBe(failureGuidance(new Error("timeout")));
  });
});

describe("K5 失败 toast 统一配置", () => {
  it("停留 8 秒 + 「重试」入口", () => {
    expect(FAILURE_TOAST_DURATION_MS).toBe(8000);
    const retry = () => {};
    const opts = failureToastOptions(new Error("x"), retry);
    expect(opts.duration).toBe(8000);
    expect(opts.action.label).toBe("重试");
    expect(opts.action.onClick).toBe(retry);
    expect(opts.description).toContain("请稍后重试");
  });
});

describe("K4 回滚确认（版本时间轴）", () => {
  const timeline = () => readOverlay("components/plugins/plugin-version-timeline.tsx");

  it("回滚先 confirm，文案含版本号与将移除的站点数", () => {
    const src = timeline();
    expect(src).toContain("window.confirm");
    expect(src).toContain("确定要回滚到 v${targetVersion} 吗？");
    expect(src).toContain("新版独有站点");
    // 站点数取自 diffAgainstCurrent.sitesAddedCount（服务端 diff(旧版, 当前) 的新增数）
    expect(src).toContain("diffAgainstCurrent");
    expect(src).toContain("sitesAddedCount");
  });

  it("安装成功 toast 不再写「回滚」", () => {
    const src = timeline();
    expect(src).not.toContain("已成功生效/回滚至版本");
    expect(src).toContain("已成功安装版本 v${targetVersion}");
    expect(src).toContain("已重新安装版本 v${targetVersion}");
  });

  it("success===false 且未抛错时有明确反馈（P1-5）", () => {
    const src = timeline();
    expect(src).toContain("toast.error('回滚失败'");
    expect(src).toContain("toast.error('安装版本失败'");
  });

  it("快照查看失败有重试入口", () => {
    const src = timeline();
    expect(src).toContain("toast.error('获取版本快照失败'");
    expect(src).toContain("failureToastOptions(err, () => void handleInspect(ver))");
  });
});

describe("K5/K7 失败重试覆盖（评价/安装/举报/星标/作者档案）", () => {
  it("评价提交/回复/删除/举报/加载更多失败都有重试", () => {
    const src = readOverlay("components/plugins/plugin-review-section.tsx");
    expect(src).toContain("toast.error('提交评价失败'");
    expect(src).toContain("toast.error('作者回复发布失败'");
    expect(src).toContain("toast.error('删除评价失败'");
    expect(src).toContain("toast.error('举报失败'");
    expect(src).toContain("toast.error('加载更多评价失败'");
    expect(src.match(/failureToastOptions\(/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    // 删除第二步确认中有转圈，不只 disabled
    expect(src).toContain("删除中...");
    expect(src).toContain("animate-spin");
  });

  it("安装弹窗失败有重试", () => {
    const src = readOverlay("components/plugins/plugin-install-modal.tsx");
    expect(src).toContain("failureToastOptions(err, () => void handleConfirm())");
  });

  it("举报插件弹窗失败有重试", () => {
    const src = readOverlay("components/plugins/plugin-report-modal.tsx");
    expect(src).toContain("toast.error('举报提交失败'");
    expect(src).toContain("failureToastOptions(err, () => void submitReport())");
  });

  it("卡片与详情页星标失败有重试", () => {
    const card = readOverlay("components/plugins/plugin-card.tsx");
    expect(card).toContain("toast.error('星标更新失败'");
    expect(card).toContain("failureToastOptions(err, () => void toggleStar())");
    const detail = readOverlay("app/marketplace/[slug]/plugin-detail-view.tsx");
    expect(detail).toContain("toast.error('星标更新失败'");
    expect(detail).toContain("failureToastOptions(err, () => void handleStarToggle())");
  });

  it("作者档案保存失败有重试", () => {
    const src = readOverlay("app/marketplace/author/[key]/author-plugins-view.tsx");
    expect(src).toContain("toast.error('保存失败'");
    expect(src).toContain("failureToastOptions(err, () => void handleSaveProfile())");
  });
});

describe("K6/K9/K15 已安装页横幅与停用撤销", () => {
  const installed = () => readOverlay("app/marketplace/installed/page.tsx");

  it("横幅常驻到用户关闭（无 3 秒自动消失）+ role=status + 横幅内重试", () => {
    const src = installed();
    expect(src).not.toContain("setTimeout(() => setActionMessage(null), 3000)");
    expect(src).toContain('role="status"');
    expect(src).toContain("重试");
    expect(src).toContain("showActionMessage(`升级失败：");
    expect(src).toContain("showActionMessage(`卸载失败：");
    expect(src).toContain("showActionMessage(`停用失败：");
    expect(src).toContain("showActionMessage(`启用失败：");
  });

  it("停用成功走 toast + 5 秒内「撤销」一键重新启用", () => {
    const src = installed();
    expect(src).toContain("toast.success(`已停用「${item.name}」`");
    expect(src).toContain("duration: 5000");
    expect(src).toContain("label: '撤销'");
  });

  it("主题「启用」有 *Slug 守卫（K2），「重新启用」与「启用」都有加载态禁用", () => {
    const src = installed();
    expect(src).toContain("activatingThemeSlug");
    expect(src).toContain("disabled={togglingSlug === theme.slug}");
    expect(src).toContain("disabled={activatingThemeSlug === theme.slug}");
  });
});

describe("K10/K17 卡片反馈", () => {
  const card = () => readOverlay("components/plugins/plugin-card.tsx");

  it("星标按钮有 aria-label + aria-pressed（照抄详情页版）", () => {
    const src = card();
    expect(src).toContain("aria-label={starred ? '取消星标' : '点亮星标'}");
    expect(src).toContain("aria-pressed={starred}");
  });

  it("星标加载态有旋转图标，不只禁用（限定星标按钮内，不被分享按钮同串误过）", () => {
    const src = card();
    const start = src.indexOf("onClick={handleStarToggle}");
    expect(start).toBeGreaterThan(-1);
    const starButton = src.slice(start, src.indexOf("</button>", start));
    expect(starButton).toContain("aria-pressed={starred}");
    expect(starButton).toContain('<Loader2 className="w-3.5 h-3.5 animate-spin" />');
  });

  it("卡片标题有 active: 按下态", () => {
    const src = card();
    expect(src).toContain("active:opacity-70");
  });

  it("详情页不得有 loading.tsx（软 404 根因），加载态由详情岛自带骨架屏承接", () => {
    // P2-7：loading.tsx 边界会让 Next 先流式刷出 HTTP 200 壳，之后
    // notFound() 再抛也改不了状态码（与 /site/[id]、/collections/[slug]
    // 同一根因，见 site/[id]/page.tsx 头部实测铁律）。父级
    // /marketplace/loading.tsx 同样包住详情段，必须一起去掉；
    // 详情岛 loading=true 时自带 animate-pulse 骨架屏，加载体验不受影响。
    expect(
      existsSync(join(overlayRoot(), "src", "app", "marketplace", "[slug]", "loading.tsx")),
    ).toBe(false);
    expect(existsSync(join(overlayRoot(), "src", "app", "marketplace", "loading.tsx"))).toBe(false);
    const detail = readOverlay("app/marketplace/[slug]/plugin-detail-view.tsx");
    expect(detail).toContain("if (loading)");
    expect(detail).toContain("animate-pulse");
  });
});

describe("K3/K14 详情页分享与外链", () => {
  const detail = () => readOverlay("app/marketplace/[slug]/plugin-detail-view.tsx");

  it("分享短链创建期间有转圈", () => {
    const src = detail();
    expect(src).toContain("sharingLink");
    expect(src).toContain('<Loader2 className="w-4 h-4 animate-spin text-primary" />');
  });

  it("外链有「在新标签页打开」提示", () => {
    const src = detail();
    expect(src).toContain("（在新标签页打开）");
    expect(src).toContain('aria-label="支持作者（在新标签页打开）"');
    expect(src).toContain('aria-label="项目主页 / 源码（在新标签页打开）"');
  });
});

describe("K13/P2-9/P2-13/P2-14 体检面板", () => {
  const panel = () => readOverlay("components/plugins/plugin-url-health-panel.tsx");

  it("复制按钮复用 use-copy-feedback，复制失败有行内失败态 + toast，不再静默", () => {
    const src = panel();
    expect(src).toContain("useCopyFeedback()");
    expect(src).toContain("copyFailureToast(result)");
    expect(src).not.toContain("if (!result.ok) return");
  });

  it("导出 JSON/Markdown 有成功反馈与失败分支（含重试）", () => {
    const src = panel();
    expect(src).toContain("体检报告（JSON）已导出");
    expect(src).toContain("体检报告（Markdown）已导出");
    expect(src).toContain("toast.error('导出体检报告失败'");
    expect(src).toContain("failureToastOptions(err, () => exportReport(format))");
  });

  it("一键净网剔除死链有二次确认（写清条数）", () => {
    const src = panel();
    expect(src).toContain("确定要剔除这 ${urls.length} 条死链吗？");
    expect(src).toContain("window.confirm");
    expect(src).not.toContain("直接剔除死链（无二次弹窗）");
  });
});

describe("K8 手机点按区全局规则", () => {
  it("globals.css 有 <640px 的 .market-touch 规则，最小边 2.75rem", () => {
    const css = readOverlay("styles/globals.css");
    expect(css).toContain(".market-touch button");
    expect(css).toContain("@media (max-width: 639px)");
    expect(css).toContain("min-height: 2.75rem");
    expect(css).toContain("min-width: 2.75rem");
    // checkbox/radio 不被撑大
    expect(css).toContain("input:not([type='checkbox']):not([type='radio'])");
  });

  it("Sonner toast 在弹窗打开时仍可点按（K5 重试按钮不被 remove-scroll 禁点）", () => {
    const css = readOverlay("styles/globals.css");
    // Radix 弹窗打开时 react-remove-scroll 给 body 加 block-interactivity
    // （pointer-events:none），弹窗外的 toast 会被连带禁点；本条显式恢复。
    expect(css).toContain("[data-sonner-toast]");
    expect(css).toContain("pointer-events: auto");
  });

  it("globals.css 注释无提前闭合（K8 注释里的星号斜杠曾让整站 500）", () => {
    const css = readOverlay("styles/globals.css");
    // 剥掉全部 /* ... */ 注释后不应残留任何注释标记：残留即有注释提前闭合，
    // 剩余中文会变成裸 CSS，PostCSS 解析失败、整站 500。
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toContain("/*");
    expect(stripped).not.toContain("*/");
    expect(stripped).toContain(".market-touch button");
  });

  it("市场 layout、管理台 layout 与移动端底栏都挂了 .market-touch", () => {
    // P2-16：市场 layout 的 className 在 market-touch 后追加了底部安全区 pb，
    // 这里只钉作用域类本身存在；完整类名由 plugin-market-touch-footer.test.ts 钉死。
    expect(readOverlay("app/marketplace/layout.tsx")).toContain("market-touch");
    expect(readOverlay("app/admin/layout.tsx")).toContain('className="market-touch"');
    // 底栏 5 个 tab 原高 36px（<44），挂作用域后 min-height 撑到 44px，仍在 h-14 栏内
    expect(readOverlay("components/mobile-nav.tsx")).toContain("market-touch");
  });
});

describe("网关策略表：disable/enable 必须登记（K15 曾被 403 拦住）", () => {
  it("hub-route-policy.generated.ts 含 disable/enable/author-profile/trend", () => {
    const policy = readOverlay("lib/hub-route-policy.generated.ts");
    expect(policy).toContain('"/api/plugins/:slug/disable", scope: "public"');
    expect(policy).toContain('"/api/plugins/:slug/enable", scope: "public"');
    expect(policy).toContain('"/api/plugins/author/profile", scope: "public"');
    expect(policy).toContain('"/api/plugins/:slug/trend", scope: "public"');
  });
});

describe("日志噪声：alogo.webp 404 根除", () => {
  it("overlay 全仓无 /assets/images/alogo.webp 引用", () => {
    const root = overlayRoot();
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
          if (name === "node_modules" || name === ".next") continue;
          walk(p);
        } else if (/\.(ts|tsx|js|jsx|json|md)$/.test(name)) {
          if (readFileSync(p, "utf8").includes("/assets/images/alogo.webp")) hits.push(p);
        }
      }
    };
    walk(join(root, "src"));
    expect(hits).toEqual([]);
  });

  it("登录/注册页与管理台回退图指向真实存在的 /icons/icon-192.png", () => {
    expect(existsSync(join(overlayRoot(), "public", "icons", "icon-192.png"))).toBe(true);
    expect(readOverlay("app/auth/signin/page.tsx")).toContain("/icons/icon-192.png");
    expect(readOverlay("app/auth/signup/page.tsx")).toContain("/icons/icon-192.png");
    expect(readOverlay("lib/auth.ts")).toContain("/icons/icon-192.png");
    expect(readOverlay("app/admin/layout.tsx")).toContain("/icons/icon-192.png");
  });
});
