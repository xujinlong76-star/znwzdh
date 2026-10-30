/**
 * 厚度棘轮判据自证（`scripts/lib/ci-defused-thickness.mjs`）。
 *
 * 两类真实数据都进来了：
 *  - 齐账的一轮（run 41025959764 的逐作业读数）⇒ 棘轮上线不得自造第一红；
 *  - 账确实薄的一轮（run 40983034925：`test-sqlite` 报 2 道，而 `backend-lint` 是 2026-10-30 才登记的）
 *    ⇒ 必须靠 `comparable` 闸门只提示不判红，否则「读历史轮」每轮都假告。
 */
import { describe, expect, it } from "vitest";
import { DEFUSED_GATES } from "./lib/ci-defused.mjs";
import { renderThickness, thicknessFindings } from "./lib/ci-defused-thickness.mjs";

const REG = { registry: DEFUSED_GATES };

/** 一条读到账的行（矩阵分片靠 name 区分，job 是登记表 key） */
function row(over: Record<string, unknown>) {
  return { found: true, error: "", broken: "", gateTotal: 3, ran: 3, defused: 0, ...over };
}

describe("撤防账厚度棘轮：写侧报的道数必须等于登记表期望", () => {
  it("真实齐账轮 ⇒ 一条发现都没有（上线时不许自己造红）", () => {
    const rows = [
      row({ job: "test-sqlite", name: "测试（SQLite 默认方言，分片 1/3）", gateTotal: 3, ran: 3 }),
      row({ job: "test-sqlite", name: "测试（SQLite 默认方言，分片 2/3）", gateTotal: 3, ran: 3 }),
      row({ job: "test-postgres", gateTotal: 2, ran: 2 }),
      row({ job: "test-web", gateTotal: 5, ran: 1, defused: 4 }),
      row({ job: "test-e2e", gateTotal: 1, ran: 1 }),
      row({ job: "check-isr-live", gateTotal: 4, ran: 4 }),
      row({ job: "check-web-overlay", gateTotal: 7, ran: 7 }),
      row({ job: "docker-smoke", gateTotal: 2, ran: 2 }),
      row({ job: "audit", gateTotal: 2, ran: 2 }),
    ];
    expect(thicknessFindings(rows, REG).findings).toEqual([]);
  });

  it("薄账 ⇒ 点名差几道并给本地核对命令（撤防为 0 也要能发现）", () => {
    const out = thicknessFindings([row({ job: "test-sqlite", gateTotal: 2, ran: 2, defused: 0 })], REG);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ kind: "thin", expected: 3, reported: 2, delta: 1 });
    expect(out.findings[0].message).toContain("比登记表薄 1 道");
    expect(out.findings[0].message).toContain("node scripts/check-ci-gate.mjs");
  });

  it("厚账 ⇒ 说「新门禁进了 ci.yml 没进登记表」，不许反写成薄账", () => {
    const out = thicknessFindings([row({ job: "test-web", gateTotal: 6, ran: 6 })], REG);
    expect(out.findings[0].kind).toBe("fat");
    expect(out.findings[0].message).toContain("没进登记表");
  });

  it("账自身对不上（跑过 + 没跑成 ≠ 报的总数）⇒ 判成「读到的数不可信」", () => {
    const out = thicknessFindings([row({ job: "audit", gateTotal: 2, ran: 1, defused: 0 })], REG);
    const un = out.findings.find((f) => f.kind === "unbalanced");
    expect(un, JSON.stringify(out.findings)).toBeTruthy();
    expect(un!.message).toContain("读到的数不可信");
    // 道数与期望仍齐 ⇒ 只报形状不符，不重复报一条薄账
    expect(out.findings.some((f) => f.kind === "thin")).toBe(false);
  });

  it("矩阵分片逐实例比，不按登记表唯一计数比（26 道 ≠ 按实例求和）", () => {
    const rows = [
      row({ job: "test-sqlite", name: "片 1/3", gateTotal: 2, ran: 2 }),
      row({ job: "test-sqlite", name: "片 2/3", gateTotal: 2, ran: 2 }),
    ];
    const out = thicknessFindings(rows, REG);
    expect(out.findings).toHaveLength(2);
    expect(out.findings.map((f) => f.name)).toEqual(["片 1/3", "片 2/3"]);
  });

  it("没读到账 / 日志取不到 / 不在登记表的作业 ⇒ 一律不出声（那些话归分档那一档说）", () => {
    const out = thicknessFindings(
      [
        { job: "audit", found: false, wired: false, gateTotal: 0, ran: 0, defused: 0 },
        { job: "docker-smoke", found: false, error: "terminated", gateTotal: 0, ran: 0, defused: 0 },
        { job: "ci-passed", found: true, gateTotal: 0, ran: 0, defused: 0 },
        { job: "", found: true, gateTotal: 0, ran: 0, defused: 0 },
      ],
      REG,
    );
    expect(out.findings).toEqual([]);
  });

  it("comparable=false ⇒ 发现照算但 counted 为空，文本行换成 [口径] 前缀", () => {
    const rows = [row({ job: "test-sqlite", gateTotal: 2, ran: 2 })];
    const out = thicknessFindings(rows, { ...REG, comparable: false });
    expect(out.findings).toHaveLength(1);
    expect(out.counted).toEqual([]);
    const line = renderThickness(out)[0];
    expect(line.startsWith("[口径]")).toBe(true);
    expect(line).toContain("只提示不判红");
    // 反向：同一份数据判成可比时必须进 counted（闸门不许把话吞掉）
    const cmp = thicknessFindings(rows, { ...REG, comparable: true });
    expect(cmp.counted).toHaveLength(1);
    expect(renderThickness(cmp)[0].startsWith("账厚度不符")).toBe(true);
  });

  it("消融：基准退回「比 ran 与期望」⇒ web 真红那轮会被多造一条假薄账", () => {
    // 真实形状：test-web 5 道里 1 道跑过、4 道被上游红跳过——道数没错，是门禁没跑成。
    const rows = [row({ job: "test-web", ran: 1, defused: 4, gateTotal: 5 })];
    expect(thicknessFindings(rows, REG).findings).toEqual([]);
    const naive = rows.filter((r) => r.ran !== REG.registry.find((e) => e.job === r.job)!.gates.length);
    expect(naive).toHaveLength(1);
  });

  it("登记表唯一合计仍是 26（改登记表要连带改这里的期望）", () => {
    expect(DEFUSED_GATES.reduce((s, e) => s + (e.gates ?? []).length, 0)).toBe(26);
  });
});
