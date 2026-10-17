/**
 * 路由标题：**站点名只有一个来源（根 layout 的 title.template）**。
 *
 * 仓库自己在 app/submit/page.tsx 里就写明了这条约定：
 *   「子页面标题里**不要**再拼站点名，否则会出现 "X - NavHub 导航 - NavHub 导航"」
 * 但实际有 4 个页面（graph / algorithms / custom / import）和后台
 * （app/admin/layout.tsx 写的是 'NavSphere Admin'）违反了它：
 *
 *   title: '技术生态与平替拓扑图谱 - NavHub'   → 渲染成 "… - NavHub - NavHub"
 *   title: 'NavSphere Admin'                   → 渲染成 "NavSphere Admin - NavHub"（两个品牌）
 *
 * 另外 12 个公开路由根本没有自己的标题，浏览器标签、历史记录、书签里全都只显示站点名，
 * 读屏软件在路由切换时也会念出同一个标题。这里守住：
 *
 *   1. 根 layout 之外的任何 metadata 都不许再出现品牌名（NavHub / NavSphere）；
 *   2. 每个路由都要有自己的标题与描述，标题互不重复；
 *   3. 确实继承父级标题的路由必须在 TITLE_INHERITED 里写明理由 ——
 *      并且要能证明它**确实**继承到了那一层（而不是退化成「什么都没有」）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
const ROOT_LAYOUT = "layout.tsx";

/** 读取 src/app 下的文件；相对路径统一用 '/'，如 "admin/audit/page.tsx" */
function appFile(rel: string): string | null {
  const full = join(ROOT, "src", "app", ...rel.split("/"));
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

/** src/app 下的全部 ts/tsx 文件（相对 app/，'/' 分隔） */
function listAppFiles(dirRel = "", out: string[] = []): string[] {
  const full = join(ROOT, "src", "app", ...(dirRel ? dirRel.split("/") : []));
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const child = dirRel ? `${dirRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listAppFiles(child, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(child);
  }
  return out;
}

/** 所有含 page.tsx 的路由目录（'' 表示首页） */
function routeDirs(): string[] {
  const out: string[] = [];
  const walk = (dirRel: string) => {
    const full = join(ROOT, "src", "app", ...(dirRel ? dirRel.split("/") : []));
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (appFile(`${child}/page.tsx`)) out.push(child);
      walk(child);
    }
  };
  walk("");
  if (appFile("page.tsx")) out.unshift("");
  return out;
}

/** 取出 metadata 对象文本：支持 `export const metadata = {...}` 与 `generateMetadata() { return {...} }` */
function metadataText(src: string): string | null {
  const constDecl = /export\s+const\s+metadata\b/.exec(src);
  const fnDecl = /export\s+(?:async\s+)?function\s+generateMetadata\b/.exec(src);
  let start = -1;
  if (fnDecl && (!constDecl || fnDecl.index < constDecl.index)) {
    const ret = src.indexOf("return", fnDecl.index);
    if (ret === -1) return null;
    start = src.indexOf("{", ret);
  } else if (constDecl) {
    start = src.indexOf("{", constDecl.index);
  } else {
    return null;
  }
  if (start === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** 取 metadata 里某个字段的字面量值；`title: { default: 'x' }` 这种嵌套模板取 default */
function literalField(obj: string, field: "title" | "description"): string | null {
  const key = new RegExp(`(^|[\\s,{])${field}\\s*[:,]\\s*`, "m");
  const hit = key.exec(obj);
  if (!hit) return null;
  const rest = obj.slice(hit.index + hit[0].length);
  if (rest.startsWith("{")) {
    const nested = /(^|[\s,{])default\s*:\s*(['"])([\s\S]*?)\2/.exec(rest);
    return nested ? nested[3] : null;
  }
  const str = /^(['"])([\s\S]*?)\1/.exec(rest);
  return str ? str[2] : null;
}

interface TitleSource {
  route: string;
  file: string;
  obj: string;
  /** 字面量标题；写成表达式（如 siteData.basic.title）时为 null */
  title: string | null;
  /** 标题来自运行时数据（站点配置），不是写死的字面量 */
  runtime: boolean;
  description: string | null;
  /** 描述同样可能来自运行时数据（首页就是） */
  descriptionRuntime: boolean;
}

/** 字段被赋值成表达式（而非字面量）：用来区分「运行时取值」与「根本没写」 */
function hasRuntimeField(obj: string, field: "title" | "description"): boolean {
  const re = new RegExp(`(^|[\\s,{])${field}\\s*:\\s*(?!['"{])`, "m");
  return re.test(obj);
}

/** 每个路由的「标题来源」：自己的 page.tsx 或同目录 layout.tsx（首页的 page.tsx 就是它自己） */
function titleSources(): TitleSource[] {
  const out: TitleSource[] = [];
  for (const dir of routeDirs()) {
    const files = dir === "" ? ["page.tsx", "layout.tsx"] : [`${dir}/page.tsx`, `${dir}/layout.tsx`];
    for (const file of files) {
      const src = appFile(file);
      if (!src) continue;
      const obj = metadataText(src);
      if (!obj) continue;
      out.push({
        route: dir,
        file,
        obj,
        title: literalField(obj, "title"),
        runtime: hasRuntimeField(obj, "title"),
        description: literalField(obj, "description"),
        descriptionRuntime: hasRuntimeField(obj, "description"),
      });
      break; // 同目录下 page 与 layout 只会有一个负责标题
    }
  }
  return out;
}

/**
 * 确实「继承父级标题」的路由：每条都必须给出理由，并且要能证明继承到的是**哪一层**。
 * `evidence` 指向那层 layout —— 白名单不许退化成「其实什么都继承不到」。
 */
const TITLE_INHERITED: Array<{ match: (route: string) => boolean; evidence: RegExp; reason: string }> = [
  {
    match: (route) => route.startsWith("admin/"),
    evidence: /^admin\/layout\.tsx$/,
    reason:
      "继承 app/admin/layout.tsx 的嵌套标题模板（%s · 管理后台）：后台十几个子路由共用「管理后台」前缀，不值得为每个路由再建一个只放 metadata 的 layout",
  },
];

/** 从父目录一路向上找到第一个声明了 metadata 的 layout（最后回落到根 layout） */
function inheritedLayoutFor(route: string): string | null {
  const parts = route ? route.split("/") : [];
  for (let i = parts.length; i > 0; i--) {
    const candidate = `${parts.slice(0, i).join("/")}/layout.tsx`;
    const src = appFile(candidate);
    if (src && metadataText(src)) return candidate;
  }
  const rootSrc = appFile(ROOT_LAYOUT);
  return rootSrc && metadataText(rootSrc) ? ROOT_LAYOUT : null;
}

describe("元数据写法本身不能互相冲突", () => {
  it("同一个文件不能同时导出 metadata 与 generateMetadata（Next 会直接构建失败）", () => {
    const offenders = listAppFiles().filter((rel) => {
      const src = appFile(rel) ?? "";
      return (
        /export\s+const\s+metadata\b/.test(src) &&
        /export\s+(?:async\s+)?function\s+generateMetadata\b/.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("扫描确实覆盖了整个 app 目录（否则上一条形同虚设）", () => {
    expect(listAppFiles().length).toBeGreaterThan(30);
  });
});

describe("标题里不许再出现品牌名（根 layout 是唯一来源）", () => {
  const sources = titleSources();
  const literals = sources.filter((s) => s.title !== null);

  it("先确认扫描确实看到了足够多的标题来源（否则空数组会假装通过）", () => {
    expect(sources.length).toBeGreaterThan(12);
    expect(literals.length).toBeGreaterThan(10);
    expect(sources.every((s) => s.title !== null || s.runtime)).toBe(true);
  });

  it("根 layout 用模板追加站点名，且站点名是运行时读到的 siteName", () => {
    const root = metadataText(appFile(ROOT_LAYOUT)!)!;
    expect(root).toContain("template:");
    expect(root).toContain("siteName");
  });

  it("首页标题来自站点配置（运行时），而不是写死的字面量", () => {
    const home = sources.find((s) => s.route === "");
    expect(home?.file).toBe("page.tsx");
    expect(home?.runtime).toBe(true);
    expect(home?.title).toBeNull();
    expect(appFile("page.tsx")!).toContain("siteData.basic.title");
  });

  it("除根 layout 外，任何字面量 title / description 都不含 NavHub 或 NavSphere", () => {
    const offenders = literals
      .flatMap((s) => [
        { file: s.file, field: "title", value: s.title },
        { file: s.file, field: "description", value: s.description },
      ])
      .filter((x) => typeof x.value === "string" && /NavHub|NavSphere/i.test(x.value))
      .map((x) => `${x.file} :: ${x.field} = ${x.value}`);
    expect(offenders).toEqual([]);
  });
});

describe("每个路由都有自己的标题", () => {
  const sources = titleSources();
  const literals = sources.filter((s) => s.title !== null);

  it("每个路由都有标题来源与描述", () => {
    const missing = sources
      .filter(
        (s) =>
          (s.title === null && !s.runtime) || (s.description === null && !s.descriptionRuntime),
      )
      .map(
        (s) =>
          `${s.file} (title=${JSON.stringify(s.title)}, runtime=${s.runtime}, description=${JSON.stringify(s.description)}, descriptionRuntime=${s.descriptionRuntime})`,
      );
    expect(missing).toEqual([]);
  });

  it("字面量标题非空且互不重复（运行时标题由站点数据决定，不参与比对）", () => {
    expect(literals.length).toBeGreaterThan(10);
    const empty = literals.filter((s) => !s.title!.trim()).map((s) => s.file);
    expect(empty).toEqual([]);

    const byTitle = new Map<string, string[]>();
    for (const s of literals) {
      const list = byTitle.get(s.title!) ?? [];
      list.push(s.file);
      byTitle.set(s.title!, list);
    }
    const dupes = [...byTitle.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([title, files]) => `${title} :: ${files.join(", ")}`);
    expect(dupes).toEqual([]);
  });

  it("路由要么有自己的标题，要么在 TITLE_INHERITED 里写明理由并证明继承到了那一层", () => {
    const undeclared: string[] = [];
    const own = new Set(sources.map((s) => s.route));
    for (const route of routeDirs()) {
      if (own.has(route)) continue;
      const rule = TITLE_INHERITED.find((r) => r.match(route));
      if (!rule) {
        undeclared.push(route === "" ? "/(首页)" : `/${route}`);
        continue;
      }
      expect(rule.reason.trim().length, `${route} 的继承理由太短`).toBeGreaterThan(8);
      const inherited = inheritedLayoutFor(route);
      expect(inherited, `${route} 声明继承父级标题，但一路上没有任何 layout 提供 metadata`).not.toBeNull();
      expect(rule.evidence.test(inherited!), `${route} 应继承 ${rule.evidence}，实际继承自 ${inherited}`).toBe(true);
    }
    expect(undeclared).toEqual([]);
  });

  it("没有路由退化成「只能拿到站点名」：除首页外都必须有自己的标题", () => {
    const own = new Set(sources.map((s) => s.route));
    const noOwnTitle = routeDirs()
      .filter((route) => route !== "")
      .filter((route) => !own.has(route))
      .filter((route) => !route.startsWith("admin/"));
    expect(noOwnTitle).toEqual([]);
  });
});
