/**
 * 每周复盘草稿生成器的回归测试（fixture 驱动，不依赖实时 git 历史）。
 *
 * 守四件事：
 *   1. 回归夹具：11-16～11-22 真实 git 历史（928 笔）上，聚类计数、站数/
 *      键数/节点数前后对照、过期规则①检出与人工标准答案逐项一致
 *      （标准答案见 scripts/fixtures/weekly-review-2026-11-16-22.expected.md，
 *      先于脚本写出，点数命令记在该文档 §0–§3）；
 *   2. 确定性规则：estimated 节点不翻过期、14 天观察期按日计算、状态表
 *      超 14 天未更新时草稿顶部告警；
 *   3. 防幻觉：草稿每条断言带来源（commit hash / 文件路径 / 报告名），
 *      无来源数字标“未核实”；
 *   4. 只读护栏（R5）：脚本除草稿 md 外零写操作、零提交、零推送、
 *      零新增网络请求（源码级禁令 + 运行前后 git status 比对）。
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildDraft,
  checkPreconditions,
  classifyCommit,
  clusterCommits,
  countExamNodes,
  countNavigationSites,
  countPricingKeys,
  daysBetween,
  detectExpiredRule1,
  detectStalePoc,
  parseExamNodes,
  parseLog,
  renderDraft,
  runGit,
} from "./weekly-review-draft.mjs";

const SCRIPT = resolve("scripts/weekly-review-draft.mjs");
const FIXTURE_LOG = resolve("scripts/fixtures/weekly-review-2026-11-16-22.fixture.txt");
const STATE_PATH = resolve("hidden_files/strategy-state.json");
const BASE_REV = "02c0fd1bfe948cfc39727ecc1bf91d52cd650af6";
const HEAD_REV = "8e876a02d926fa49b285d2fd1a34114d0f830c6d";

function fixtureDraft() {
  const { data } = buildDraft({
    fixtureLog: FIXTURE_LOG,
    baseRev: BASE_REV,
    headRev: HEAD_REV,
    asOf: "2026-11-22",
    since: "2026-11-16 00:00:00 +0800",
    until: "2026-11-22 23:59:59 +0800",
    statePath: STATE_PATH,
  });
  return { data, markdown: renderDraft(data) };
}

interface ClusterView {
  name: string;
  count: number;
  reps: { hash: string; date: string; subject: string }[];
}

function clusterByName(data: any, name: string): ClusterView {
  const found = (data.clusters as ClusterView[]).find((c) => c.name === name);
  if (!found) throw new Error(`聚类缺失：${name}`);
  return found;
}

function countByName(data: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of data.clusters as ClusterView[]) out[c.name] = c.count;
  return out;
}

describe("回归夹具：11-16～11-22 真实历史（标准答案见 .expected.md）", () => {
  it("聚类计数与标准答案一致，总数 928，零丢失", () => {
    const { data } = fixtureDraft();
    expect(data.total).toBe(928);
    expect(countByName(data)).toEqual({
      图标: 86,
      考试节点: 109,
      修复: 301,
      战略实现: 0,
      功能: 120,
      测试: 113,
      文档: 10,
      工程: 23,
      其他: 166,
    });
    expect(data.covered).toBe(928);
  });

  it("每聚类代表 commit 是窗口内最新 3 笔", () => {
    const { data } = fixtureDraft();
    expect(clusterByName(data, "修复").reps.map((r) => r.hash.slice(0, 8))).toEqual(["8e876a02", "a1c470fe", "6cc59533"]);
    expect(clusterByName(data, "图标").reps.map((r) => r.hash.slice(0, 8))).toEqual(["081139b3", "36c8d9f2", "23195b0d"]);
    expect(clusterByName(data, "考试节点").reps.map((r) => r.hash.slice(0, 8))).toEqual(["1e8f69aa", "3cda21e2", "c003eda5"]);
    expect(clusterByName(data, "其他").reps.map((r) => r.hash.slice(0, 8))).toEqual(["eac3bea1", "97ab63c7", "e81be591"]);
  });

  it("数据文件前后对照与标准答案一致", () => {
    const { data } = fixtureDraft();
    expect(data.baseRevShort).toBe("02c0fd1b");
    expect(data.headRevShort).toBe("8e876a02");
    expect(data.countsBefore).toEqual({ sites: 335, pricing: 342, examNodes: 11 });
    expect(data.countsAfter).toEqual({ sites: 388, pricing: 394, examNodes: 46 });
  });

  it("规则①检出 14 项，与标准答案逐项一致", () => {
    const { data } = fixtureDraft();
    expect(data.expired1).toHaveLength(14);
    expect(data.expired1.map((e: any) => e.text)).toEqual([
      "军队文职（jundui-wenzhi）/缴费（end=2026-11-18 已过 2026-11-22）",
      "京考（jingkao）/报名（end=2026-11-18 已过 2026-11-22）",
      "成考（chengkao）/江西成绩查询（end=2026-11-18 已过 2026-11-22）",
      "成考（chengkao）/江西成绩复核（end=2026-11-20 已过 2026-11-22）",
      "成考（chengkao）/广东成绩查询（end=2026-11-18 已过 2026-11-22）",
      "成考（chengkao）/广东成绩复核（end=2026-11-20 已过 2026-11-22）",
      "成考（chengkao）/新疆成绩查询（end=2026-11-18 已过 2026-11-22）",
      "成考（chengkao）/新疆成绩复核（end=2026-11-20 已过 2026-11-22）",
      "成考（chengkao）/山西成绩复核（end=2026-11-20 已过 2026-11-22）",
      "成考（chengkao）/海南成绩查询（end=2026-11-19 已过 2026-11-22）",
      "成考（chengkao）/天津成绩复核（end=2026-11-19 已过 2026-11-22）",
      "江苏自考（jiangsu-zikao）/成绩查询（end=2026-11-18 已过 2026-11-22）",
      "江苏自考（jiangsu-zikao）/成绩复核（end=2026-11-20 已过 2026-11-22）",
      "广东自考（guangdong-zikao）/成绩查询（end=2026-11-18 已过 2026-11-22）",
    ]);
  });

  it("规则②为 0 项（最老待 PoC 仅 3 天）；规则③ Batch 0 无变化", () => {
    const { data } = fixtureDraft();
    expect(data.expired2).toEqual([]);
    expect(data.stateStale).toBe(false);
    expect(data.stateLastUpdated).toBe("2026-11-22");
    const batch0 = (data.preconditions as any[]).find((p: any) => p.item.id === "S20");
    if (!batch0) throw new Error("前置条件缺失：S20");
    expect(batch0.current).toBe("未合入");
    expect(batch0.changed).toBe(false);
    expect(data.preconditions.filter((p: any) => p.changed)).toEqual([]);
  });

  it("状态表 32 项：过门禁 8 / 待PoC 12 / 未通过 12", () => {
    const { data } = fixtureDraft();
    expect(data.stateItems).toHaveLength(32);
    const byCat: Record<string, number> = {};
    for (const it of data.stateItems) byCat[it.category] = (byCat[it.category] ?? 0) + 1;
    expect(byCat).toEqual({ 过门禁: 8, 待PoC: 12, 未通过: 12 });
  });

  it("草稿头强制标注未核实；每条断言带来源", () => {
    const { markdown } = fixtureDraft();
    expect(markdown).toContain("草稿，未经人工核实，不得引用");
    expect(markdown).toContain("## ① 本周合入清单");
    expect(markdown).toContain("## ② 方案复核表");
    expect(markdown).toContain("## ③ 过期项检测");
    expect(markdown).toContain("## ④ 30/90/180 天路线图 diff 草稿");
    expect(markdown).toContain("## ⑤ 待人工拍板的裁决清单");
    // §1–§5 的每条列表行须带来源（commit hash / 文件路径 / 报告名 / 未核实）
    const bulletLines = markdown.split("\n").filter((l: string) => l.startsWith("- ") || l.startsWith("  - "));
    expect(bulletLines.length).toBeGreaterThan(50);
    const withoutSource = bulletLines.filter(
      (l: string) =>
        !/[0-9a-f]{8}/.test(l) &&
        !/\.mjs|\.ts|\.json|\.md/.test(l) &&
        !/strategy-state\.json|strategy-2026|git log|git show|git merge-base/.test(l) &&
        !/未核实/.test(l) &&
        !/无检出|无建议|无待裁决/.test(l),
    );
    expect(withoutSource).toEqual([]);
  });
});

describe("聚类判定", () => {
  it("图标优先于 fix 前缀；考试节点可由文件路径判定", () => {
    expect(classifyCommit("fix(favicon): gemini 图标改走 /brand-icons/gemini.svg", [])).toBe("图标");
    expect(classifyCommit("fix(favorites): a11y 对比度守卫回归——3 处图标色提档", [])).toBe("图标");
    expect(classifyCommit("test(api): U-417 救援补丁", ["apps/web-overlay/src/lib/exam-calendar.ts"])).toBe("考试节点");
    expect(classifyCommit("test(exam): u124 门户备用链断言", [])).toBe("考试节点");
    expect(classifyCommit("feat(strategy): 复盘草稿生成器", [])).toBe("战略实现");
    expect(classifyCommit("fix(plugin-card): U-408 修水合失败", [])).toBe("修复");
    expect(classifyCommit("Merge branch 'evo/jd-link-1622' into main", [])).toBe("其他");
    expect(classifyCommit("U-470: 下架死引擎", [])).toBe("其他");
  });

  it("parseLog：主题为空仍计入，坏行跳过不丢数", () => {
    const commits = parseLog(
      "COMMIT " + "a".repeat(40) + " 2026-11-22 fix(x): ok\napps/a.ts\n" +
        "COMMIT " + "b".repeat(40) + " 2026-11-22 \n" +
        "garbage line\n",
    );
    expect(commits).toHaveLength(2);
    expect(commits[1].subject).toBe("");
    expect(clusterCommits(commits).total).toBe(2);
  });
});

describe("过期检测确定性规则", () => {
  const TS = `
export const EXAMS: ExamInfo[] = [
  {
    id: 'a',
    shortName: '甲考',
    nodes: [
      { label: '已过', detail: 'x', startISO: '2026-11-10', endISO: '2026-11-18' },
      { label: '预计', detail: 'x', startISO: '2026-11-10', endISO: '2026-11-18', estimated: true },
      { label: '未到', detail: 'x', startISO: '2026-11-25', endISO: '2026-11-26' },
    ],
  },
];
`;

  it("estimated 节点不翻过期；节点解析数与 label 计数一致", () => {
    const nodes = parseExamNodes(TS);
    expect(nodes).toHaveLength(3);
    expect(countExamNodes(TS)).toBe(3);
    const expired = detectExpiredRule1(nodes, "2026-11-22");
    expect(expired.map((e: any) => e.text)).toEqual(["甲考（a）/已过（end=2026-11-18 已过 2026-11-22）"]);
  });

  it("规则②：超 14 天无裁决才检出；14 天整不检出", () => {
    const items = [
      { id: "T1", name: "甲", category: "待PoC", status: "未启动", proposedDate: "2026-11-01", source: "x.md" },
      { id: "T2", name: "乙", category: "待PoC", status: "未启动", proposedDate: "2026-11-08", source: "x.md" },
      { id: "T3", name: "丙", category: "待PoC", status: "已冻结", proposedDate: "2026-11-01", source: "x.md" },
    ];
    expect(detectStalePoc(items, "2026-11-22").map((e: any) => e.text)).toEqual([
      "甲（提出 2026-11-01，已 21 天无裁决记录）",
    ]);
    expect(daysBetween("2026-11-08", "2026-11-22")).toBe(14);
  });

  it("规则③：Batch 0 已合入才算变化；引用缺失记未核实", () => {
    const items = [
      { id: "S20", name: "联盟 CPS", category: "过门禁", status: "已冻结", proposedDate: "2026-11-21", source: "x.md", precondition: { kind: "batch0", label: "Batch 0 合入", recordedState: "未合入" } },
    ];
    const merged = checkPreconditions(items, { isBatch0Ancestor: true, batch0RefExists: true });
    expect(merged[0].changed).toBe(true);
    expect(merged[0].current).toBe("已合入");
    const unknown = checkPreconditions(items, { isBatch0Ancestor: false, batch0RefExists: false });
    expect(unknown[0].changed).toBe(false);
    expect(unknown[0].current).toContain("未核实");
  });

  it("状态表超 14 天未更新时草稿顶部告警", () => {
    const { data } = buildDraft({
      fixtureLog: FIXTURE_LOG,
      baseRev: BASE_REV,
      headRev: HEAD_REV,
      asOf: "2026-12-10",
      since: "2026-11-16 00:00:00 +0800",
      until: "2026-11-22 23:59:59 +0800",
      statePath: STATE_PATH,
    });
    expect(data.stateStale).toBe(true);
    expect(data.stateAgeDays).toBe(18);
    expect(renderDraft(data)).toContain("状态表已过期");
  });
});

describe("只读护栏 R5", () => {
  it("源码无网络/写仓库操作：只放行 log/show/rev-list/merge-base", () => {
    const src = readFileSync(SCRIPT, "utf8");
    // 全部 git 调用都经 runGit；提取所有 runGit(["<子命令>" …]) 的子命令，必须在白名单内
    const called = [...src.matchAll(/runGit\(\[\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const sub of called) {
      expect(["log", "show", "rev-list", "merge-base", "rev-parse"]).toContain(sub);
    }
    // rev-parse 只用于 --verify --quiet 查引用是否存在（只读）
    expect(src).toContain('runGit(["rev-parse", "--verify", "--quiet"');
    // 无网络 API、无 shell 直调 git（全部经 execFileSync 的 runGit）
    expect(src).not.toMatch(/fetch\s*\(|axios|XMLHttpRequest|https?:\/\//);
    expect(src.match(/execFileSync\(/g)?.length).toBe(1);
    expect(src).not.toMatch(/execSync|spawnSync|spawn\(/);
    expect(() => runGit(["fetch", "origin"], process.cwd())).toThrow(/拒绝执行非只读/);
    expect(() => runGit(["push"], process.cwd())).toThrow(/拒绝执行非只读/);
    expect(() => runGit(["commit", "-m", "x"], process.cwd())).toThrow(/拒绝执行非只读/);
  });

  it("计数函数不依赖网络、不写文件", () => {
    expect(countNavigationSites(JSON.stringify({ navigationItems: [{ items: [1, 2] }, { subCategories: [{ items: [3] }] }] }))).toBe(3);
    expect(countPricingKeys(JSON.stringify({ a: 1, b: 2 }))).toBe(2);
  });

  it("CLI --no-write 运行前后 git status 不变；--out 只写指定的一份草稿", () => {
    const before = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    const res = spawnSync(process.execPath, [SCRIPT, "--fixture-log", FIXTURE_LOG, "--base-rev", BASE_REV, "--head-rev", HEAD_REV, "--as-of", "2026-11-22", "--since", "2026-11-16 00:00:00 +0800", "--until", "2026-11-22 23:59:59 +0800", "--state", STATE_PATH, "--no-write"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("草稿，未经人工核实，不得引用");
    const after = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    expect(after).toBe(before);

    const dir = mkdtempSync(join(tmpdir(), "weekly-review-"));
    try {
      const out = join(dir, "draft.md");
      const res2 = spawnSync(process.execPath, [SCRIPT, "--fixture-log", FIXTURE_LOG, "--base-rev", BASE_REV, "--head-rev", HEAD_REV, "--as-of", "2026-11-22", "--since", "2026-11-16 00:00:00 +0800", "--until", "2026-11-22 23:59:59 +0800", "--state", STATE_PATH, "--out", out], { encoding: "utf8" });
      expect(res2.status).toBe(0);
      const written = readFileSync(out, "utf8");
      expect(written).toContain("## ⑤ 待人工拍板的裁决清单");
      const after2 = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
      expect(after2).toBe(before);
      // 草稿文件本身不在仓库里（写到了 /tmp），仓库仍干净
      expect(after2).not.toContain("weekly-review-draft-2026-11-22.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未知参数与非法 --as-of 以退出码 2 失败", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    const res2 = spawnSync(process.execPath, [SCRIPT, "--as-of", "11/22/2026"], { encoding: "utf8" });
    expect(res2.status).toBe(2);
  });
});
