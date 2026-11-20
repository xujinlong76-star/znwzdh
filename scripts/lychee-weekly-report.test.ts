/**
 * lychee 每周周报脚本的回归测试（fixture 驱动，不调 GitHub API、不发网络请求）。
 *
 * 守六件事（方案 03 §6.2）：
 *   1. 只取失败条目：lychee 报 200 的不进 issue；
 *   2. 按注册域名分组，每域名一个 issue，标题格式 `<域名>（<n> 条）· <周次>`；
 *   3. 正文只列死链（URL、状态码、首次发现周次、Wayback 建议链接）；
 *   4. 同一域名已开 issue 未关闭时不重复开，只追加评论，且已列过的 URL
 *      不重复出现、首次发现周次沿用旧值；
 *   5. sentinel 二次校验：复核为 ok 的丢弃、疑似反爬（401/403/429）进
 *      “疑似反爬”分组不进死链 issue、无复核结论的进待复核不进 issue；
 *   6. lychee 退出码 1/3 时不开 issue、报维护者。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("scripts/lychee-weekly-report.mjs");

const FIXTURE_OUT_MAP = {
  "https://example.com/gone": { status: { code: 404, text: "Not Found" } },
  "https://example.com/also-gone": { status: { code: 500, text: "Internal Server Error" } },
  "https://www.example.com/alive": { status: { code: 200, text: "OK" } },
  "https://sub.blog.example.co.uk/dead": { status: { code: 410, text: "Gone" } },
  "https://blocked.example.org/": { status: { code: 403, text: "Forbidden" } },
};

const FIXTURE_OUT_ARRAY = [
  { url: "https://example.com/gone", status: { code: 404 } },
  { url: "https://example.com/ok", status: "ok" },
  { url: "https://example.com/timeout", status: "timeout" },
];

const FIXTURE_SENTINEL = {
  "https://example.com/gone": { httpStatus: 404, auditStatus: null },
  "https://example.com/also-gone": { httpStatus: 500, auditStatus: null },
  "https://sub.blog.example.co.uk/dead": { httpStatus: 410, auditStatus: null },
  "https://blocked.example.org/": { httpStatus: 403, auditStatus: null },
};

async function load() {
  return import("./lychee-weekly-report.mjs");
}

function runCli(root: string, args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  let last = { code: -1, out: "" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    last = { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    if (last.code === 0 || !last.out.includes("EPERM")) return last;
  }
  return last;
}

function writeJson(root: string, name: string, value: unknown): string {
  const p = join(root, name);
  writeFileSync(p, JSON.stringify(value), "utf8");
  return p;
}

describe("lychee-weekly-report：解析与失败过滤", () => {
  it("对象映射与数组两种形态都能解析；200 的条目不过滤进失败", async () => {
    const mod = await load();
    const fromMap = mod.failedEntries(mod.parseLycheeOutput(FIXTURE_OUT_MAP));
    expect(fromMap.map((e: any) => e.url).sort()).toEqual([
      "https://blocked.example.org/",
      "https://example.com/also-gone",
      "https://example.com/gone",
      "https://sub.blog.example.co.uk/dead",
    ]);
    const fromArray = mod.failedEntries(mod.parseLycheeOutput(FIXTURE_OUT_ARRAY));
    expect(fromArray.map((e: any) => e.url).sort()).toEqual([
      "https://example.com/gone",
      "https://example.com/timeout",
    ]);
    // timeout 无状态码：statusCode 为 null，仍算失败（不在 200 之列）
    expect(fromArray.find((e: any) => e.url === "https://example.com/timeout").statusCode).toBeNull();
  });

  it("注册域名：去 www、二级后缀取三段、IP 原样", async () => {
    const mod = await load();
    expect(mod.registrableDomain("https://www.example.com/x")).toBe("example.com");
    expect(mod.registrableDomain("https://sub.blog.example.co.uk/dead")).toBe("example.co.uk");
    expect(mod.registrableDomain("https://a.b.example.com.cn/x")).toBe("example.com.cn");
    expect(mod.registrableDomain("http://192.168.1.1/x")).toBe("192.168.1.1");
  });

  it("ISO 周次：2026-11-16（周一）是 2026-W47", async () => {
    const mod = await load();
    expect(mod.isoWeek(new Date("2026-11-16T03:00:00Z"))).toBe("2026-W47");
    expect(mod.isoWeek(new Date("2026-11-15T03:00:00Z"))).toBe("2026-W46");
  });
});

describe("lychee-weekly-report：sentinel 二次校验与分组", () => {
  it("死链 / 疑似反爬 / 待复核三组分流；复核 ok 的丢弃", async () => {
    const mod = await load();
    const failures = mod.failedEntries(mod.parseLycheeOutput(FIXTURE_OUT_MAP));
    const sentinel = new Map(
      Object.entries(FIXTURE_SENTINEL).map(([url, v]: [string, any]) => [
        url,
        v.httpStatus === 403
          ? { verdict: "bot-block", httpStatus: 403, auditStatus: null }
          : { verdict: "dead", httpStatus: v.httpStatus, auditStatus: null },
      ]),
    );
    const { dead, botBlock, pending } = mod.classifyEntries(failures, sentinel);
    expect(dead.map((e: any) => e.url).sort()).toEqual([
      "https://example.com/also-gone",
      "https://example.com/gone",
      "https://sub.blog.example.co.uk/dead",
    ]);
    expect(botBlock.map((e: any) => e.url)).toEqual(["https://blocked.example.org/"]);
    expect(pending).toEqual([]);

    // 无 sentinel 输入：全部待复核，不进 issue
    const noSentinel = mod.classifyEntries(failures, null);
    expect(noSentinel.dead).toEqual([]);
    expect(noSentinel.botBlock).toEqual([]);
    expect(noSentinel.pending).toHaveLength(4);

    // 复核为 ok 的丢弃
    const withOk = new Map(sentinel);
    withOk.set("https://example.com/gone", { verdict: "ok", httpStatus: 200, auditStatus: "HEALTHY" });
    const r2 = mod.classifyEntries(failures, withOk);
    expect(r2.dead.map((e: any) => e.url)).not.toContain("https://example.com/gone");
  });

  it("按域名分组：example.com 两条合一个 issue，co.uk 另起一个", async () => {
    const mod = await load();
    const failures = mod.failedEntries(mod.parseLycheeOutput(FIXTURE_OUT_MAP));
    const { dead } = mod.classifyEntries(
      failures,
      new Map(
        Object.entries(FIXTURE_SENTINEL).map(([url, v]: [string, any]) => [
          url,
          { verdict: v.httpStatus === 403 ? "bot-block" : "dead", httpStatus: v.httpStatus, auditStatus: null },
        ]),
      ),
    );
    const groups = mod.groupByDomain(dead);
    expect(groups.map((g: any) => [g.domain, g.items.length])).toEqual([
      ["example.com", 2],
      ["example.co.uk", 1],
    ]);
  });
});

describe("lychee-weekly-report：issue 标题 / 正文 / 去重", () => {
  it("标题格式与正文：只列死链，含状态码、首次发现周次、Wayback 建议链接", async () => {
    const mod = await load();
    expect(mod.buildIssueTitle("example.com", "dead", 2, "2026-W47")).toBe("example.com（2 条）· 2026-W47");
    expect(mod.buildIssueTitle("example.org", "bot-block", 1, "2026-W47")).toBe(
      "example.org（疑似反爬 1 条）· 2026-W47",
    );
    const body = mod.buildIssueBody(
      "example.com",
      "dead",
      [
        { url: "https://example.com/gone", statusCode: 404, statusText: "Not Found", suggestion: null },
        { url: "https://example.com/also-gone", statusCode: 500, statusText: "Error", suggestion: null },
      ],
      "2026-W47",
    );
    expect(body).toContain("| https://example.com/gone | 404 | 2026-W47 |");
    expect(body).toContain("https://web.archive.org/web/*/https://example.com/gone");
    expect(body).toContain("| https://example.com/also-gone | 500 | 2026-W47 |");
    // 200 的站不在正文里（调用方只传失败条目；此处断言正文不含 alive）
    expect(body).not.toContain("alive");
  });

  it("已开 issue 未关闭：不重复开，只追加评论；已列 URL 不重复、周次沿用旧值", async () => {
    const mod = await load();
    const existingBody = [
      "## 死链（1 条）· 2026-W46",
      "",
      "| URL | 状态码 | 首次发现 | 存档建议 |",
      "|---|---|---|---|",
      "| https://example.com/gone | 404 | 2026-W46 | [Wayback 快照](https://web.archive.org/web/*/https://example.com/gone) |",
    ].join("\n");
    const actions = mod.planActions({
      dead: [
        { url: "https://example.com/gone", statusCode: 404, statusText: "Not Found", suggestion: null },
        { url: "https://example.com/also-gone", statusCode: 500, statusText: "Error", suggestion: null },
      ],
      botBlock: [],
      week: "2026-W47",
      existingIssues: [{ number: 7, title: "example.com（1 条）· 2026-W46", body: existingBody }],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("comment");
    expect(actions[0].existingIssueNumber).toBe(7);
    expect(actions[0].newEntries.map((e: any) => e.url)).toEqual(["https://example.com/also-gone"]);
    expect(actions[0].body).toContain("https://example.com/also-gone");
    expect(actions[0].body).not.toContain("https://example.com/gone");
  });

  it("同域名全部已列过：无动作（不发空评论）", async () => {
    const mod = await load();
    const existingBody = "| https://example.com/gone | 404 | 2026-W46 | [x](https://web.archive.org/web/*/https://example.com/gone) |";
    const actions = mod.planActions({
      dead: [{ url: "https://example.com/gone", statusCode: 404, statusText: "Not Found", suggestion: null }],
      botBlock: [],
      week: "2026-W47",
      existingIssues: [{ number: 7, title: "example.com（1 条）· 2026-W46", body: existingBody }],
    });
    expect(actions).toEqual([]);
  });

  it("R2-① 跨 kind 不串扰：同域名已开疑似反爬 issue 时，死链仍新建死链 issue", async () => {
    const mod = await load();
    const actions = mod.planActions({
      dead: [{ url: "https://example.org/gone", statusCode: 404, statusText: "Not Found", suggestion: null }],
      botBlock: [],
      week: "2026-W47",
      existingIssues: [{ number: 9, title: "example.org（疑似反爬 1 条）· 2026-W46", body: "" }],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("create");
    expect(actions[0].kind).toBe("dead");
    expect(actions[0].title).toBe("example.org（1 条）· 2026-W47");
    expect(actions[0].existingIssueNumber).toBeNull();
  });

  it("R2-② 跨 kind 不串扰：同域名已开死链 issue 时，疑似反爬仍新建自己的 issue", async () => {
    const mod = await load();
    const actions = mod.planActions({
      dead: [],
      botBlock: [{ url: "https://example.org/blocked", statusCode: 403, statusText: "Forbidden", suggestion: null }],
      week: "2026-W47",
      existingIssues: [{ number: 8, title: "example.org（1 条）· 2026-W46", body: "" }],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("create");
    expect(actions[0].kind).toBe("bot-block");
    expect(actions[0].title).toBe("example.org（疑似反爬 1 条）· 2026-W47");
    expect(actions[0].existingIssueNumber).toBeNull();
  });
});

describe("lychee-weekly-report：CLI（--dry-run，不调网络）", () => {
  it("--dry-run 输出计划：新建 issue 动作 + 待复核清单，不调 GitHub API", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-lychee-report-"));
    try {
      const input = writeJson(root, "out.json", FIXTURE_OUT_MAP);
      const sentinel = writeJson(root, "sentinel.json", FIXTURE_SENTINEL);
      const { code, out } = runCli(root, [
        "--input", input,
        "--lychee-exit-code", "2",
        "--week", "2026-W47",
        "--sentinel", sentinel,
        "--dry-run",
      ]);
      expect(code, out).toBe(0);
      const plan = JSON.parse(out);
      expect(plan.week).toBe("2026-W47");
      const creates = plan.actions.filter((a: any) => a.action === "create");
      expect(creates.map((a: any) => a.title).sort()).toEqual([
        "example.co.uk（1 条）· 2026-W47",
        "example.com（2 条）· 2026-W47",
        "example.org（疑似反爬 1 条）· 2026-W47",
      ]);
      expect(plan.pending).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("无 --sentinel 时失败条目全部待复核、零 issue 动作", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-lychee-pending-"));
    try {
      const input = writeJson(root, "out.json", FIXTURE_OUT_MAP);
      const { code, out } = runCli(root, [
        "--input", input,
        "--lychee-exit-code", "2",
        "--week", "2026-W47",
        "--dry-run",
      ]);
      expect(code, out).toBe(0);
      expect(out).toContain("无可发 issue 的失败");
      expect(out).toContain("待 sentinel 复核");
      expect(out).toContain("https://example.com/gone");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lychee 退出码 1：不开 issue、报维护者、退出码 0", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-lychee-exit1-"));
    try {
      const input = writeJson(root, "out.json", FIXTURE_OUT_MAP);
      const { code, out } = runCli(root, ["--input", input, "--lychee-exit-code", "1", "--dry-run"]);
      expect(code).toBe(0);
      expect(out).toContain("退出码 1");
      expect(out).not.toContain("新建 issue");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("全绿（无失败条目）：零 issue、退出码 0", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-lychee-green-"));
    try {
      const input = writeJson(root, "out.json", {
        "https://example.com/ok": { status: { code: 200 } },
      });
      const { code, out } = runCli(root, ["--input", input, "--lychee-exit-code", "0", "--dry-run"]);
      expect(code, out).toBe(0);
      expect(out).toContain("无可发 issue 的失败");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
