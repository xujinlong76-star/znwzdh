/**
 * REST 契约覆盖率判定（纯函数，零 IO）。
 *
 * 与「响应契约棘轮」互补：那条棘轮管**读**路由（未绑定的精确快照只许缩小），
 * 这里管**写**路由——写操作的响应形状是前端与脚本的公共面，不能靠「以后再说」
 * 无限期拖欠。规则：
 *   - 每条写路由（POST/PUT/PATCH/DELETE）必须有响应契约绑定，或进入 allowlist
 *     且写明理由；
 *   - allowlist 只许缩小：路由补了绑定、改了名或删了，对应行必须同步删除；
 *   - 公开高频读路由的 Top 20 必须全部绑定（这些端点是前台首屏与搜索的直接数据源）；
 *   - 管理读路由由读路由棘轮兜底，这里只统计、不重复判红。
 *
 * 为什么 allowlist 要带理由：只写「豁免」两个字，三个月后没人知道是技术限制
 * （SSE 事件流）还是纯拖欠。理由写在行内，评审时能直接判断该不该豁免。
 */

export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 与 server.ts / openapi.ts 同口径：`:id` → `{id}` */
export function bindingKeyOf(route) {
  return route.method.toUpperCase() + " " + route.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/**
 * 公开高频读路由 Top 20：前台首屏、搜索、站点详情、类目/标签/分面与插件市场
 * 的直接数据源。少一条绑定，生成的前端类型就少一块，手写类型又会悄悄长回来。
 */
export const PRIORITY_PUBLIC_READS = [
  "GET /api/health",
  "GET /api/search",
  "GET /api/sites",
  "GET /api/sites/{id}",
  "GET /api/categories",
  "GET /api/categories/page",
  "GET /api/categories/counts",
  "GET /api/categories/{id}",
  "GET /api/categories/by-slug/{slug}",
  "GET /api/tags",
  "GET /api/tags/resolve",
  "GET /api/facets",
  "GET /api/sites/{id}/facets",
  "GET /api/plugins",
  "GET /api/plugins/{slug}",
  "GET /api/plugins/installed",
  "GET /api/plugins/taps/public",
  "GET /api/rank/trending",
  "GET /api/rank/new",
  "GET /api/collections",
];

/**
 * 解析 allowlist 文本：`METHOD /path | 理由`，`#` 开头的整行与空行忽略。
 * 理由为空视为格式错误——豁免必须说清楚为什么。
 */
export function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sep = line.indexOf("|");
    if (sep < 0) {
      errors.push(`第 ${index + 1} 行缺少「|」与豁免理由：${line}`);
      return;
    }
    const key = line.slice(0, sep).trim();
    const reason = line.slice(sep + 1).trim();
    if (!key) errors.push(`第 ${index + 1} 行路由键为空`);
    if (!reason) errors.push(`第 ${index + 1} 行豁免理由为空：${key}`);
    if (key && reason) entries.push({ key, reason, line: index + 1 });
  });
  return { entries, errors };
}

/**
 * 计算覆盖率与违规项。
 *
 * @param routes     路由清单（{ method, url, scope }）
 * @param bindings   RESPONSE_SCHEMA_BINDINGS
 * @param allowlist  parseAllowlist 的结果
 */
export function analyzeCoverage({ routes, bindings, allowlist }) {
  const problems = [...allowlist.errors];
  const normalized = routes.map((route) => ({
    key: bindingKeyOf(route),
    method: route.method.toUpperCase(),
    scope: route.scope,
  }));

  const writeRoutes = normalized.filter((route) => WRITE_METHODS.has(route.method));
  const readRoutes = normalized.filter((route) => READ_METHODS.has(route.method));
  const publicReads = readRoutes.filter((route) => route.scope === "public");
  const adminReads = readRoutes.filter((route) => route.scope === "admin");

  const unboundWrites = writeRoutes.filter((route) => !(route.key in bindings));
  const unboundWriteKeys = new Set(unboundWrites.map((route) => route.key));
  const allowlistKeys = new Set(allowlist.entries.map((entry) => entry.key));

  for (const route of unboundWrites) {
    if (!allowlistKeys.has(route.key)) {
      problems.push(
        `写路由未绑定响应契约且不在 allowlist：${route.key}。` +
          "补 schema + RESPONSE_SCHEMA_BINDINGS，或把该键与理由写进 unbound-write-routes.txt",
      );
    }
  }

  const writeKeys = new Set(writeRoutes.map((route) => route.key));
  for (const entry of allowlist.entries) {
    if (!writeKeys.has(entry.key)) {
      problems.push(
        `allowlist 陈旧（第 ${entry.line} 行）：${entry.key} 已不是真实写路由（改名/删除？），请删除该行`,
      );
      continue;
    }
    if (!unboundWriteKeys.has(entry.key)) {
      problems.push(
        `allowlist 陈旧（第 ${entry.line} 行）：${entry.key} 已绑定响应契约，请删除该行（allowlist 只许缩小）`,
      );
    }
  }

  const readKeys = new Set(readRoutes.map((route) => route.key));
  const missingPriority = PRIORITY_PUBLIC_READS.filter((key) => {
    if (!(key in bindings)) return true;
    return !readKeys.has(key);
  });
  for (const key of missingPriority) {
    problems.push(
      readKeys.has(key)
        ? `公开高频读路由缺少响应契约：${key}（Top 20 必须全部绑定）`
        : `Top 20 清单里的路由在路由表中不存在：${key}（改名后请同步更新清单）`,
    );
  }

  const countBound = (list) => list.filter((route) => route.key in bindings).length;
  return {
    problems,
    stats: {
      write: { total: writeRoutes.length, bound: countBound(writeRoutes), allowlisted: allowlist.entries.length },
      publicRead: { total: publicReads.length, bound: countBound(publicReads) },
      adminRead: { total: adminReads.length, bound: countBound(adminReads) },
      priorityPublicRead: {
        total: PRIORITY_PUBLIC_READS.length,
        bound: PRIORITY_PUBLIC_READS.length - missingPriority.length,
      },
    },
    unboundWrites: unboundWrites.map((route) => route.key).sort(),
    missingPriority,
  };
}
