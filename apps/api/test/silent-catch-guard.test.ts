/**
 * api 侧静默 catch 守卫（升级第 13 条）。
 *
 * 背景：web 侧的 `apps/web-overlay/test/silent-catch.test.ts` 只扫前端，
 * api 侧 86 处 `.catch(() => undefined/null/false/0)` 与空 `catch {}` 长期
 * 无人看管——定时任务（每日简报、热榜刷新、健康检查、数据保留）失败会静默
 * 丢失，用户收不到简报或热榜停更时无因可查。2026-11-15 逐处处理后全部
 * 有交代，本守卫锁住范围：以后 api 再出现没写理由的空 catch 即红灯。
 *
 * 规则与 web 侧相同（扫描器逐字复用）：
 *   `catch {}` / `catch (e) {}` / `.catch(() => {})` 这类块里一句话都没有
 *   的 catch，块内必须有一条注释说明为什么这么吞是安全的；
 *   块里有语句（哪怕只是 `console.warn`）就算「有处理」，不在此列；
 *   `.catch(() => undefined|null|void 0|false|0)` 是表达式形态的空操作，
 *   结构上根本没地方写理由，必须改成带理由的块；
 *   有回退值、且该回退值会被调用方消费的写法（如 `.catch(() => ({}))`）
 *   不算「吞掉失败」：失败被转换成一个调用方要处理的值。
 *
 * 允许的「吞掉失败」分四类（登记在下面的 ALLOW_LIST，注释原文写在
 * catch 块里，改 wording 要同步改这里——守卫会查登记是否还在）：
 *   - 审计/遥测写库（recordEvent / audit / bumpVisit / touchApiToken）：
 *     不阻断主操作，写失败即丢弃（与 enrich.ts 的 recordEvent 容错语义一致）。
 *   - 尽力而为的附带操作（unlink 临时文件、向量清理、标签同步、向量回填、
 *     预热、过期清理）：失败不影响主流程，下次运行会再试或由整包导入补齐。
 *   - 可选读取（stat / getSite / getUserSettings / getSystemState /
 *     countVideoItems）：读不到按缺省值处理，调用方已处理空值。
 *   - 失败已在主链路处理（任务执行体、热榜 inflight 清理）：这里只防
 *     第二个未处理 rejection，不再记第二遍日志。
 *
 * 真失败要进日志的站点（不许只写注释了事），走 api 现有日志口径
 * `console.warn` + `[navhub-...]` 标签，日志在部署后的 stdout 里查：
 *   - 每日简报热榜刷新失败 `[navhub-job]`（用现有缓存组版，源状态标在页面上）
 *   - 简报开场白 AI 调用失败 `[navhub-brief]`（走兜底开场白）
 *   - 排期检查 / 过期任务回收失败 `[navhub-job]`（下一周期重试）
 *   - 任务心跳失败 `[navhub-job]`（锁可能已过期）
 * 排查说明另见 `docs/SILENT-CATCH-API-2026-11-15.md`。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function apiRoot(): string {
  const candidates = [resolve(HERE, "..")];
  const hit = candidates.find((p) => existsSync(join(p, "src", "server.ts")));
  if (!hit) throw new Error("无法定位 apps/api 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = apiRoot();

/** 把注释与字符串/模板串的内容挖成空格：长度与换行保持，便于用下标回读原文 */
function maskSource(src: string): string {
  const out = src.split("");
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** 从 `{` 找配对的 `}` */
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface SilentCatch {
  /** 原始源码里的下标（catch 关键字） */
  index: number;
  body: string;
  hasStatement: boolean;
  hasComment: boolean;
  /** 表达式形态的空操作（`.catch(() => undefined)`）：结构上根本没地方写理由 */
  exprNoop: boolean;
}

/** 表达式形态的空操作：没有块，理由无处可写，必须改成带理由的块 */
const EXPR_NOOP = /\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:undefined|null|void\s+0|false|0)\s*\)/g;

export function findSilentCatches(src: string): SilentCatch[] {
  const masked = maskSource(src);
  const found: SilentCatch[] = [];
  const seen = new Set<number>();
  const patterns = [
    /catch\s*(?:\([^)]*\))?\s*\{/g,
    /\.catch\s*\(\s*(?:\(\s*[^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,
    /\.catch\s*\(\s*function\s*[^(]*\([^)]*\)\s*\{/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const braceIdx = masked.indexOf("{", m.index + m[0].length - 1);
      if (braceIdx === -1) continue;
      if (seen.has(braceIdx)) continue;
      const end = matchBrace(masked, braceIdx);
      if (end === -1) continue;
      seen.add(braceIdx);
      const maskedBody = masked.slice(braceIdx + 1, end);
      const body = src.slice(braceIdx + 1, end);
      found.push({
        index: m.index,
        body,
        hasStatement: maskedBody.replace(/[{}\s;]/g, "").length > 0,
        hasComment: /\/\/|\/\*/.test(body),
        exprNoop: false,
      });
    }
  }
  EXPR_NOOP.lastIndex = 0;
  let em: RegExpExecArray | null;
  while ((em = EXPR_NOOP.exec(masked))) {
    found.push({
      index: em.index,
      body: em[0],
      hasStatement: false,
      hasComment: false,
      exprNoop: true,
    });
  }
  return found;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split(/\r?\n/).length;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

/**
 * 登记在册的「可以吞」的空 catch：每项是一对（文件，块内理由原文）。
 * 守卫查两件事：① 该文件里仍然找得到这句理由（站点被删/改写法要同步改这里）；
 * ② 全仓 0 处没写理由的空 catch（见下面的「0 处」断言）。
 * 新增一处“可以吞”时，先在代码块里写清理由，再把（文件，理由原文）登记进来；
 * 只写注释不登记，或只登记不写注释，都算没过。
 */
export const AUDIT_REASON = "审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。";
export const BEST_EFFORT_REASON = "尽力而为的附带操作：失败不影响主流程。";
export const LOOKUP_REASON = "可选读取：读不到按缺省值处理，调用方已处理空值。";
export const DEDUP_REASON = "失败已在主链路处理：这里只防第二个未处理 rejection。";

export interface AllowListEntry {
  file: string;
  reason: string;
}

export const ALLOW_LIST: AllowListEntry[] = [
  { file: "alerts.ts", reason: BEST_EFFORT_REASON },
  { file: "fs-file-store.ts", reason: BEST_EFFORT_REASON },
  { file: "hotlist/refresh.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/daily-brief.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/data-retention.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/drama-calendar.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/drama-check.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/health-check.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/hotlist-refresh.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/metadata-refetch.task.ts", reason: AUDIT_REASON },
  { file: "jobs/tasks/rank-recompute.task.ts", reason: AUDIT_REASON },
  { file: "jobs.ts", reason: AUDIT_REASON },
  { file: "jobs.ts", reason: BEST_EFFORT_REASON },
  { file: "jobs.ts", reason: LOOKUP_REASON },
  { file: "jobs.ts", reason: DEDUP_REASON },
  { file: "plugins-search.ts", reason: BEST_EFFORT_REASON },
  { file: "routes/account.ts", reason: AUDIT_REASON },
  { file: "routes/ai-config.ts", reason: AUDIT_REASON },
  { file: "routes/assets.ts", reason: "显式降级（非静默）：目录创建失败只影响磁盘缓存，可忽略：内存缓存与远端抓取仍可用" },
  { file: "routes/assets.ts", reason: "显式降级（非静默）：缓存落盘失败可忽略：图标可重新抓取，不该因此让请求失败" },
  { file: "routes/backup.ts", reason: BEST_EFFORT_REASON },
  { file: "routes/backup.ts", reason: AUDIT_REASON },
  { file: "routes/copilot.ts", reason: LOOKUP_REASON },
  { file: "routes/copilot.ts", reason: AUDIT_REASON },
  { file: "routes/drama-calendar.ts", reason: LOOKUP_REASON },
  { file: "routes/enrich.ts", reason: AUDIT_REASON },
  { file: "routes/errors.ts", reason: AUDIT_REASON },
  { file: "routes/favorites.ts", reason: AUDIT_REASON },
  { file: "routes/hotlist.ts", reason: LOOKUP_REASON },
  { file: "routes/hotlist.ts", reason: DEDUP_REASON },
  { file: "routes/link-health.ts", reason: LOOKUP_REASON },
  { file: "routes/link-health.ts", reason: AUDIT_REASON },
  { file: "routes/me.ts", reason: AUDIT_REASON },
  { file: "routes/me.ts", reason: BEST_EFFORT_REASON },
  { file: "routes/navsphere.ts", reason: AUDIT_REASON },
  { file: "routes/plugin-audit.ts", reason: "显式降级（非静默）：LLM 可能返回非 JSON 文本：按「无 overview」处理，不是错误" },
  { file: "routes/submissions.ts", reason: AUDIT_REASON },
  { file: "routes/telemetry.ts", reason: LOOKUP_REASON },
  { file: "routes/telemetry.ts", reason: AUDIT_REASON },
  { file: "routes/trash.ts", reason: BEST_EFFORT_REASON },
  { file: "routes/videos.ts", reason: LOOKUP_REASON },
  { file: "routes/workspaces.ts", reason: "显式降级（非静默）：存量 payload 非法 JSON：按空成员表处理（后续写入会覆盖）" },
  { file: "server.ts", reason: AUDIT_REASON },
  { file: "server.ts", reason: BEST_EFFORT_REASON },
  { file: "storage.ts", reason: BEST_EFFORT_REASON },
  { file: "storage.ts", reason: LOOKUP_REASON },
];

describe("扫描器本身是对的（否则守卫只是空跑）", () => {
  it("抓得住：块里一句话都没有的 catch", () => {
    const bad = ["try {", "  risky()", "} catch {", "}"].join("\n");
    const hits = findSilentCatches(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hasStatement).toBe(false);
    expect(hits[0]!.hasComment).toBe(false);
  });

  it("抓得住：.catch(() => {}) 与 .catch(function () {})", () => {
    expect(findSilentCatches("fetch('/a').catch(() => {})")).toHaveLength(1);
    expect(findSilentCatches("fetch('/a').catch(function () {})")).toHaveLength(1);
    expect(findSilentCatches("fetch('/a').catch(function (err) {})")).toHaveLength(1);
  });

  it("不误报：块里写了理由", () => {
    const good = ["try {", "  risky()", "} catch {", "  // 只是尽力清理，失败无影响", "}"].join("\n");
    const hits = findSilentCatches(good);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hasComment).toBe(true);
  });

  it("不误报：块里有语句（哪怕只打一条日志）", () => {
    const handled = ["try {", "  risky()", "} catch (err) {", "  console.warn('failed', err)", "}"].join("\n");
    const hits = findSilentCatches(handled);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hasStatement).toBe(true);
  });

  it("不误报：注释里的 catch 例子（文档/说明）", () => {
    const doc = [
      "/**",
      " * 真实缺陷长这样：",
      " *   try { parse() } catch {}",
      " */",
      "export const a = 1",
    ].join("\n");
    expect(findSilentCatches(doc)).toHaveLength(0);
  });

  it("不误报：字符串里的 catch（内联脚本那类）", () => {
    const script = "const html = `try { x() } catch {}`";
    expect(findSilentCatches(script)).toHaveLength(0);
  });

  it("不误报：把失败转成回退值交给调用方消费", () => {
    expect(findSilentCatches("const body = await res.json().catch(() => ({}))")).toHaveLength(0);
  });

  it("抓得住：表达式形态的空操作（没地方写理由）", () => {
    const hits = findSilentCatches("void send('/api/events').catch(() => undefined)");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.exprNoop).toBe(true);
  });
});

describe("api 侧吞掉失败的 catch 都要有交代", () => {
  const files = sourceFiles(join(ROOT, "src"));

  it("确实扫到了源码（不是扫了空目录）", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("这条规则确实被用上了（写理由的地方至少几十处）", () => {
    let withReason = 0;
    for (const f of files) {
      for (const c of findSilentCatches(readFileSync(f, "utf8"))) {
        if (!c.hasStatement && c.hasComment) withReason++;
      }
    }
    // 2026-11-15 实测：已登记的空 catch 约 80 处 + 此前已有的约 47 处
    expect(withReason).toBeGreaterThanOrEqual(50);
  });

  it("allow-list 登记的站点还在（删站或改写法要同步改登记）", () => {
    const missing: string[] = [];
    for (const entry of ALLOW_LIST) {
      const full = join(ROOT, "src", entry.file);
      if (!existsSync(full)) {
        missing.push(`${entry.file}（文件已不存在）`);
        continue;
      }
      const src = readFileSync(full, "utf8");
      if (!src.includes(entry.reason)) {
        missing.push(`${entry.file}（找不到登记的理由原文：${entry.reason}）`);
      }
    }
    expect(missing, "allow-list 登记与源码对不上：\n" + missing.join("\n")).toHaveLength(0);
  });

  it("0 处「吞掉失败却没写理由」", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const c of findSilentCatches(src)) {
        if (c.exprNoop) {
          problems.push(
            `${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, c.index)}  ${c.body}  ← 表达式空操作写不下理由，请改成 .catch(() => { /* 为什么可以吞 */ })`
          );
          continue;
        }
        if (c.hasStatement || c.hasComment) continue;
        problems.push(
          `${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, c.index)}  ${c.body.replace(/\s+/g, " ").trim() || "{ }"}`
        );
      }
    }
    expect(
      problems,
      "这些 catch 把失败吞掉了，却没写为什么可以吞：\n" + problems.join("\n")
    ).toHaveLength(0);
  });
});
