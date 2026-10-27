/**
 * 契约守护：`docs/contracts/probe.json` 与 `probe-policy.ts` 必须逐项一致。
 *
 * 为什么需要它：探活结论会被面板、Chrome 扩展、Raycast、MCP 四个消费方各自翻译成文案。
 * 只要有一方漏了新档位（例如加了 `unverified` 却没加映射），就会出现
 * 「面板说未能验证、扩展说不可达」这种同一事实两套说法。
 * 让契约文件成为可被外部读取的事实源，并由测试锁住它和代码不漂移。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOT_BLOCKED_STATUSES,
  CONFIRMED_GONE_STATUSES,
  outcomeToCandidateGrade,
  outcomeToHttpVerdict,
  type ProbeOutcomeKind,
} from "../src/probe-policy.ts";

const KINDS: ProbeOutcomeKind[] = ["ok", "blocked", "parked", "dead", "unverified", "server-error"];

async function loadContract() {
  const raw = await readFile(join(process.cwd(), "docs/contracts/probe.json"), "utf8");
  return JSON.parse(raw) as {
    outcomeKinds: string[];
    candidateGrades: string[];
    botBlockedStatuses: number[];
    confirmedGoneStatuses: number[];
    kindToGrade: Record<string, string>;
    kindToHttpVerdict: Record<string, string | null>;
  };
}

describe("探活契约文件", () => {
  it("六类结论与代码一致（顺序也一致，便于消费方按序渲染）", async () => {
    const contract = await loadContract();
    expect(contract.outcomeKinds).toEqual(KINDS);
  });

  it("机器拦截与确定失效的状态码表一致", async () => {
    const contract = await loadContract();
    expect(contract.botBlockedStatuses).toEqual([...BOT_BLOCKED_STATUSES]);
    expect(contract.confirmedGoneStatuses).toEqual([...CONFIRMED_GONE_STATUSES]);
  });

  it("每个结论的候选档位与深检结论都在契约里，且与代码一致", async () => {
    const contract = await loadContract();
    for (const kind of KINDS) {
      expect(contract.kindToGrade[kind]).toBe(outcomeToCandidateGrade(kind));
      expect(contract.kindToHttpVerdict[kind] ?? null).toBe(outcomeToHttpVerdict(kind));
    }
  });

  it("契约里不出现代码中不存在的档位（防止旧值残留误导消费方）", async () => {
    const contract = await loadContract();
    const codeGrades = new Set(KINDS.map((k) => outcomeToCandidateGrade(k)));
    for (const grade of contract.candidateGrades) {
      expect(codeGrades.has(grade as never)).toBe(true);
    }
  });
});
