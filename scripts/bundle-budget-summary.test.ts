/**
 * 首屏预算账的自检。
 *
 * 这份账存在的理由是「--report 的输出此前只存在于一次本地终端会话里」，
 * 所以它自己必须是最先被钉住的东西：三类发现少写一类、空类目被省略掉、
 * 过期产物的数没打上「不可用」标记——三种都会让账变成一个看着可信的假数。
 * CI 接线用源码级断言（读 .github/workflows/ci.yml），因为「脚本存在但没被跑」
 * 等于没有账，而那种漏法只有对着 yaml 才看得出来。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { renderLedger } from "./bundle-budget-summary.mjs";

const SCRIPT = "scripts/bundle-budget-summary.mjs";
const DIRS: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "navhub-bundle-ledger-"));
  DIRS.push(d);
  return d;
}

afterAll(() => {
  for (const d of DIRS) rmSync(d, { recursive: true, force: true });
});

type Finding = { route: string; bytes: number; limit: number; proposed: number };

function finding(route: string, bytes: number, limit: number): Finding {
  return { route, bytes, limit, proposed: Math.ceil((bytes * 1.05) / 1024) * 1024 };
}

/** 一份「出处干净」的最小报告；各条用例只改自己要改的那一格 */
function report(overrides: Record<string, unknown> = {}) {
  return {
    distDir: ".next",
    bundler: "turbopack",
    mode: "report",
    headroom: 1.05,
    routes: [{ route: "/", bytes: 1_000_000 }],
    violations: [],
    provenance: {
      sha: "abc1234",
      dirty: 0,
      bundleDirty: 0,
      bundleDirtyPaths: [],
      builtAt: Date.parse("2026-10-28T00:00:00Z"),
      newestSourceAt: Date.parse("2026-10-27T00:00:00Z"),
      stale: false,
    },
    report: { raise: [], addMissing: [], tighten: [] },
    ...overrides,
  };
}

describe("renderLedger：三类发现都要在账上", () => {
  it("三类都有：表头逐类给条数，正文逐条列出实测/现预算/建议", () => {
    const md = renderLedger(
      report({
        report: {
          raise: [finding("/videos", 1_200_000, 1_000_000)],
          addMissing: [finding("/me/settings", 700_000, 1_270_000)],
          tighten: [finding("/", 900_000, 1_100_000)],
        },
      }),
      { top: 12 },
    );
    expect(md).toContain("| 上调候选（实测超预算） | 1 |");
    expect(md).toContain("| 漏配专属预算（正落 default） | 1 |");
    expect(md).toContain("| 可下调（低于预算 5% 以上） | 1 |");
    for (const r of ["/videos", "/me/settings", "/"]) {
      expect(md).toContain("`" + r + "`");
    }
  });

  it("某一类是 0 也要显式写「无」——省略会让人分不清「没有」和「没跑」", () => {
    const md = renderLedger(report(), { top: 12 });
    expect(md).toContain("### 上调候选（实测超预算）（0 条）");
    expect(md.split("\n").filter((l) => l.trim() === "无").length).toBe(3);
  });

  it("超过 --top 时截断，并说明剩下的去哪看", () => {
    const many = Array.from({ length: 7 }, (_, i) => finding(`/p${i}`, 500_000 + i * 1000, 1_270_000));
    const md = renderLedger(report({ report: { raise: [], addMissing: many, tighten: [] } }), { top: 5 });
    expect(md).toContain("另有 2 条未列出");
    expect(md).toContain("bundle-budget-report.json");
    expect(md).toContain("`/p6`");
  });

  it("按实测降序排：截断时留下的必须是最贵的那几条", () => {
    const md = renderLedger(
      report({
        report: { raise: [], addMissing: [finding("/cheap", 400_000, 1_270_000), finding("/rich", 900_000, 1_270_000)], tighten: [] },
      }),
      { top: 1 },
    );
    expect(md).toContain("`/rich`");
    expect(md).not.toContain("`/cheap`");
  });

  it("不许原地改动传进来的报告（artifact 里的 JSON 要保持预算脚本给的顺序）", () => {
    const rows = [finding("/cheap", 400_000, 1_270_000), finding("/rich", 900_000, 1_270_000)];
    const fx = report({ report: { raise: [], addMissing: rows, tighten: [] } }) as { report: { addMissing: Finding[] } };
    renderLedger(fx, { top: 12 });
    expect(fx.report.addMissing.map((r) => r.route)).toEqual(["/cheap", "/rich"]);
  });
});

describe("产物出处：账得先说这份数能不能用", () => {
  it("产物比源码旧 → 显眼写「不可用于定基线」，并带上最新源文件时间", () => {
    const fx = report();
    (fx.provenance as Record<string, unknown>).stale = true;
    const md = renderLedger(fx, { top: 12 });
    expect(md).toContain("**这份数不可用于定基线**");
    expect(md).toContain("产物比源码旧");
  });

  it("首屏源码有未提交改动 → 同样标记，并把挡路的文件数写进账", () => {
    const fx = report();
    (fx.provenance as Record<string, unknown>).bundleDirty = 77;
    const md = renderLedger(fx, { top: 12 });
    expect(md).toContain("**这份数不可用于定基线**");
    expect(md).toContain("首屏源码有 77 个未提交改动");
  });

  it("出处干净时不许出现那条警告——否则「不可用」会变成没人再看的背景噪声", () => {
    expect(renderLedger(report(), { top: 12 })).not.toContain("不可用于定基线");
  });
});

describe("真实 CLI", () => {
  function cli(args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  }

  it("--from 一份报告 -> 账写进 summary 文件，机读 JSON 另落一份", () => {
    const dir = tempDir();
    const src = join(dir, "report.json");
    const out = join(dir, "out.json");
    const sum = join(dir, "summary.md");
    writeFileSync(src, JSON.stringify(report({ report: { raise: [], addMissing: [finding("/me", 700_000, 1_270_000)], tighten: [] } })));
    const res = cli(["--from", src, "--out-json", out, "--summary-file", sum]);
    expect(res.status).toBe(0);
    const md = readFileSync(sum, "utf8");
    expect(md).toContain("## 首屏预算账");
    expect(md).toContain("`/me`");
    expect(JSON.parse(readFileSync(out, "utf8")).report.addMissing).toHaveLength(1);
    expect(res.stdout).toContain("raise=0 addMissing=1 tighten=0");
  });

  it("报告 JSON 解析不了 → rc 1，且一个字节都不写（不做「解析失败 = 0 条发现」的降级）", () => {
    const dir = tempDir();
    const src = join(dir, "broken.json");
    const out = join(dir, "out.json");
    const sum = join(dir, "summary.md");
    writeFileSync(src, "not json");
    const res = cli(["--from", src, "--out-json", out, "--summary-file", sum]);
    expect(res.status).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(sum)).toBe(false);
  });

  it("未知参数 / --top 非正整数 / --from 指不到文件 → rc 2", () => {
    expect(cli(["--fro", "x"]).status).toBe(2);
    expect(cli(["--top", "abc"]).status).toBe(2);
    expect(cli(["--top", "0"]).status).toBe(2);
    expect(cli(["--from", join(tempDir(), "nope.json")]).status).toBe(2);
  });

  it("拿不到报告（预算脚本跑不动）→ rc 1，而不是写一份空账", () => {
    // 用 NEXT_DIST_DIR 指向一个不存在的构建目录：check-bundle-budget 会以 rc 2 退出，
    // 账脚本必须把「拿不到」原样传出去，不能折成「本轮 0 条发现」。
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, NEXT_DIST_DIR: "no-such-dist-9k2" } });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("拿不到报告");
  });
});

describe("CI 接线（源码级钉子）", () => {
  // 本机工作区是 CRLF、git blob 是 LF（实测：工作区 776 行全 CRLF，blob 0 个 CRLF），
  // 而 CI 的 Linux runner 看到的是 LF。跨 OS 都会跑的源码级断言必须先归一，
  // 否则同一条 `run: …\n` 在一边能匹配、在另一边静默匹配不到——那就是「钉子没钉」。
  const raw = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  const wf = raw.replace(/\r\n/g, "\n");

  it("预算门禁之后跑账脚本，且 if: always()——红灯时才是最需要账的时候", () => {
    const gate = wf.indexOf("run: node scripts/check-bundle-budget.mjs\n");
    const ledger = wf.indexOf("node scripts/bundle-budget-summary.mjs");
    expect(gate).toBeGreaterThan(-1);
    expect(ledger).toBeGreaterThan(gate);
    const block = wf.slice(ledger, ledger + 700);
    expect(block).toContain("if: always()");
  });

  it("artifact 传的就是脚本写的那个文件，且缺文件必须 error（junit 用 warn，实测三连 0 个 artifact）", () => {
    const ledger = wf.indexOf("node scripts/bundle-budget-summary.mjs");
    const block = wf.slice(ledger, ledger + 900);
    expect(block).toContain('"$RUNNER_TEMP/bundle-budget-report.json"');
    expect(block).toMatch(/name: bundle-budget-report/);
    expect(block).toContain("${{ runner.temp }}/bundle-budget-report.json");
    expect(block).toContain("if-no-files-found: error");
  });

  it("账脚本自己不进门禁判定：门禁仍是判定模式，账是后加的只读步骤", () => {
    const gateLine = (wf.match(/- run: node scripts\/check-bundle-budget\.mjs[^\n]*/) ?? [""])[0];
    // 把门禁本身改成 --report/--json 等于取消门禁——这条钉住「跑的还是判定模式」
    expect(gateLine.trim()).toBe("- run: node scripts/check-bundle-budget.mjs");
    expect(wf).toContain("node scripts/check-isr-routes.mjs");
  });
});
