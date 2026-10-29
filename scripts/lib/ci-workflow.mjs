/**
 * `.github/workflows/ci.yml` 的作业 / 聚合关系解析（纯函数）。
 *
 * 为什么单独成库：聚合关系的读取现在有两个消费者——
 *   - scripts/check-ci-gate.mjs：聚合**对不对**（每个作业都在 needs 里、结果被逐个读取）；
 *   - scripts/check-gates-registry.mjs：门禁**清单全不全**（每个 CI 作业都在 gates.json 登记）。
 * 两处各写一份正则，迟早会出现「一个说 9 个作业、一个说 10 个」的分裂；解析只留一份。
 *
 * 解析口径与 check-ci-gate 原先的实现逐条一致（缩进 2 个空格的顶层键即作业名）；
 * 手动/定时作业 = `if:` 里声明了 workflow_dispatch / schedule。
 */

export function isManualOnlyJob(block) {
  const ifLine = block.match(/^\s{4}if:\s*(.+)$/m);
  if (!ifLine) return false;
  const cond = ifLine[1];
  return cond.includes("workflow_dispatch") || cond.includes("schedule");
}

/**
 * @returns {{
 *   hasJobs: boolean,
 *   jobs: {name:string, block:string, manualOnly:boolean}[],
 *   needs: string[], needsFound: boolean, ciPassedBlock: string|null,
 *   aggregated: string[], manualOnly: string[]
 * }}
 */
export function parseWorkflow(source) {
  const text = String(source ?? "");
  const result = {
    hasJobs: false,
    jobs: [],
    needs: [],
    needsFound: false,
    ciPassedBlock: null,
    aggregated: [],
    manualOnly: [],
  };

  const start = text.indexOf("\n  ci-passed:");
  if (start >= 0) {
    const rest = text.slice(start + 1);
    const nextJob = rest.slice(1).search(/\n {2}[a-zA-Z0-9_-]+:\n/);
    result.ciPassedBlock = nextJob >= 0 ? rest.slice(0, nextJob + 1) : rest;
    const needsMatch = result.ciPassedBlock.match(/needs:\s*\[([^\]]*)\]/);
    result.needsFound = Boolean(needsMatch);
    result.needs = needsMatch
      ? needsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  }

  const jobsIndex = text.indexOf("\njobs:");
  if (jobsIndex < 0) return result;
  result.hasJobs = true;

  const jobsBody = text.slice(jobsIndex);
  const matches = [...jobsBody.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)];
  result.jobs = matches.map((m, i) => {
    const from = m.index ?? 0;
    const to = i + 1 < matches.length ? (matches[i + 1].index ?? jobsBody.length) : jobsBody.length;
    const block = jobsBody.slice(from, to);
    return { name: m[1], block, manualOnly: isManualOnlyJob(block) };
  });

  for (const job of result.jobs) {
    if (job.name === "ci-passed") continue;
    if (result.needs.includes(job.name)) result.aggregated.push(job.name);
    else if (job.manualOnly) result.manualOnly.push(job.name);
  }
  return result;
}
