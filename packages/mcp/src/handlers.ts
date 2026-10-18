/**
 * MCP 工具实现（组合入口）。
 *
 * 与 REST API 共用同一套仓储 / 检索引擎 / AI 能力（通过 AppContext 注入），
 * 因此 MCP 与网页端的所见所得完全一致，不会出现"两套逻辑算出两个答案"。
 *
 * 每个写操作都做三件事：权限校验 -> 幂等去重 -> 审计落库。
 *
 * 具体处理器按域拆在 ./handlers/ 下（sites / catalog / jobs / algorithms /
 * discovery / state-sync / developer-tools），本文件只负责组装：
 * 构造共享依赖（上下文、幂等、向量索引），把各域 `(deps, args, tc)` 处理器
 * 绑定成对外 `(args, tc)` 并合并为一个对象。对调用方而言 API 完全不变。
 */
import type { AppContext } from "@navhub/api";
import { algorithmHandlers } from "./handlers/algorithms.ts";
import { catalogHandlers } from "./handlers/catalog.ts";
import { developerToolHandlers } from "./handlers/developer-tools.ts";
import { discoveryHandlers } from "./handlers/discovery.ts";
import { jobHandlers } from "./handlers/jobs.ts";
import { pluginHandlers } from "./handlers/plugins.ts";
import { bind, makeIndexSite, makeWithIdempotency, type HandlerDeps } from "./handlers/shared.ts";
import { siteHandlers } from "./handlers/sites.ts";
import { stateSyncHandlers } from "./handlers/state-sync.ts";

export type { ToolResult } from "./handlers/shared.ts";

export function createHandlers(ctx: AppContext) {
  const deps: HandlerDeps = {
    ctx,
    withIdempotency: makeWithIdempotency(ctx),
    indexSite: makeIndexSite(ctx),
  };

  return {
    ...bind(siteHandlers, deps),
    ...bind(catalogHandlers, deps),
    ...bind(jobHandlers, deps),
    ...bind(algorithmHandlers, deps),
    ...bind(discoveryHandlers, deps),
    ...bind(stateSyncHandlers, deps),
    ...bind(developerToolHandlers, deps),
    ...bind(pluginHandlers, deps),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
