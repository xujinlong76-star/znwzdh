/**
 * 插件市场 REST 路由（**组合入口**）。
 *
 * 原文件 2281 行 / 50 条路由，单文件承担了"市场浏览 + 详情工具 + 版本评价 + 上架互动 +
 * 短链订阅源"五类职责。现按**连续区间**拆成 5 个分段模块（`routes/plugins/*.ts`），
 * 本文件只保留模块级文档与顺序组合。
 *
 * 为什么直接调用子模块函数、而不是 `app.register()`：
 *   register 会把子插件的执行延后到父级 ready 之后，子插件的路由因此落在父级
 *   其余路由**之后**——注册顺序被改变。直接调用（`await part(app, opts)`）保持
 *   "声明即注册"，于是"改造前后 `app.printRoutes()` 逐字节一致"成为可验证的不变量
 *   （已实测比对）。分段按连续区间切、而非按主题重排，同样是为了守住这个不变量。
 *
 * 契约见 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md 与 apps/api/test/plugins-api.test.ts。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { pluginRoutesPart1 } from "./plugins/p1-market-browse.ts";
import { pluginRoutesPart2 } from "./plugins/p2-detail-and-tools.ts";
import { pluginRoutesPart3 } from "./plugins/p3-versions-and-reviews.ts";
import { pluginRoutesPart4 } from "./plugins/p4-publish-and-engage.ts";
import { pluginRoutesPart5 } from "./plugins/p5-shortlinks-and-taps.ts";

/** 官方精选订阅源常量：随 taps 路由一起留在 p5，这里仅为保持对外导出面不变 */
export { FEATURED_TAPS } from "./plugins/p5-shortlinks-and-taps.ts";

export const pluginRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  await pluginRoutesPart1(app, opts);
  await pluginRoutesPart2(app, opts);
  await pluginRoutesPart3(app, opts);
  await pluginRoutesPart4(app, opts);
  await pluginRoutesPart5(app, opts);
};