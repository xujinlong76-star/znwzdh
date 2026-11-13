/**
 * 文档数字与数据诚实守卫（DEV_BACKLOG B13，第 15 轮）：
 *
 * 文档里的规模数字长期手写、无人核对，系统性漂移过（MCP 15/17/35/32 四种说法、
 * REST 62、表 19/25、网址包 20、Next.js 15）。本文件把 2026-11-11 实锤的
 * 真相数字 pin 住：代码事实源（MCP_TOOL_DEFS / schema.ts / metrics.json）
 * 与现行文档（wiki / CODEBASE_OVERVIEW / FILE_INDEX / 扩展 README / seed 注释）
 * 必须一致；可灵AI 搬家后的新址与定价覆盖表键必须一致。
 *
 * 注意：概览 §9 对照表第一列会原文引用旧说法（「62 条 REST 路由」等），
 * 因此「不得出现」类断言只针对正文口径，不针对该对照表；对照表本身
 * 用「实际值」列断言。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  let dir = resolve(HERE, "..", "..", "..");
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(join(dir, "wiki.md")) && existsSync(join(dir, "docs", "CODEBASE_OVERVIEW.md"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("无法定位仓库根目录（未找到 wiki.md + docs/CODEBASE_OVERVIEW.md）");
}

const ROOT = repoRoot();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const WIKI = read("wiki.md");
const OVERVIEW = read("docs/CODEBASE_OVERVIEW.md");
const FILE_INDEX = read("docs/CODEBASE_FILE_INDEX.md");
const METRICS = JSON.parse(read("docs/metrics.json")) as { restRoutes: number; tables: number };

/** MCP_TOOL_DEFS 数组区内的工具条目（`name: "xxx"`，双引号，4 空格缩进）。 */
function mcpToolDefs(): Array<{ name: string; scope: string }> {
  const src = read("packages/core/src/mcp-schemas.ts");
  const start = src.indexOf("export const MCP_TOOL_DEFS");
  const end = src.indexOf("\n];", start);
  const body = src.slice(start, end);
  const entries = [...body.matchAll(/^\s+name: "([a-z0-9_]+)",\n(?:.*\n)*?\s+scope: "(\w+)",/gm)].map((m) => ({
    name: m[1],
    scope: m[2],
  }));
  return entries;
}

describe("B13-1 MCP 工具数：代码 41（28 read / 12 write / 1 admin）", () => {
  it("MCP_TOOL_DEFS 共 41 个工具", () => {
    expect(mcpToolDefs()).toHaveLength(41);
  });

  it("scope 分布 28 read / 12 write / 1 admin", () => {
    const defs = mcpToolDefs();
    const count = (scope: string) => defs.filter((d) => d.scope === scope).length;
    expect(count("read")).toBe(28);
    expect(count("write")).toBe(12);
    expect(count("admin")).toBe(1);
  });

  it("wiki 与概览称 41，不再称 15/17/35/32", () => {
    expect(WIKI).toContain("41 个 MCP 标准工具");
    expect(WIKI).toContain("41 个标准工具（28 read / 12 write / 1 admin）");
    expect(WIKI).not.toContain("15 个 MCP");
    expect(WIKI).not.toContain("17 个标准工具");
    expect(OVERVIEW).toContain("41 个工具");
    expect(OVERVIEW).toContain("28 个 read、12 个 write、1 个 admin");
    expect(OVERVIEW).not.toContain("35 个工具");
    expect(OVERVIEW).not.toContain("32 个 MCP 工具");
    expect(OVERVIEW).toContain("**41 个**（28 read / 12 write / 1 admin）");
  });

  it("概览 §5.5 域表列全 41 个工具名（含此前漏掉的 6 个）", () => {
    for (const name of [
      "get_collection",
      "list_favorites",
      "list_search_history",
      "get_profile_summary",
      "star_plugin",
      "update_plugin",
    ]) {
      expect(OVERVIEW).toContain(`\`${name}\``);
    }
    expect(OVERVIEW).toContain("| user-center |");
  });
});

describe("B13-2 前端版本：Next.js 16（package.json 16.4.2 / React 19.3.1）", () => {
  it("wiki 与 FILE_INDEX 不再称 Next.js 15", () => {
    expect(WIKI).toContain("Next.js 16");
    expect(WIKI).not.toContain("Next.js 15");
    expect(FILE_INDEX).toContain("Next.js 16");
    expect(FILE_INDEX).not.toContain("Next.js 15");
  });
});

describe("B13-3 REST 路由数：313 声明 / 49 插件 / 47 表", () => {
  it("metrics.json 与静态计数一致", () => {
    expect(METRICS.restRoutes).toBe(313);
    expect(METRICS.tables).toBe(47);
  });

  it("wiki 不再称 62 条路由", () => {
    expect(WIKI).toContain("313 个 REST 路由声明");
    expect(WIKI).not.toContain("62 条 REST");
    expect(WIKI).not.toContain("62 条路由");
  });

  it("概览 §5.4 表合计 313，§9 对照表实际值已更新", () => {
    expect(OVERVIEW).toContain("### 5.4 `apps/api`：313 个端点 / 49 个路由插件");
    expect(OVERVIEW).toContain("| **合计** | **313** |");
    expect(OVERVIEW).not.toContain("117 个端点");
    expect(OVERVIEW).toContain("**313 个端点**（49 个路由插件");
    expect(OVERVIEW).toContain("**49 个**（`server.ts` 的 register 调用）");
    expect(OVERVIEW).toContain("**47 张**");
    expect(OVERVIEW).not.toContain("25 张表");
  });

  it("FILE_INDEX 与 server.ts 头注释称 49 个路由插件、47 张表", () => {
    expect(FILE_INDEX).toContain("注册 49 个路由插件");
    expect(FILE_INDEX).toContain("共 47 张表");
    expect(FILE_INDEX).not.toContain("24 个路由插件");
    expect(FILE_INDEX).not.toContain("19 张核心表");
    expect(read("apps/api/src/server.ts")).toContain("49 个路由插件");
  });
});

describe("B13-4 扩展 README：在线检索，不承诺离线向量", () => {
  it("两扩展 README 无离线向量/本地 BGE 承诺", () => {
    expect(read("extensions/chrome-extension/README.md")).not.toContain("离线向量");
    expect(read("extensions/raycast-extension/README.md")).not.toContain("离线向量");
    expect(read("extensions/raycast-extension/README.md")).not.toContain("本地 BGE");
    expect(read("extensions/chrome-extension/README.md")).toContain("在线混合检索");
    expect(read("extensions/raycast-extension/README.md")).toContain("在线语义搜索");
  });
});

describe("B13-5 网址包：34 个（18~21 分类 / 190~223 站点）", () => {
  it("seed 注释称 34，不再称 20", () => {
    const seedIndex = read("apps/api/src/seed-data/index.ts");
    expect(seedIndex).toContain("34 个专业网址包");
    expect(seedIndex).toContain("×34");
    expect(seedIndex).not.toContain("20 个专业网址包");
    expect(seedIndex).not.toContain("×20");
  });
});

describe("搬家漏网：可灵AI 新址与定价覆盖表键一致", () => {
  it("双份 navigation.json 均为新址，无旧址残留", () => {
    for (const rel of [
      "apps/web-overlay/src/navsphere/content/navigation.json",
      "apps/web/src/navsphere/content/navigation.json",
    ]) {
      const nav = JSON.parse(read(rel)) as unknown;
      const text = JSON.stringify(nav);
      expect(text).toContain("https://www.klingai.com/app/");
      expect(text).not.toContain("klingai.kuaishou.com");
    }
  });

  it("pricing-overrides 键为 klingai.com/app（去 www 的 host + path）", () => {
    const overrides = JSON.parse(read("packages/core/src/pricing-overrides.json")) as Record<
      string,
      { pricing: string }
    >;
    expect(overrides["klingai.com/app"]?.pricing).toBe("freemium");
    expect(overrides["klingai.kuaishou.com"]).toBeUndefined();
  });
});

describe("B13-余 §9 两行核对（第 16 轮）：洛伦兹双模型 + 镜像机制", () => {
  it("hyperbolic.ts 双模型并存：庞加莱与洛伦兹函数均导出", () => {
    const src = read("packages/core/src/hyperbolic.ts");
    for (const fn of [
      "poincareDistance",
      "mobiusAdd",
      "expMap0",
      "lorentzInnerProduct",
      "lorentzDistance",
      "poincareToLorentz",
      "lorentzToPoincare",
    ]) {
      expect(src).toContain(`export function ${fn}`);
    }
  });

  it("线上排序 rank.ts 实际调用洛伦兹距离并回 manifold lorentz-hyperboloid", () => {
    const rank = read("apps/api/src/routes/rank.ts");
    expect(rank).toContain("lorentzDistance(");
    expect(rank).toContain("poincareToLorentz(");
    expect(rank).toContain('manifold: "lorentz-hyperboloid"');
    expect(read("apps/api/src/server.ts")).toContain("rankRoutes");
  });

  it("概览 §9 洛伦兹行不再称仅庞加莱实现，同步行不再称 272 个", () => {
    expect(OVERVIEW).not.toContain("272 个");
    expect(OVERVIEW).toContain("lorentzDistance");
    expect(OVERVIEW).toContain("1153 个覆盖层文件");
  });

  it("wiki 不再称 web 与 web-overlay 100% 同步", () => {
    expect(WIKI).not.toContain("100% 同步");
  });
});
