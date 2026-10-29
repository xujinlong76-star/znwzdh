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

/** 手动/定时作业：`if:` 里声明了 workflow_dispatch 或 schedule */
export function isManualOnlyJob(block) {
  const ifLine = block.match(/^\s{4}if:\s*(.+)$/m);
  if (!ifLine) return false;
  const cond = ifLine[1];
  return cond.includes("workflow_dispatch") || cond.includes("schedule");
}

/**
 * 级联红：**一个根因只留一处红**。
 *
 * 事故形状（2026-10-29，run 40835496871）：typecheck 红 → 测试步骤被跳过 → junit 不存在
 * → 红灯光谱/红灯台账/upload-artifact 三步仍按 `!cancelled()` 执行，「缺 junit」再判一次红。
 * 一处根因变四处红：真正的根因被淹没，而「遥测链路断了」这条本应刺眼的告警也变成狼来了。
 *
 * 判据不限于 junit（2026-10-29 第二形态）：test-web 的「首屏预算账」带 `if: always()`，
 * lint 一红 → build 被跳过 → `.next` 不存在 → 账脚本与它那步 `if-no-files-found: error`
 * 的上传各自再红一次。凡是**读上游产物、且产物缺失时会把自己判红**的收尾步骤都算级联源，
 * 所以判据是「锚点步骤 outcome != 'skipped'」而不是「锚点必须是测试步骤」。
 *
 * 反向豁免：`if-no-files-found: warn|ignore` 的上传缺文件也不会自己判红，
 * 它不是级联源（硬要求它挂守卫，等于让门禁去管一件不会出事的事）。
 *
 * @param {string} jobBlock 单个作业的 YAML 片段
 * @param {{anchor: string, products: RegExp[]}} rule
 *   anchor   —— 产物的生产者步骤 id（它被跳过 ⇒ 根因在上游，这里不掺和）
 *   products —— 认定「这一步正在读该产物」的正则集合
 * @returns {string[]} 问题清单（空数组 = 通过）
 */
export function cascadeProblems(jobBlock, { anchor, products }) {
  const problems = [];
  const steps = String(jobBlock).split(/\n(?= {6}- )/);
  const anchorRe = new RegExp(`^\\s*id: ${anchor}\\s*$`, "m");
  if (!steps.some((step) => anchorRe.test(step))) {
    problems.push(
      `找不到产物生产者步骤 id: ${anchor}——级联判据挂在它上面，改名/删除会让守卫静默失效`,
    );
  }
  const guardRe = new RegExp(
    `if:\\s*\\$\\{\\{[^\\n]*steps\\.${anchor}\\.outcome != 'skipped'`,
  );
  for (const step of steps) {
    // 判定前先剥掉 YAML 注释行：注释里解释口径时会顺带写出 `upload-artifact`、
    // `junit-summary.mjs` 这些字样，直接整块正则会把**生产者步骤自己**误判成消费者
    // （2026-10-29 实测：test-sqlite 的 vitest 步骤带着解释注释，被判成
    // 「没有以 steps.vitest.outcome != 'skipped' 为条件」——而它正是产出 junit 的那一步）。
    const code = step
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    // 生产者不是消费者：它的 run 行里本来就带着产物文件名（--outputFile.junit=junit-…）。
    if (anchorRe.test(code)) continue;
    if (!products.some((re) => re.test(code))) continue;
    if (/if-no-files-found:\s*(?:warn|ignore)/.test(code)) continue;
    if (guardRe.test(code)) continue;
    const label =
      step.match(/- name: ([^\n]+)/)?.[1] ??
      step.match(/\n\s+name: ([^\n]+)/)?.[1] ??
      "产物读取步骤";
    problems.push(
      `「${label}」没有以 steps.${anchor}.outcome != 'skipped' 为条件：` +
        "生产者被上游（typecheck/安装/lint）跳过时它仍会跑，产物缺失又判一次红——一次根因多处红",
    );
  }
  return problems;
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
