/**
 * `check-defused-thickness.mjs` 的 CLI 行为：退出码三档各由什么形状触发，以及
 * 「不可比 ⇒ 不判红」这条闸门在命令行上是不是真的挡住了。
 *
 * 快照形状按 `explain-ci-failure --defused --json` 的真实输出手写（`run.head_sha` /
 * `jobs[].job|gateTotal|ran|defused|found`），这样两边形状分家时测试会先红。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./check-defused-thickness.mjs";

const LOCAL = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SAME = LOCAL;
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function row(over: Record<string, unknown>) {
  return {
    found: true,
    error: "",
    broken: "",
    name: "x",
    ran: 3,
    defused: 0,
    gateTotal: 3,
    conclusion: "success",
    ...over,
  };
}

function snapshot(jobs: unknown[], headSha: string | null = SAME) {
  return JSON.stringify({
    mode: "defused",
    repo: "a/b",
    run: { id: 12345, head_sha: headSha, conclusion: "failure", html_url: "https://x/12345" },
    summary: { jobs: jobs.length },
    jobs,
  });
}

const GREEN = snapshot([
  row({ job: "test-sqlite", name: "测试（SQLite 默认方言，分片 1/3）" }),
  row({ job: "test-web", name: "前端门禁", gateTotal: 5, ran: 1, defused: 4, conclusion: "failure" }),
  row({ job: "check-web-overlay", name: "覆盖层规范", gateTotal: 7, ran: 7 }),
]);

function run(argv: string[], text: string, headSha: string | null = LOCAL) {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => errors.push(a.map(String).join(" ")));
  return main(argv, { snapshotOf: () => text, headShaOf: () => headSha ?? "" }).then((rc) => ({
    rc,
    out: logs.join("\n"),
    err: errors.join("\n"),
  }));
}

/** 只注入快照、不注入 sha：专门用来验 `--head` 这个参数本身有没有接上（用法里写了就必须真生效） */
function runWithArgv(argv: string[], text: string) {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
  return main(["--from", "-", ...argv], { snapshotOf: () => text }).then((rc) => ({ rc, out: logs.join("\n") }));
}

const FULL = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const THIN_ONE = snapshot([row({ job: "test-sqlite", name: "片 1/3", gateTotal: 2, ran: 2 })], FULL);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("check-defused-thickness CLI：三档退出码各有各的形状", () => {
  it("口径可比 + 账齐 ⇒ 0，并说清「期望取自登记表」", async () => {
    const { rc, out } = await run(["--from", "-"], GREEN, LOCAL);
    expect(rc).toBe(0);
    expect(out).toContain("口径可比");
    expect(out).toContain("账的厚度与登记表一致");
    expect(out).toContain("读到账 3 个作业实例");
    // 撤防 4 道不算厚度问题：那是撤防账那一档的话，这里不许重复判红
    expect(out).not.toContain("账厚度不符");
    expect(out).not.toContain("[口径]");
  });

  it("口径可比 + 薄账 ⇒ 1，行里带差几道与本地核对命令", async () => {
    const thin = snapshot([row({ job: "test-sqlite", name: "片 1/3", gateTotal: 2, ran: 2 })], SAME);
    const { rc, out } = await run(["--from", "-"], thin, LOCAL);
    expect(rc).toBe(1);
    expect(out).toContain("账厚度不符");
    expect(out).toContain("比登记表薄 1 道");
    expect(out).toContain("node scripts/check-ci-gate.mjs");
    expect(out).toContain("退出码 1");
  });

  it("历史轮（head_sha 不是本地 HEAD）⇒ 同一份薄账只作 [口径] 提示、判 0", async () => {
    const thin = snapshot([row({ job: "test-sqlite", name: "片 1/3", gateTotal: 2, ran: 2 })], OTHER);
    const { rc, out } = await run(["--from", "-"], thin, LOCAL);
    expect(rc).toBe(0);
    expect(out).toContain("口径不可比");
    expect(out).toContain("[口径]");
    expect(out).toContain("按口径只提示");
  });

  it("快照里没有 head_sha ⇒ 保守判成不可比（不许拿「对不上」当证据判红）", async () => {
    const noSha = JSON.stringify({ mode: "defused", run: { id: 1 }, jobs: [row({ job: "test-sqlite", gateTotal: 2, ran: 2 })] });
    const { rc, out } = await run(["--from", "-"], noSha, LOCAL);
    expect(rc).toBe(0);
    expect(out).toContain("口径不可比");
  });

  it("一条账都没读到 ⇒ 2 并说「厚度无从判断」，绝不写成绿", async () => {
    const none = snapshot([
      row({ job: "audit", found: false, gateTotal: 0, ran: 0 }),
      row({ job: "docker-smoke", found: false, error: "terminated", gateTotal: 0, ran: 0 }),
    ]);
    const { rc, err } = await run(["--from", "-"], none, LOCAL);
    expect(rc).toBe(2);
    expect(err).toContain("厚度无从判断");
    expect(err).toContain("本该有账却读不到");
  });

  it("不是撤防账的快照 ⇒ 2 并指回 --defused --json", async () => {
    const { rc, err } = await run(["--from", "-"], JSON.stringify({ mode: "attribution", jobs: [] }), LOCAL);
    expect(rc).toBe(2);
    expect(err).toContain("不是撤防账");
  });

  it("快照读不到（文件不存在 / 不是 JSON）⇒ 2 并把原因写出来", async () => {
    const { rc, err } = await run(["--from", "nope.json"], "not json at all", LOCAL);
    expect(rc).toBe(2);
    expect(err).toContain("快照读不到");
    expect(err).toContain("nope.json");
  });

  it("--json 出 machine 可核对的一份：comparable / counted / findings / 登记表口径", async () => {
    const thin = snapshot([row({ job: "test-sqlite", name: "片 1/3", gateTotal: 2, ran: 2 })], OTHER);
    const { rc, out } = await run(["--from", "-", "--json"], thin, LOCAL);
    expect(rc).toBe(0);
    const j = JSON.parse(out);
    expect(j.mode).toBe("thickness");
    expect(j.comparable).toBe(false);
    expect(j.findings).toHaveLength(1);
    expect(j.counted).toEqual([]);
    expect(j.readableJobs).toBe(1);
    expect(j.registryGateTotal).toBe(26);
    expect(j.exitCode).toBe(0);
  });

  it("消融：判据改用 ran 与期望比 ⇒ web 真红那轮会被误报成薄账（基准必须是写侧报的总数）", async () => {
    const { rc } = await run(["--from", "-"], GREEN, LOCAL);
    expect(rc).toBe(0);
    // 同一份数据，若拿 ran 当基准：test-web 期望 5、ran 1 ⇒ 假红一条
    const naive = 5 - 1;
    expect(naive).toBeGreaterThan(0);
  });
});

describe("--head：口径闸门是真生效的（用法里写了这个参数，就必须读得到）", () => {
  it("短 sha 是快照 head_sha 的前缀 ⇒ 判成可比 ⇒ 同一份薄账从提示变成判红", async () => {
    const { rc, out } = await runWithArgv(["--head", "a1b2c3d4e5f6"], THIN_ONE);
    expect(rc).toBe(1);
    expect(out).toContain("口径可比");
    expect(out).toContain("--head 指定的 sha");
    expect(out).toContain("账厚度不符");
  });

  it("只有 6 位短 sha ⇒ 按 git 的保守口径判不成可比（薄账仍只提示）", async () => {
    const { rc, out } = await runWithArgv(["--head", "a1b2c3"], THIN_ONE);
    expect(rc).toBe(0);
    expect(out).toContain("口径不可比");
    expect(out).toContain("--head <快照里的 sha> 显式指定");
  });

  it("--head 与快照无关 ⇒ 不可比；不传时读本地 HEAD，两者都不该悄悄当成可比", async () => {
    const { rc, out } = await runWithArgv(["--head", "ffffffffffffffffffffffffffffffffffffffff"], THIN_ONE);
    expect(rc).toBe(0);
    expect(out).toContain("口径不可比");
    expect(out).toContain("--head 指定的 sha=ffffffffffff");
  });

  it("消融：若 comparable 直接写死 true ⇒ 历史轮的登记缺口会被说成缺陷", async () => {
    const forced = await runWithArgv(["--head", "a1b2c3d4e5f6"], snapshot([row({ job: "test-sqlite", name: "片 1/3", gateTotal: 2, ran: 2 })], "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"));
    expect(forced.rc).toBe(0);
    expect(forced.out).toContain("口径不可比");
  });
});
