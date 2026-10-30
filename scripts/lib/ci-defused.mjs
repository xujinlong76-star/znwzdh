/**
 * 「撤防」账：门禁步骤没跑成，必须在作业里看得见（纯函数 + 登记表，无 IO）。
 *
 * 为什么需要（2026-10-29→30 实战）：GitHub 的默认条件是
 * `success()` —— **上一步红 = 后面每一步 skipped**，而 skipped 不判红。
 * 于是「作业结论 = 绿/红一处」这种读数只说明「没新增红」，不说明「门禁判过」。
 * 实际吃过的一次：首屏预算自 10-29 起常驻红，紧跟其后的
 * `node scripts/check-isr-routes.mjs` 每轮被整步跳过，连着几天没判过任何东西，
 * 而近几轮的结论一直写成「前端门禁只有预算问题」——那句结论不成立。
 * `11108bf2` 修的是**那一步的守卫**（改成 build 成功就照跑）；本文件管的是
 * **其余没跑成的步骤必须显式记账**，因为守卫是逐条挂的，撤防是整片发生的。
 *
 * 口径边界：
 *   - `steps` 上下文只包含**写了 `id:` 的步骤** ⇒ 没 id 的门禁步骤看不见，
 *     所以登记表覆盖面判据（defusedCoverageProblems）要求门禁形状的步骤必须有 id；
 *   - 挡住某一步的那一步也可能没有 id（checkout / setup-node / vendor）⇒
 *     读数里诚实写成「指不出是谁挡的」，不猜；
 *   - 步骤在 `toJSON(steps)` 里的**出现顺序 = 定义顺序**（GitHub 按步骤顺序生成这个对象），
 *     「第一个红的 tracked 步骤」因此可以当根因；顺序若变，最多是根因点名不准，
 *     不会漏报撤防本身。
 *
 * 只报不拦（rc 恒 0，除非显式 `--strict`）：判红会把「一次根因多处红」请回来，
 * 那正是 CASCADE_RULES 花两轮压下去的东西。它拦的是**接线**（check-ci-gate 第 7 项），
 * 不是运行结果。
 */

import { splitJobSteps, stripYamlCommentLines } from "./ci-workflow.mjs";

/**
 * 「这一步在判定对错」的形状：命令本身是门禁脚本 / 类型检查 / lint / 构建 / 测试。
 * 刻意不含安装、vendor、seed、启动服务这类**准备步骤**——它们红不红由作业结论说话，
 * 它们的价值在本库里是「挡住别人的那一步」（env 登记表）。
 */
export const GATE_STEP_RE =
  /(?:node\s+scripts\/check-[a-z0-9-]+\.mjs)|(?:\btsc\b[^\n]*--noEmit)|(?:\beslint\b)|(?:pnpm run typecheck)|(?:pnpm test)|(?:--filter \S+ build)/;

/** 每个已接入作业的登记表：reporterStepId = 那步 `if: always()` 的读数步骤 */
export const DEFUSED_GATES = [
  {
    job: "test-sqlite",
    reporterStepId: "defused-gates",
    env: [
      { id: "sqlite-install", label: "pnpm install --frozen-lockfile" },
      { id: "sqlite-vendor", label: "vendor 重建 apps/web" },
    ],
    gates: [
      { id: "typecheck", label: "根 typecheck（packages/* + apps/api）" },
      { id: "vitest", label: "单元/接口测试（SQLite，分片）" },
    ],
  },
  {
    job: "test-postgres",
    reporterStepId: "defused-gates",
    env: [{ id: "pg-install", label: "pnpm install --frozen-lockfile" }],
    gates: [
      { id: "pg-suite", label: "跨方言套件（pg-dialect + rollup-pg，带环境守卫）" },
      { id: "pg-bench", label: "标准模式 12 项真实数据库方言基准（pnpm test:pg）" },
    ],
  },
  {
    job: "test-web",
    reporterStepId: "defused-gates",
    env: [
      { id: "web-install", label: "pnpm install --frozen-lockfile" },
      { id: "web-vendor", label: "vendor 重建 apps/web" },
    ],
    gates: [
      { id: "web-typecheck", label: "Web tsc --noEmit" },
      { id: "web-lint", label: "Web eslint" },
      { id: "web-build", label: "next build" },
      { id: "web-budget", label: "首屏预算硬门禁" },
      {
        id: "web-isr",
        label: "ISR 路由硬门禁",
        note: "守卫是 web-build.outcome == 'success'（build 真失败时 .next 是半份产物，读了只判假红）⇒ 它 skipped 说明根因在 build",
      },
    ],
  },
  {
    job: "test-e2e",
    reporterStepId: "defused-gates",
    env: [
      { id: "e2e-install", label: "pnpm install --frozen-lockfile" },
      { id: "e2e-vendor", label: "vendor 重建 apps/web" },
      { id: "e2e-playwright", label: "安装 Playwright Chromium" },
    ],
    gates: [{ id: "e2e", label: "Playwright E2E（分片）" }],
  },
  {
    job: "check-isr-live",
    reporterStepId: "defused-gates",
    // 这个作业的门禁全都挂在一套一次性预览站上（迁移/种子/中枢/next start）。
    // env 因此比别的作业多：它们的红不是「产品红」，而是「检查没跑成」——
    // 根因点名必须指得出是哪一层脚手架塌了（2026-10-23 起吃过 EADDRINUSE、
    // drain 30s 占端口、next-server 的 CWD 三类各一次）。
    env: [
      { id: "isr-install", label: "pnpm install --frozen-lockfile" },
      { id: "isr-vendor", label: "vendor 重建 apps/web" },
      { id: "isr-migrate", label: "中枢迁移 apps/api/src/migrate.ts（仓库根为 CWD）" },
      { id: "isr-seed", label: "种子库 pnpm seed" },
      { id: "isr-fixtures", label: "补门禁自检标签 seed-isr-fixtures（仅一次性 CI 库）" },
      { id: "isr-hub", label: "启动中枢（后台，8787）" },
      { id: "isr-web", label: "启动 Web 产物（next start，CWD 必须是 apps/web）" },
    ],
    gates: [
      { id: "isr-build", label: "next build（构建期给 origin）" },
      { id: "isr-live", label: "ISR 线上抽查 --live（三层契约 + sitemap 族下限）" },
      { id: "isr-linkgraph", label: "站内链接图的 sitemap 族下限" },
      { id: "isr-rate-limit", label: "限流豁免集成检查（小额度中枢四阶段）" },
    ],
  },
  {
    job: "check-web-overlay",
    reporterStepId: "defused-gates",
    env: [
      { id: "overlay-install", label: "pnpm install --frozen-lockfile" },
      { id: "overlay-vendor", label: "vendor 重建 apps/web" },
    ],
    gates: [
      { id: "gate-syntax", label: "check-syntax（TS/TSX 语法）" },
      { id: "gate-deps-integrity", label: "check-deps-integrity（依赖入口可解析）" },
      { id: "gate-video-scope", label: "typecheck-video-scope（视频作用域类型）" },
      { id: "gate-overlay", label: "check-web-overlay（覆写层与镜像同源）" },
      { id: "gate-core-mirrors", label: "sync-core-mirrors --check（core 镜像一致）" },
      { id: "gate-upstream-ref", label: "check-upstream-ref（上游 ref 存在）" },
      { id: "gate-extensions", label: "check-extensions（扩展清单 schema）" },
    ],
  },
  {
    // 这两道的命令形状不在 GATE_STEP_RE 里（`docker build` / `pnpm ... audit` 都不是
    // check-*.mjs 那一类），所以覆盖面判据推不出它们——登记是人为判断：
    // 它们是这两个作业里**唯一**的判定，红会吞掉同作业后面的判定。
    job: "docker-smoke",
    reporterStepId: "defused-gates",
    env: [],
    gates: [
      { id: "docker-api", label: "docker build Dockerfile.api" },
      { id: "docker-web", label: "docker build Dockerfile.web" },
    ],
  },
  {
    job: "audit",
    reporterStepId: "defused-gates",
    env: [{ id: "audit-install", label: "pnpm install --frozen-lockfile" }],
    gates: [
      { id: "audit-full", label: "全量依赖审计（含 dev，--audit-level high 阻断）" },
      { id: "audit-prod", label: "生产面依赖审计（--prod）" },
    ],
  },
];

/** @returns {object|null} 按作业名取登记表 */
export function defusedEntryFor(jobName) {
  return DEFUSED_GATES.find((e) => e.job === jobName) ?? null;
}

/** 登记表里被盯住的步骤（env 在前，门禁在后：同一份读数里两者都要能点名） */
export function trackedSteps(entry) {
  return [
    ...(entry.env ?? []).map((s) => ({ ...s, kind: "env" })),
    ...(entry.gates ?? []).map((s) => ({ ...s, kind: "gate" })),
  ];
}

function outcomeOf(stepValue) {
  if (!stepValue || typeof stepValue !== "object") return null;
  // conclusion 优先：带 `continue-on-error: true` 的步骤 outcome=failure 而 conclusion=success，
  // 而「会不会挡住后面」只由 conclusion 决定（runner 按 if 条件的等价物跳过步骤）。
  // 拿 outcome 当判据会把「允许失败」的步骤点成根因——它其实一路放行。
  // outcome 只作兜底：夹具与旧读数可能只给 outcome。
  return String(stepValue.conclusion ?? stepValue.outcome ?? "").trim() || null;
}

function hasStepId(stepBlock, id) {
  return new RegExp(`^\\s*id:\\s*${id}\\s*$`, "m").test(stepBlock);
}

/**
 * 从 `toJSON(steps)` 解出的映射里算出「哪些门禁没跑成 + 是谁挡的」。
 *
 * @param {{entry:object, conclusions:object}} input
 *   conclusions —— GitHub 的 steps 上下文（`{ "<id>": { outcome, conclusion } }`）
 * @returns {{defused:object[], failed:object[], blocker:object|null, ran:string[], tracked:string[]}}
 *   defused[].outcome：'skipped' | 'cancelled' | 'absent'（登记表有、上下文里没有 = id 被改名/删除）
 *   判据一律取 conclusion（没有该字段才回退 outcome）：`continue-on-error` 的步骤
 *   outcome=failure 而 conclusion=success，用 outcome 会把放行的一步点成根因。
 *   failed：跑过并判红的门禁——它不是撤防，它是红（由那一步自己负责，这里只拿来点根因）
 *   blocker.kind：'failure' | 'cancelled' | 'unknown'（挡住它的步骤没有 id，读不出来）
 */
export function findDefused({ entry, conclusions }) {
  const map = conclusions && typeof conclusions === "object" ? conclusions : {};
  const tracked = trackedSteps(entry);
  const defused = [];
  const failed = [];
  const ran = [];

  for (const step of tracked) {
    const value = map[step.id];
    if (value === undefined) {
      // 登记的 id 在上下文里根本不存在。作业没这步（改名/删除）⇒ 也算撤防：
      // 「撤防不无声」若只覆盖 skipped，删掉那一步就从账上消失了。
      defused.push({ ...step, outcome: "absent" });
      continue;
    }
    const outcome = outcomeOf(value);
    if (outcome === "skipped" || outcome === "cancelled") {
      defused.push({ ...step, outcome });
      continue;
    }
    if (outcome === "failure") {
      failed.push({ ...step, outcome });
      continue;
    }
    ran.push(step.id);
  }

  // 根因：steps 上下文里**第一个**红的步骤（JSON 出现顺序 = 步骤定义顺序）。
  // 扫描范围比 tracked 更宽：没进登记表、但写了 id 的步骤（如 test-sqlite 末尾的
  // `pnpm build`）照样能当根因点名——登记表管「该跑的没跑」，根因管「谁挡的路」。
  // 只红的门禁也在这里：只红一道门禁时它就是根因，排它后面的才算撤防，两者同屏才读得懂。
  let blocker = null;
  for (const id of Object.keys(map)) {
    const outcome = outcomeOf(map[id]);
    if (outcome !== "failure" && outcome !== "cancelled") continue;
    const step = tracked.find((s) => s.id === id);
    blocker = {
      id,
      label: step?.label ?? id,
      kind: outcome === "cancelled" ? "cancelled" : "failure",
    };
    break;
  }
  const gateCount = defused.filter((d) => d.kind === "gate").length;
  if (!blocker && gateCount > 0) {
    blocker = { id: null, label: "没有 id 的上游步骤（checkout / setup-node / 作业被取消）", kind: "unknown" };
  }

  return { defused, failed, blocker, ran, tracked: tracked.map((s) => s.id) };
}

/**
 * 接线对不对：登记表说的东西在 ci.yml 里必须真的存在，否则「以为在记账，其实没跑」。
 *
 * @param {string} jobBlock 单个作业的 YAML 片段
 * @param {{job:string, reporterStepId:string, env:object[], gates:object[]}} entry
 * @returns {string[]} 问题清单（空 = 通过）
 */
export function defusedWiringProblems(jobBlock, entry) {
  const problems = [];
  const steps = splitJobSteps(stripYamlCommentLines(jobBlock));
  const indexOf = (id) => steps.findIndex((s) => hasStepId(s, id));

  if (!String(entry?.job ?? "").trim()) problems.push("登记表条目缺 job");
  if (!String(entry?.reporterStepId ?? "").trim()) problems.push(`${entry?.job}：登记表缺 reporterStepId`);

  for (const step of [...(entry.env ?? []), ...(entry.gates ?? [])]) {
    if (!String(step.label ?? "").trim()) {
      problems.push(`${entry.job}: 步骤 ${step.id} 没有 label——读数里点不出它是哪道门禁`);
    }
  }
  const ids = [...(entry.env ?? []), ...(entry.gates ?? [])].map((s) => s.id);
  const duplicate = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicate.length > 0) {
    problems.push(`${entry.job}: 登记表里步骤 id 重复（${[...new Set(duplicate)].join("、")}）——读数会把两件事混成一件`);
  }

  const reporter = indexOf(entry.reporterStepId);
  if (reporter < 0) {
    problems.push(
      `${entry.job}: 找不到读数步骤 id: ${entry.reporterStepId}——撤防账没接线，登记表只是愿望`,
    );
    return problems;
  }
  const reporterBlock = steps[reporter];
  // 必须是 always()：默认条件下这一步自己就会被上游跳过，那笔账永远不会出（最讽刺的失效形状）
  if (!/if:\s*(?:\$\{\{\s*)?always\(\)/.test(reporterBlock)) {
    problems.push(
      `${entry.job}: 读数步骤 ${entry.reporterStepId} 的条件不是 always()——上游一红它自己也 skipped，撤防账只在平安的时候才出`,
    );
  }
  if (!/ci-defused-gates\.mjs/.test(reporterBlock)) {
    problems.push(`${entry.job}: 读数步骤没有执行 scripts/ci-defused-gates.mjs`);
  }
  if (!new RegExp(`--job\\s+${entry.job}\\b`).test(reporterBlock)) {
    problems.push(`${entry.job}: 读数步骤没有传 --job ${entry.job}——脚本会报「读不到作业名」`);
  }
  if (!/toJSON\(steps\)/.test(reporterBlock)) {
    problems.push(
      `${entry.job}: 读数步骤没有把 toJSON(steps) 传给脚本——没有结论输入，账只能报「读不到」`,
    );
  }

  for (const id of ids) {
    const at = indexOf(id);
    if (at < 0) {
      problems.push(`${entry.job}: 登记表里的 id: ${id} 在作业里找不到——改名或删除会让这道门禁从撤防账上消失`);
      continue;
    }
    if (at > reporter) {
      problems.push(
        `${entry.job}: id: ${id} 排在读数步骤之后——它 skipped 时账已经打完了，永远报不出它`,
      );
    }
  }
  return problems;
}

/**
 * 登记表自身的覆盖面（判据从 YAML 推出来，不等事故）：
 * **门禁形状的步骤必须有 id 且必须进登记表**，否则它能整步 skipped 而没人报得出名字。
 *
 * 豁免：`continue-on-error: true` 的步骤不登记——它红了也不会挡住别人（红被吞掉），
 * 也不会因上游而撤防自己的判定，硬要求登记等于让门禁管一件不会出事的事。
 * 今天的 test-sqlite 后端 lint 就是这一类（命令形状另说）。
 * 真给它补了 id 也不会读错：`outcomeOf` 取 conclusion（那类步骤 outcome=failure
 * 而 conclusion=success），所以它既不进 failed 也不会被点成根因。
 * 读数步骤自己也不算门禁（它只报账）。
 */
export function defusedCoverageProblems(jobBlock, entry) {
  const problems = [];
  const steps = splitJobSteps(stripYamlCommentLines(jobBlock));
  const registered = new Set([...(entry.env ?? []), ...(entry.gates ?? [])].map((s) => s.id));

  for (const step of steps) {
    if (hasStepId(step, entry.reporterStepId)) continue;
    if (/continue-on-error:\s*true/.test(step)) continue;
    const inline = step.match(/^\s*-?\s*run:\s*([^\n]+)/m)?.[1] ?? "";
    if (!inline.trim()) continue;
    // `run: |` 的多行脚本里才算得了门禁（test-e2e 的 Playwright 就是这种写法）；
    // 单行 `run:` 只按那一行判，免得步骤名/解释注释里的字样被当成命令本身
    const isBlockScalar = /^[|>]/.test(inline.trim());
    const haystack = isBlockScalar ? step : inline;
    if (!GATE_STEP_RE.test(haystack)) continue;
    // 块标量的 `run:` 那行只有 `|`，拿它当命令展示等于没展示——用真正是那类命令的一行
    const cmd = (isBlockScalar ? (step.split("\n").find((line) => GATE_STEP_RE.test(line)) ?? inline) : inline).trim();
    const id = step.match(/^\s*id:\s*([A-Za-z0-9_-]+)\s*$/m)?.[1];
    if (!id) {
      problems.push(
        `门禁步骤「${cmd}」没有 id：steps 上下文只包含写了 id 的步骤，` +
          `它被上游跳过时报不出名字——请补 id 并登进 scripts/lib/ci-defused.mjs 的 ${entry.job} 条目`,
      );
      continue;
    }
    if (!registered.has(id)) {
      problems.push(
        `门禁步骤 ${id}（「${cmd}」）没登进 ${entry.job} 的撤防登记表——` +
          "它 skipped 时读数里不会有它，撤防又变回无声",
      );
    }
  }
  return problems;
}
