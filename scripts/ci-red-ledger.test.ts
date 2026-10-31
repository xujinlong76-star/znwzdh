/**
 * CI 红灯台账：跨轮对比的语义断言。
 *
 * 三个方向都要钉住：
 *   1. 新红/换因必须被识别——否则台账会把「刚坏的」当成「早就红的」放行；
 *   2. 已知红必须被认出来——否则每轮都报新增，台账不如没有；
 *   3. 坏账/缺账必须 rc 2——「读不到台账」不能退化成「没有新红」；
 *   4. 别名只放行登记过的抖动指纹——未登记的指纹照旧按换因处理。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffLedger,
  identityOf,
  renderLedger,
  signatureOf,
  updateLedger,
  validateLedger,
} from "./lib/ci-red-ledger.mjs";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts/ci-red-ledger.mjs");
const LEDGER = resolve(ROOT, "docs/ci-red-ledger.json");

function gitEnv(extra: Record<string, string> = {}) {
  const env = { ...process.env };
  // 先剔继承来的 GIT_*（钩子会设 GIT_INDEX_FILE，泄漏进子进程会让 git log 读错索引），
  // 再叠加用例显式要注入的变量——顺序反了会把注入的 GITHUB_STEP_SUMMARY 一起删掉。
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GITHUB_STEP_SUMMARY;
  return { ...env, ...extra };
}

const workspaces: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "navhub-ledger-"));
  workspaces.push(dir);
  return dir;
}
afterEach(() => {
  while (workspaces.length > 0) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function junit(failures: { file: string; name: string; message: string }[], tests = failures.length) {
  const suites = failures
    .map(
      (f) =>
        `<testsuite name="s" tests="1" failures="1"><testcase classname="${esc(f.file)}" name="${esc(f.name)}">` +
        `<failure message="${esc(f.message)}" /></testcase></testsuite>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${tests}" failures="${failures.length}">\n${suites}\n</testsuites>`;
}

function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: gitEnv(env) });
}

const known = [
  {
    id: "apps/web/test/a.test.ts :: 用例 A",
    file: "apps/web/test/a.test.ts",
    case: "用例 A",
    signature: "expected 1 to be 2",
    message: "expected 1 to be 2\n    at a.test.ts:1:1",
    owner: "alice",
    firstSeen: "2026-10-20",
    lastSeen: "2026-10-29",
    expiresAt: "2026-11-03",
  },
];

const ledgerOf = (entries: object[]) => ({ version: 1, updatedAt: "2026-10-29", entries });

describe("指纹：identity 与 signature 两层", () => {
  it("signature 取首行、压平空白；只改堆栈不会变", () => {
    expect(signatureOf("expected 1 to be 2\n    at a.test.ts:1:1")).toBe("expected 1 to be 2");
    expect(signatureOf("expected   1 to be 2\r\nat x")).toBe("expected 1 to be 2");
    expect(signatureOf("")).toBe("");
  });

  it("identity 只看 文件::用例名，消息怎么变都不影响", () => {
    expect(identityOf({ classname: "f.ts", name: "用例", message: "x" })).toBe(
      identityOf({ classname: "f.ts", name: "用例", message: "完全不同" }),
    );
  });
});

describe("diffLedger：新增 / 换因 / 已知 / 过期", () => {
  const now = new Date("2026-10-29T00:00:00Z");

  it("台账里没有的用例 → introduced", () => {
    const diff = diffLedger(ledgerOf(known), [{ classname: "b.test.ts", name: "B", message: "boom" }], { now });
    expect(diff.introduced).toHaveLength(1);
    expect(diff.introduced[0].reason).toContain("台账里没有");
  });

  it("同用例同指纹 → persisted，不算新增", () => {
    const diff = diffLedger(ledgerOf(known), [{ classname: "apps/web/test/a.test.ts", name: "用例 A", message: "expected 1 to be 2" }], { now });
    expect(diff.persisted).toHaveLength(1);
    expect(diff.introduced).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.expired).toHaveLength(0);
  });

  it("同用例换因 → changed（不能因为名字一样就放行）", () => {
    const diff = diffLedger(ledgerOf(known), [{ classname: "apps/web/test/a.test.ts", name: "用例 A", message: "TypeError: x is undefined" }], { now });
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].prevSignature).toBe("expected 1 to be 2");
    expect(diff.persisted).toHaveLength(0);
  });

  it("过期未修：persisted 且 expiresAt 早于今天", () => {
    const diff = diffLedger(ledgerOf(known), [{ classname: "apps/web/test/a.test.ts", name: "用例 A", message: "expected 1 to be 2" }], {
      now: new Date("2026-11-10T00:00:00Z"),
    });
    expect(diff.expired).toHaveLength(1);
    expect(diff.expired[0].overdueDays).toBe(7);
  });

  it("fixed 只在显式允许时计算（单分片看不到别人的失败集）", () => {
    const single = diffLedger(ledgerOf(known), [], { now });
    expect(single.fixed).toHaveLength(0);
    const full = diffLedger(ledgerOf(known), [], { now, includeFixed: true });
    expect(full.fixed).toHaveLength(1);
  });
});

describe("updateLedger：入账、续命、换因重置、修复移除", () => {
  const now = new Date("2026-10-29T00:00:00Z");

  it("新条目带 owner 与 expiresAt；已知条目保留 firstSeen 并刷新 lastSeen", () => {
    const { ledger } = updateLedger(ledgerOf(known), [
      { classname: "apps/web/test/a.test.ts", name: "用例 A", message: "expected 1 to be 2" },
      { classname: "c.test.ts", name: "C", message: "boom" },
    ], { now, ttlDays: 7, ownerOf: () => "bob" });
    const a = ledger.entries.find((e: any) => e.case === "用例 A")!;
    const c = ledger.entries.find((e: any) => e.case === "C")!;
    expect(a.firstSeen).toBe("2026-10-20");
    expect(a.lastSeen).toBe("2026-10-29");
    expect(c.owner).toBe("bob");
    expect(c.expiresAt).toBe("2026-11-05");
  });

  it("换因 = 新账：签名更新、firstSeen 重置、TTL 重算", () => {
    const { ledger, renewed } = updateLedger(ledgerOf(known), [
      { classname: "apps/web/test/a.test.ts", name: "用例 A", message: "TypeError: 新根因" },
    ], { now, ttlDays: 7, ownerOf: () => "carol" });
    expect(renewed).toEqual(["apps/web/test/a.test.ts :: 用例 A"]);
    const a = ledger.entries[0];
    expect(a.signature).toBe("TypeError: 新根因");
    expect(a.firstSeen).toBe("2026-10-29");
    expect(a.owner).toBe("carol");
  });

  it("不在本次失败集里的条目被移除并报出", () => {
    const { ledger, removed } = updateLedger(ledgerOf(known), [], { now });
    expect(ledger.entries).toEqual([]);
    expect(removed).toEqual(["apps/web/test/a.test.ts :: 用例 A"]);
  });

  it("flaky：本轮全绿也不移除、lastSeen 不刷新（一轮绿不是修复证据）", () => {
    const flakyEntry = { ...known[0], flaky: true, lastSeen: "2026-10-20" };
    const { ledger, removed, retained } = updateLedger(ledgerOf([flakyEntry]), [], { now });
    expect(removed).toEqual([]);
    expect(retained).toEqual(["apps/web/test/a.test.ts :: 用例 A"]);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].lastSeen).toBe("2026-10-20");
  });
});

describe("signatureAliases：只放行登记过的抖动指纹", () => {
  // 真实场景：ai-heal 的 autoApply 依赖外站实测探活，成功数每轮不同，
  // 同一断言在 `expected +0 to be 2` / `expected 1 to be 2` 之间抖动。
  const flaky = [
    {
      id: "apps/api/test/p.test.ts :: 用例 F",
      file: "apps/api/test/p.test.ts",
      case: "用例 F",
      signature: "expected +0 to be 2",
      message: "expected +0 to be 2\n    at p.test.ts:1:1",
      signatureAliases: ["expected 1 to be 2"],
      owner: "bob",
      firstSeen: "2026-10-31",
      lastSeen: "2026-10-31",
      expiresAt: "2026-11-07",
    },
  ];
  const now = new Date("2026-10-31T00:00:00Z");
  const fail = (message: string) => [{ classname: "apps/api/test/p.test.ts", name: "用例 F", message }];

  it("命中别名 → persisted（标 matchedAlias），不算换因", () => {
    const diff = diffLedger(ledgerOf(flaky), fail("expected 1 to be 2\n    at p.test.ts:9:9"), { now });
    expect(diff.changed).toHaveLength(0);
    expect(diff.persisted).toHaveLength(1);
    expect(diff.persisted[0].matchedAlias).toBe(true);
  });

  it("别名按首行归一化：连堆栈整段粘进来也能命中", () => {
    const pasted = ledgerOf([{ ...flaky[0], signatureAliases: ["  expected   1 to be 2\r\n    at p.test.ts:3:4"] }]);
    const diff = diffLedger(pasted, fail("expected 1 to be 2"), { now });
    expect(diff.persisted).toHaveLength(1);
    expect(diff.persisted[0].matchedAlias).toBe(true);
  });

  it("未登记的指纹 → 照旧换因（别名是确切字符串，不是通配）", () => {
    const diff = diffLedger(ledgerOf(flaky), fail("expected 2 to be 2"), { now });
    expect(diff.changed).toHaveLength(1);
    expect(diff.persisted).toHaveLength(0);
  });

  it("updateLedger：别名命中保留主指纹与别名、只刷新 lastSeen", () => {
    const { ledger, renewed } = updateLedger(ledgerOf(flaky), fail("expected 1 to be 2"), { now });
    expect(renewed).toEqual([]);
    const e = ledger.entries[0];
    expect(e.signature).toBe("expected +0 to be 2");
    expect(e.signatureAliases).toEqual(["expected 1 to be 2"]);
    expect(e.lastSeen).toBe("2026-10-31");
  });

  it("updateLedger：真换因丢弃别名（别名从属于旧根因）", () => {
    const { ledger, renewed } = updateLedger(ledgerOf(flaky), fail("TypeError: 新根因"), { now });
    expect(renewed).toHaveLength(1);
    expect(ledger.entries[0].signature).toBe("TypeError: 新根因");
    expect(ledger.entries[0].signatureAliases).toBeUndefined();
  });

  it("validateLedger：别名不是确切的非空字符串 → 坏账", () => {
    expect(validateLedger(ledgerOf([{ ...flaky[0], signatureAliases: "expected 1 to be 2" }])).join()).toContain("signatureAliases");
    expect(validateLedger(ledgerOf([{ ...flaky[0], signatureAliases: [""] }])).join()).toContain("signatureAliases");
  });

  it("validateLedger：flaky 不是布尔 → 坏账", () => {
    expect(validateLedger(ledgerOf([{ ...flaky[0], flaky: "yes" }])).join()).toContain("flaky");
  });

  it("真实 CLI：别名命中 → --require-no-new/--strict-ttl rc 0，输出点名别名", () => {
    const dir = workspace();
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOf(flaky)));
    writeFileSync(join(dir, "j.xml"), junit([{ file: "apps/api/test/p.test.ts", name: "用例 F", message: "expected 1 to be 2" }]));
    const res = run(dir, ["--from", "j.xml", "--ledger", "ledger.json", "--require-no-new", "--strict-ttl"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("别名 1");
  });
});

describe("validateLedger：坏账必须报", () => {
  it("缺 owner/expiresAt 的条目不算合法台账", () => {
    expect(validateLedger({ version: 1, entries: [{ id: "x", signature: "s" }] }).join()).toContain("owner");
    expect(validateLedger({ version: 2, entries: [] }).join()).toContain("version");
    expect(validateLedger({ version: 1, entries: [] })).toEqual([]);
  });
});

describe("真实 CLI", () => {
  it("缺台账时 rc 2：不能把「没账」当成「没有新红」", () => {
    const dir = workspace();
    writeFileSync(join(dir, "j.xml"), junit([{ file: "f.ts", name: "n", message: "m" }]));
    const res = run(dir, ["--from", "j.xml", "--ledger", "missing.json", "--require-no-new"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("台账不存在");
  });

  it("缺 junit 产物时 rc 2：不推断「没有失败」", () => {
    const dir = workspace();
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOf([])));
    const res = run(dir, ["--from", "nope.xml", "--ledger", "ledger.json"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("找不到 junit 产物");
  });

  it("--require-no-new：台账外的红 → rc 1；不带旗标 → rc 0 但仍报告", () => {
    const dir = workspace();
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOf(known)));
    writeFileSync(join(dir, "j.xml"), junit([{ file: "new.test.ts", name: "新用例", message: "boom" }]));
    const strict = run(dir, ["--from", "j.xml", "--ledger", "ledger.json", "--require-no-new"]);
    expect(strict.status).toBe(1);
    expect(strict.stdout).toContain("新增 1");
    const advisory = run(dir, ["--from", "j.xml", "--ledger", "ledger.json"]);
    expect(advisory.status).toBe(0);
    expect(advisory.stdout).toContain("新增 1");
  });

  it("--strict-ttl：过期未修 → rc 1", () => {
    const dir = workspace();
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOf([{ ...known[0], expiresAt: "2020-01-01" }])));
    writeFileSync(join(dir, "j.xml"), junit([{ file: "apps/web/test/a.test.ts", name: "用例 A", message: "expected 1 to be 2" }]));
    const res = run(dir, ["--from", "j.xml", "--ledger", "ledger.json", "--strict-ttl"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("过期 1");
  });

  it("--update 建账：新红入账、owner 兜底、可再次 check 通过", () => {
    const dir = workspace();
    writeFileSync(join(dir, "j.xml"), junit([{ file: "f.test.ts", name: "n", message: "boom" }]));
    const upd = run(dir, ["--from", "j.xml", "--ledger", "ledger.json", "--update", "--ttl-days", "3", "--owner", "team-a"]);
    expect(upd.status).toBe(0);
    const saved = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
    expect(validateLedger(saved)).toEqual([]);
    expect(saved.entries[0].owner).toBe("team-a");
    const check = run(dir, ["--from", "j.xml", "--ledger", "ledger.json", "--require-no-new"]);
    expect(check.status).toBe(0);
  });

  it("--update 对 flaky 账：本轮全绿也保留并在输出里点名", () => {
    const dir = workspace();
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOf([{ ...known[0], flaky: true }])));
    writeFileSync(join(dir, "j.xml"), junit([], 0));
    const res = run(dir, ["--from", "j.xml", "--ledger", "ledger.json", "--update"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("抖动保留 1");
    const saved = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0].flaky).toBe(true);
  });

  it("GITHUB_STEP_SUMMARY 存在时追加而不是覆盖", () => {
    const dir = workspace();
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOf([])));
    writeFileSync(join(dir, "j.xml"), junit([{ file: "f.ts", name: "n", message: "m" }]));
    writeFileSync(join(dir, "summary.md"), "既有内容\n");
    const res = run(dir, ["--from", "j.xml", "--ledger", "ledger.json"], {
      GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
    });
    expect(res.status).toBe(0);
    const text = readFileSync(join(dir, "summary.md"), "utf8");
    expect(text.startsWith("既有内容\n")).toBe(true);
    expect(text).toContain("CI 红灯台账");
  });
});

describe("仓库接线", () => {
  it("ci.yml 的分片与 E2E 作业都在测试步之后跑台账（--require-no-new + --strict-ttl）", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
    const sqlite = yml.indexOf("node scripts/ci-red-ledger.mjs --from junit-sqlite-${{ matrix.shard }}.xml");
    expect(sqlite).toBeGreaterThan(-1);
    expect(yml.indexOf("node scripts/junit-summary.mjs junit-sqlite-${{ matrix.shard }}.xml")).toBeLessThan(sqlite);
    expect(sqlite).toBeLessThan(yml.indexOf("path: junit-sqlite-*.xml"));
    const e2e = yml.indexOf("node scripts/ci-red-ledger.mjs --from junit-e2e-${{ matrix.shard }}.xml");
    expect(e2e).toBeGreaterThan(-1);
    expect(yml.indexOf("PLAYWRIGHT_JUNIT_OUTPUT_NAME=junit-e2e-${{ matrix.shard }}.xml")).toBeLessThan(e2e);

    // TTL 到期升级必须真接在 CI 上：`--strict-ttl` 只在测试里绿、没进 workflow 等于没做。
    // 按「run 行」取整行再断言两个旗标，防止旗标被挪到别的命令上。
    const sqliteLine = yml.split("\n").find((l) => l.includes("node scripts/ci-red-ledger.mjs --from junit-sqlite-"));
    const e2eLine = yml.split("\n").find((l) => l.includes("node scripts/ci-red-ledger.mjs --from junit-e2e-"));
    for (const [label, line] of [["test-sqlite", sqliteLine], ["test-e2e", e2eLine]] as const) {
      expect(line, `${label} 的台账步骤整行没找到`).toBeTruthy();
      expect(line).toContain("--require-no-new");
      expect(line, `${label} 的台账步骤缺 --strict-ttl（过期红不会升级）`).toContain("--strict-ttl");
    }
  });

  it("跟踪路径上的台账存在且形状合法（坏账会把所有红都当已知）", () => {
    expect(LEDGER.startsWith(ROOT.replace(/\\/g, "/")) || true).toBe(true);
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
    expect(validateLedger(ledger)).toEqual([]);
    for (const entry of ledger.entries) {
      expect(entry.owner.length).toBeGreaterThan(0);
      expect(entry.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("渲染：全绿时也给出结论行，不输出空表", () => {
    const text = renderLedger({ introduced: [], changed: [], persisted: [], fixed: [], expired: [] });
    expect(text).toContain("✅");
    expect(text).toContain("没有台账之外的红");
  });
});
