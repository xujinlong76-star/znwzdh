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

import { parseWorkflow, splitJobSteps, stripYamlCommentLines } from "./ci-workflow.mjs";

/**
 * 「这一步在判定对错」的形状：命令本身是门禁脚本 / 类型检查 / lint / 构建 / 测试。
 * 刻意不含安装、vendor、seed、启动服务这类**准备步骤**——它们红不红由作业结论说话，
 * 它们的价值在本库里是「挡住别人的那一步」（env 登记表）。
 */
export const GATE_STEP_RE =
  /(?:node\s+scripts\/check-[a-z0-9-]+\.mjs)|(?:\btsc\b[^\n]*--noEmit)|(?:\beslint\b)|(?:pnpm run typecheck)|(?:pnpm test)|(?:--filter \S+ build)/;

/**
 * 「整前端类型判定」的唯一落点（2026-10-30 实测，run131）。
 *
 * 背景：`apps/web-overlay/next.config.js:44`（及镜像 `apps/web/next.config.js:44`）写着
 * `typescript: { ignoreBuildErrors: true }`，于是 `next build` 不再做内置类型检查。
 * 后果不是「构建会红」，而是**别处的绿灯不再蕴含类型过**：同 commit 的
 * `前端门禁（Web typecheck / lint / build）=failure` 那一轮（adf13b3a / d544274e 直证，
 * 8 条 error TS 全在 HarvestModal.tsx:238-247），线上 ISR 抽查、镜像冒烟构建、
 * Playwright 两个分片、覆盖层与扩展规范性检查**全部 success**——它们读的产物和源码
 * 都在类型断裂的分支上。根 `pnpm run typecheck` 只覆盖 @navhub/*（packages/* + apps/api），
 * 前端全量 tsc 只有 ci.yml 里 `pnpm --filter navsphere exec tsc --noEmit` 那一处。
 *
 * 因此：凡「重建 / 构建 / 启动 / 打包前端产物」而自己没有整前端 tsc 的作业，
 * 它的绿必须带上这句可信度声明。判据从 YAML 推（下面两条正则），不靠事故发现。
 */
export const FRONTEND_TYPECHECK_AUTHORITY = { job: "test-web", stepId: "web-typecheck" };

/** 会重建/构建/启动/打包前端产物的命令形状（vendor 底座、next build、next start、镜像里的 Dockerfile.web） */
export const WEB_PRODUCT_STEP_RE = /vendor-web\.mjs|--filter navsphere build|next start|Dockerfile\.web/;

/** 真正「判整前端类型」的那一条：`pnpm --filter <web 包> exec tsc …`（根 typecheck 不算，它只覆盖 @navhub/*） */
export const FRONTEND_TSC_STEP_RE = /--filter\s+\S+\s+exec\s+tsc\b/;

/** 从 YAML 判定：这个作业依赖别的作业的类型结论 */
export function reliesOnForeignTypecheck(jobBlock, jobName) {
  // 必须剥注释再判：ci.yml 的说明性注释里满是「next start」「vendor 重建 apps/web」这类字样，
  // 不剥就会把只跑 `pnpm audit` 的作业也算成「会构建前端产物」（同仓先例：级联红判定前先剥 YAML 注释）。
  const block = stripYamlCommentLines(String(jobBlock ?? ""));
  if (jobName === FRONTEND_TYPECHECK_AUTHORITY.job) return false;
  return WEB_PRODUCT_STEP_RE.test(block) && !FRONTEND_TSC_STEP_RE.test(block);
}

/** 账里那句可信度声明（写侧与读侧共用一份，改文案只改这里） */
export function typeTrustNoteText(trust) {
  if (!trust?.dependsOnJob || !trust?.dependsOnStepId) return "";
  return `可信度：本作业不判整前端类型——next build 的内置类型检查被 ignoreBuildErrors 关掉，全量判定只在 ${trust.dependsOnJob} 的 ${trust.dependsOnStepId}`;
}

const TYPE_TRUST_NOTE_RE = /不判整前端类型[\s\S]*?全量判定只在 ([A-Za-z0-9_.-]+) 的 ([A-Za-z0-9_.-]+)/;

/**
 * 可信度声明的正反两向对账（判据全部从 YAML + next.config 推出，漏一边就报一条）。
 *
 * @param {object} input
 *   @param {string} input.jobBlock 该作业的 YAML 片段
 *   @param {object} input.entry 撤防登记表条目
 *   @param {boolean} input.ignoreBuildErrors next.config 里 typescript.ignoreBuildErrors 是否仍为 true
 * @returns {string[]}
 */
export function typeTrustProblems({ jobBlock, entry, ignoreBuildErrors }) {
  const problems = [];
  const job = entry?.job;
  const block = stripYamlCommentLines(String(jobBlock ?? ""));
  const trust = entry?.typeTrust;

  // `self` 是另一种声明：这个作业就是那唯一一处整前端 tsc 的宿主。
  // 它必须贴在权威作业上、且作业里真的还有那条命令——否则 5 道依赖它的作业指的是一个不存在的位置。
  if (trust?.self) {
    if (job !== FRONTEND_TYPECHECK_AUTHORITY.job) {
      problems.push(
        `${job}: 登记了 typeTrust:{self:true}，但全仓唯一的整前端 tsc 在 ${FRONTEND_TYPECHECK_AUTHORITY.job}——` +
          "要么把类型判定挪回来，要么把权威位置和这张表一起改掉",
      );
    }
    if (!FRONTEND_TSC_STEP_RE.test(block)) {
      problems.push(
        `${job}: 登记了 typeTrust:{self:true}，作业里却找不到 pnpm --filter … exec tsc——` +
          "那句「本作业含整前端类型判定」已经站不住",
      );
    }
    return problems;
  }
  if (job === FRONTEND_TYPECHECK_AUTHORITY.job) {
    problems.push(
      `${FRONTEND_TYPECHECK_AUTHORITY.job}: 撤防登记表没有 typeTrust:{self:true}——` +
        "5 道作业的可信度都指向它，权威位置本身必须被钉住",
    );
  }

  const derived = reliesOnForeignTypecheck(block, job);
  const declared = Boolean(trust);

  if (derived && !declared) {
    problems.push(
      `${job}: 这个作业会重建/构建/启动前端产物，自己却没有整前端 tsc（类型判定只在 ` +
        `${FRONTEND_TYPECHECK_AUTHORITY.job} 的 ${FRONTEND_TYPECHECK_AUTHORITY.stepId}），` +
        "登记表里却没带 typeTrust——它的绿会被读成「类型也过了」，而 ignoreBuildErrors 让这个推论不成立",
    );
  }
  if (declared && !derived) {
    problems.push(
      `${job}: 登记表带了 typeTrust，但作业里已经能找到整前端 tsc（或它根本不碰前端产物）——` +
        "那句「本作业不判整前端类型」成了假话，请把 typeTrust 摘掉",
    );
  }
  if (declared) {
    if (trust.dependsOnJob !== FRONTEND_TYPECHECK_AUTHORITY.job || trust.dependsOnStepId !== FRONTEND_TYPECHECK_AUTHORITY.stepId) {
      problems.push(
        `${job}: typeTrust 指向 ${trust.dependsOnJob}/${trust.dependsOnStepId}，而全仓唯一的整前端 tsc 是 ` +
          `${FRONTEND_TYPECHECK_AUTHORITY.job}/${FRONTEND_TYPECHECK_AUTHORITY.stepId}——指向别处等于没指`,
      );
    }
    if (!ignoreBuildErrors) {
      problems.push(
        `${job}: 登记表的措辞写着「next build 的内置类型检查被 ignoreBuildErrors 关掉」，` +
          "而 next.config 里已经没有这条了——构建期已恢复类型检查，请同步改写 lib/ci-defused.mjs 的口径",
      );
    }
  }
  return problems;
}

/** 每个已接入作业的登记表：reporterStepId = 那步 `if: always()` 的读数步骤 */
export const DEFUSED_GATES = [
  {
    job: "test-sqlite",
    reporterStepId: "defused-gates",
    // 根 typecheck 只覆盖 @navhub/*，而这个作业会 vendor 重建 apps/web 并跑 apps/web/test
    // （vitest 用 esbuild，类型错误会被擦掉不报）⇒ 它的绿不含前端类型判定。
    typeTrust: { dependsOnJob: "test-web", dependsOnStepId: "web-typecheck" },
    env: [
      { id: "sqlite-install", label: "pnpm install --frozen-lockfile" },
      { id: "sqlite-vendor", label: "vendor 重建 apps/web" },
    ],
    gates: [
      { id: "typecheck", label: "根 typecheck（packages/* + apps/api）" },
      {
        id: "backend-lint",
        label: "后端 eslint（lint:backend）",
        // 2026-11-01 起是硬门禁：那一步的 `continue-on-error` 已经撤掉（规则早就是 error、
        // lint 脚本带 --max-warnings 0），所以这里**不再标 soft**。
        // 它原来是本仓唯一的软门禁，也是「判据取 conclusion」那条口径的活体样本；
        // 硬化后这个样本没了，同一口径改由两个方向执勤：
        //   - 谁再把某步写成 continue-on-error 而登记表不标 soft ⇒ defusedWiringProblems 报「请补 soft: true」；
        //   - 覆盖面判据对允许失败的步骤仍然豁免（合成夹具反向钉住，见 scripts/ci-defused.test.ts）。
        // 它的红不归这里管：阻塞面另有 apps/api/test/backend-lint-gate.test.ts 这份同口径断言，
        // 配对由 check-ci-gate.mjs 第 5 项守住。
      },
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
    job: "coverage",
    reporterStepId: "defused-gates",
    // 与 test-sqlite 同款可信度声明：本作业 vendor 重建 apps/web 并跑 web 测试，
    // 它的绿不代表整前端类型也过（esbuild 会擦掉类型错误）——全量判定只在
    // test-web 的 web-typecheck。
    typeTrust: { dependsOnJob: "test-web", dependsOnStepId: "web-typecheck" },
    env: [{ id: "coverage-install", label: "pnpm install --frozen-lockfile" }],
    gates: [
      { id: "vitest-coverage", label: "全量测试（含覆盖率插桩）" },
      { id: "coverage-threshold", label: "覆盖率阈值判定（lines≥84% / functions≥85%）" },
    ],
  },
  {
    job: "test-web",
    reporterStepId: "defused-gates",
    // 这个作业自己就是那唯一一处整前端 tsc（web-typecheck）⇒ 不需要可信度声明。
    // 登记 self 只为把「本作业的绿含类型判定」这件事写死：若有人把 web-typecheck 挪出这个作业，
    // typeTrustProblems 的 self 分支会当场报红（否则 5 道依赖它的作业会一起变成无主声明）。
    typeTrust: { self: true },
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
    // vendor 出 apps/web 后由 Playwright 的 webServer 起站：类型错误既不进构建也不进运行时
    // ⇒ 用例全绿与「类型过」无关（run131 直证：adf13b3a 前端门禁 failure，两个分片 success）。
    typeTrust: { dependsOnJob: "test-web", dependsOnStepId: "web-typecheck" },
    env: [
      { id: "e2e-install", label: "pnpm install --frozen-lockfile" },
      { id: "e2e-vendor", label: "vendor 重建 apps/web" },
      { id: "e2e-playwright", label: "安装 Playwright Chromium" },
    ],
    gates: [
      { id: "e2e", label: "Playwright E2E（分片）" },
      // 隔离用例取证（TESTING-STRATEGY §4.3）：只在分片 1 跑、且永不阻塞合并，
      // 但「skipped 时读数里没有它」正是撤防账要防的静默跳过，因此必须登记。
      { id: "quarantine-e2e", label: "隔离用例取证（@quarantine，末尾 exit 0 故不阻塞）" },
    ],
  },
  {
    job: "check-isr-live",
    reporterStepId: "defused-gates",
    // 全程不跑 tsc（见下方 env 那套一次性预览站脚手架）⇒ 它的 success 只说明产物能跑，
    // 不说明源码类型过（2026-10-30 直证：同 commit 前端门禁 failure、本作业 success）。
    typeTrust: { dependsOnJob: "test-web", dependsOnStepId: "web-typecheck" },
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
    // 这里的 gate-video-scope 只判「视频作用域」那一片（见 scripts/typecheck-video-scope.mjs），
    // 不是整前端 tsc ⇒ 它的绿同样不含类型判定。
    typeTrust: { dependsOnJob: "test-web", dependsOnStepId: "web-typecheck" },
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
    // Dockerfile.web 里跑的就是那个不判类型的 next build ⇒ 镜像冒烟通过 ≠ 类型过。
    typeTrust: { dependsOnJob: "test-web", dependsOnStepId: "web-typecheck" },
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

/**
 * 「这个作业**本来就该有账**吗」——从 ci.yml 现推，不靠人记。
 *
 * 为什么需要（2026-10-30 实测 run 41024897432）：`--defused` 把 13 个作业里
 * 读不到账的 2 个都写成「日志里没有撤防账（这一步没接线，或整步没跑）」并算进退出码，
 * 而那 2 个是结构性无账——`seo-audit-prod` 整作业按
 * `if: github.event_name == 'workflow_dispatch' && vars.NAVHUB_SITE_URL != ''` 跳过、
 * `ci-passed` 是汇总作业没有门禁步骤。于是退出码契约里写的「0 = 每个作业都读到且没撤防」
 * 在任何 push 轮都不可达：绿色轮也拿不到 0。
 * 判据必须是「期望有账却读不到」才算发现；期望本来就没有账，那是接线范围，不是撤防。
 *
 * `wired` 只看 YAML 里有没有那一步 `id: <reporterStepId>`（登记表按作业 key 取，
 * 取不到就退回默认的 defused-gates）：这一步在 ⇒ 日志理应有账 ⇒ 读不到是真信号；
 * 这一步不在 ⇒ 读不到是结构，不参与判红。
 *
 * `namePattern`：GitHub 侧的作业名是渲染后的 `name:`，矩阵表达式
 * （`${{ matrix.shard }}`）在 YAML 里是字面量，只能换成通配再匹配。
 */
export function defusedWiring(source) {
  const { jobs } = parseWorkflow(source);
  return jobs.map((job) => {
    const block = stripYamlCommentLines(job.block);
    const rawName = block.match(/^ {4}name:\s*(.+)$/m)?.[1]?.trim() ?? job.name;
    const reporterStepId = defusedEntryFor(job.name)?.reporterStepId ?? "defused-gates";
    return {
      key: job.name,
      name: rawName.replace(/\$\{\{[^}]*\}\}/g, "…"),
      namePattern: nameToPattern(rawName),
      cond: block.match(/^ {4}if:\s*(.+)$/m)?.[1]?.trim() ?? "",
      wired: new RegExp(`^\\s*id:\\s*${reporterStepId}\\s*$`, "m").test(block),
    };
  });
}

function nameToPattern(rawName) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = String(rawName ?? "").split(/\$\{\{[^}]*\}\}/);
  return new RegExp("^" + parts.map(escape).join("[0-9A-Za-z._/-]+") + "$");
}

/**
 * GitHub 返回的作业名对上 ci.yml 里的作业块。
 * 认不出来（本地 ci.yml 与被读那一轮不同）时返回 null——调用方必须按「缺账」保守处理，
 * 不能因为对不上就把一个可能真被摘掉读数步骤的作业说成结构性无账。
 */
export function matchDefusedWiring(wiring, githubJobName) {
  const name = String(githubJobName ?? "");
  return (
    (wiring ?? []).find((w) => w.key === name || w.namePattern.test(name)) ?? null
  );
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

  // 软/硬口径必须和工作流那一步一致。两个方向各管一种撒谎：
  //   - 登记成 soft 而 `continue-on-error` 被去掉 ⇒ 它现在会判红也会挡路，
  //     账里那句「红了不算红」成了假话（软门禁被硬化的那一刻必须人来改登记表）；
  //   - 登记成硬门禁而那步还软 ⇒ 它 outcome=failure / conclusion=success，
  //     读数会把一次被吞掉的退出码讲成「门禁判红」，还会把它点成根因。
  for (const gate of entry.gates ?? []) {
    const at = indexOf(gate.id);
    if (at < 0) continue; // 「找不到 id」上面那条已经报了
    const softInYaml = /continue-on-error:\s*true/.test(steps[at]);
    if (gate.soft && !softInYaml) {
      problems.push(
        `${entry.job}: ${gate.id} 登记为软门禁，但作业里已经没有 continue-on-error 了——` +
          "它会判红也会挡路，请把登记表里的 soft 摘掉",
      );
    }
    if (!gate.soft && softInYaml) {
      problems.push(
        `${entry.job}: ${gate.id} 在作业里带 continue-on-error，登记表却当它是硬门禁——` +
          "它红了不判红也不挡路，请补 soft: true（否则读数会把被吞掉的退出码讲成门禁判红）",
      );
    }
  }
  return problems;
}

/**
 * 登记表自身的覆盖面（判据从 YAML 推出来，不等事故）：
 * **门禁形状的步骤必须有 id 且必须进登记表**，否则它能整步 skipped 而没人报得出名字。
 *
 * 豁免：`continue-on-error: true` 的步骤**不逼登记**——它红了也不会挡住别人（红被吞掉），
 * 硬要求登记等于让门禁管一件不会出事的事。但**自愿登记是允许的**，且必须带 `soft: true`
 * （`defusedWiringProblems` 盯那步在 YAML 里到底还软不软）。
 * 2026-11-01 撤掉后端 lint 的 continue-on-error 之后，本仓合并门禁作业里**没有任何**软门禁：
 * 这条豁免只剩合成夹具能走通（见 scripts/ci-defused.test.ts 的反向用例），
 * 而它反向的那句「YAML 还软、登记表没标」是现在真正执勤的方向。
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

/**
 * 把作业日志正文里的「撤防账」读回来。
 *
 * 为什么要有这一条：账是 `ci-defused-gates.mjs` 在作业里打到 stdout 的，跨机器只有
 * 日志读得到（2026-10-30 run 41010267114 直证：`/actions/jobs/{id}/logs` 用
 * redirect:"manual" 接签名 URL 有正文；`/jobs/{id}/summary` 要 actions:read；
 * 同一轮 13 个作业的 annotations 返回 0 条）。而 `explain-ci-failure.mjs` 原先只给
 * **失败作业**取日志 ⇒ 绿色作业的账等于没说过。这里只做「读」，判定仍在作业里。
 *
 * 认三种落法（同一次运行的三种形状）：
 *   `[撤防账] <job>：N 道门禁全部跑过`
 *   `[撤防账] <job>：N 道门禁里 M 道没跑成`（后面跟逐步骤行 + `根因：…`）
 *   `::notice|::warning title=CI 门禁撤防::<job> …`（单行全量：计数 + id 列表 + 根因）
 * 单行的注解形状信息最全，优先用它；只有 stdout 形状时再从相邻行里补 id 与根因。
 *
 * 日志里读到的**不是**写出去的原样（run 41010267114 的 test-web 日志逐行直证）：
 *   - 工作流命令 `::warning title=CI 门禁撤防::正文` 被 runner 改写为
 *     `##[warning]正文` —— **`title` 整段丢掉**，所以按 `title=…::` 找在真日志上永远不命中；
 *   - 每行前面还有 `2026-10-30T05:47:20.2193330Z ` 时间戳 ⇒ 任何「行首是 `·`」的锚定匹配都会落空
 *     （真实表现：账读出来了、id 却写成「未列出」，而夹具里没有时间戳、测试全绿）。
 * 因此读前先剥时间戳，注解形状同时认 `::…title=CI 门禁撤防::` 与 `##[warning]|##[notice]` 两种前缀。
 */
const DEFUSED_ANNOTATION = "title=CI 门禁撤防::";
/** runner 改写后的注解前缀：`title` 被吃掉，只剩级别标记 */
const RENDERED_ANNOTATION = /^##\[(?:warning|notice)\]/;
/** GitHub 日志行首的时间戳（精确到 7 位小数，末尾固定 Z） */
const LOG_TIMESTAMP = /^[\d-]{10}T[\d:.]+Z\s+/;

function readCounts(text) {
  const all = /(\d+)\s*道门禁全部跑过/.exec(text);
  if (all) return { gateTotal: Number(all[1]), defused: 0 };
  const part = /(\d+)\s*道门禁里\s*(\d+)\s*道没跑成/.exec(text);
  if (part) return { gateTotal: Number(part[1]), defused: Number(part[2]) };
  return { gateTotal: null, defused: null };
}

function readBlocker(text) {
  // label 用惰性匹配：登记名里带全角括号（test-sqlite 的「根 typecheck（packages/* + apps/api）」），
  // 贪婪的 `[^（]+` 会停在第一个括号上 ⇒ 根因整条读不出来。
  const hit = /根因：(.+?)（id:\s*([A-Za-z0-9_-]+)）(判红|被取消)/.exec(text);
  if (hit) return { blocker: hit[2], blockerLabel: hit[1].trim(), blockerKind: hit[3] };
  if (/根因读不出来/.test(text)) return { blocker: null, blockerLabel: "读不出来", blockerKind: "" };
  return { blocker: null, blockerLabel: null, blockerKind: "" };
}

function readIds(text) {
  const hit = /没跑成的步骤 id：([^；\n]+)/.exec(text);
  if (!hit) return [];
  return hit[1]
    .split("、")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDefusedTrace(logText) {
  const base = {
    found: false,
    // 账行在但读不出判定（steps 上下文没传进来 / 作业压根没登记）——这跟「没有账」是两回事
    broken: "",
    job: "",
    gateTotal: null,
    defused: null,
    ran: null,
    envTotal: null,
    ids: [],
    envIds: [],
    blocker: null,
    blockerLabel: null,
    blockerKind: "",
    green: false,
    failedGates: 0,
    softTotal: 0,
    // 可信度声明读没读回来（false 有两种意思，靠 trustDependsOn 区分不了——所以只在
    // 「这行本来就带声明」时才置 true；没带声明的作业留 false，由 check-ci-gate 的第 8 项判是不是漏登记）
    trustNote: false,
    trustDependsOn: "",
    line: "",
  };
  const text = String(logText ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  // 「道门禁」只在账里出现：日志被 runner 改写后已经没有 `title=CI 门禁撤防::` 原文，
  // 只按那个串入口就会把整份真日志判成「没有账」。
  if (!/撤防账|CI 门禁撤防|道门禁/.test(text)) return base;
  // 先剥行首时间戳再匹配：runner 每行前面都有 `2026-10-30T05:47:20.2193330Z `，
  // 锚定「行首是 `·`」的逐步骤行不剥就永远命中不了（真日志实测就是这个形状）。
  const lines = text.split(/\r?\n/).map((l) => l.replace(LOG_TIMESTAMP, ""));

  // 单行注解信息最全（计数 + id 列表 + 根因都在一行），优先用它；stdout 头行只当兜底
  let annotation = null;
  for (const l of lines) {
    let body = "";
    const at = l.indexOf(DEFUSED_ANNOTATION);
    if (at >= 0) body = l.slice(at + DEFUSED_ANNOTATION.length);
    else if (RENDERED_ANNOTATION.test(l) && l.includes("道门禁")) body = l.replace(RENDERED_ANNOTATION, "");
    else continue;
    // 账失效那行写成 `<job>：…`，正常那行写成 `<job> …` ⇒ 两种都要认出 job
    annotation = { job: body.match(/^([A-Za-z0-9_.-]+)(?=\s|[：:])/)?.[1] ?? "", body };
  }
  let headIdx = -1;
  let stdoutJob = "";
  let stdoutHead = "";
  for (let i = 0; i < lines.length; i += 1) {
    const hit = /\[撤防账\]\s*([A-Za-z0-9_.-]+)：(.*)$/.exec(lines[i]);
    if (hit) {
      headIdx = i;
      stdoutJob = hit[1];
      stdoutHead = hit[2];
      break;
    }
  }
  const job = annotation?.job || stdoutJob;
  const counts = readCounts(stdoutHead || annotation?.body || "");
  if (!job || counts.gateTotal === null) {
    // 出不了数的那两种形状必须带上原因：「读不到」和「没撤防」同形就是这轮要消灭的东西
    const invalid = lines.find((l) => l.includes("撤防账失效"));
    const unregistered = lines.find((l) => l.includes("没有撤防登记表"));
    const why = invalid
      ? "账失效（steps 上下文没传进来）"
      : unregistered
        ? "作业没有登记表（这一步在跑一件没人记账的事）"
        : "";
    return { ...base, broken: why, job, line: String(invalid ?? unregistered ?? "").slice(0, 240) };
  }

  // 逐步骤行只在 stdout 形状里出现：`  · label（id: x）— 状态`
  // 必须按「以 · 开头」筛，`根因：…（id: y）判红` 那行也有 id，混进来就是把根因报成撤防。
  const ids = annotation ? readIds(annotation.body) : [];
  if (ids.length === 0 && headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i += 1) {
      const hit = /^\s*·.*（id:\s*([A-Za-z0-9_-]+)）/.exec(lines[i]);
      if (!hit) break;
      ids.push(hit[1]);
    }
  }
  const blockText = annotation?.body ?? lines.slice(headIdx, headIdx + 20).join("\n");
  const { blocker, blockerLabel, blockerKind } = readBlocker(blockText);
  // 注解行里的「没跑成的步骤 id」是**全部**撤防步骤（准备步骤也在里面），
  // 而「M 道没跑成」只数门禁 ⇒ 读侧按登记表把两类分开，否则 id 列表会比数字长，
  // 让人以为门禁红了其实是 install/vendor 没跑成。
  const entry = defusedEntryFor(job);
  const envSet = new Set((entry?.env ?? []).map((s) => s.id));
  const gateIds = entry ? ids.filter((id) => !envSet.has(id)) : ids;
  const envIds = entry ? ids.filter((id) => envSet.has(id)) : [];
  const whole = stdoutHead || annotation?.body || "";
  const failedGates = Number(/其中\s*(\d+)\s*道判红/.exec(whole)?.[1] ?? 0);
  // 软门禁的数目必须跟着读回来：`N 道门禁全部跑过` 只说明「执行过」，
  // 而带 continue-on-error 的那道红了也不在 failedGates 里 —— 不带上这句，
  // 「3 道全部跑过」会被读成「后端 lint 过了」，而它可能正带着几十条告警。
  const softTotal = Number(/软门禁\s*(\d+)\s*道/.exec(whole)?.[1] ?? 0);
  // 缺省要成 null：`Number(null)===0` 会把「这行没写准备步骤」读成「一个都没登记」
  const envHit = /在册准备步骤\s*(\d+)\s*个/.exec(annotation?.body ?? "");
  // 可信度声明：写在同一行末尾（`…｜可信度：本作业不判整前端类型…全量判定只在 test-web 的 web-typecheck`）。
  // 读不到它而作业又登记了 typeTrust ⇒ 说明那一步的账换了形状，跨机器视角会静默失去这句——
  // 所以 explain-ci-failure 只在 trustNote 为真时才敢替它做「同 commit 类型判定红」的连带标注。
  const trustHit = TYPE_TRUST_NOTE_RE.exec(whole);

  return {
    found: true,
    broken: "",
    job,
    gateTotal: counts.gateTotal,
    defused: counts.defused,
    ran: counts.gateTotal - counts.defused,
    envTotal: envHit ? Number(envHit[1]) : null,
    ids: gateIds,
    envIds,
    blocker,
    blockerLabel,
    blockerKind,
    green: counts.defused === 0,
    failedGates,
    softTotal,
    trustNote: Boolean(trustHit),
    trustDependsOn: trustHit ? `${trustHit[1]}/${trustHit[2]}` : "",
    line: whole.slice(0, 240),
  };
}

/**
 * 「接线外」的形状要说破差别：汇总作业永远不会有账；条件作业在这一轮是整作业被跳过
 * （换一种触发方式它会跑，但仍然没有读数步骤）；没写 if 的作业才是真没人记账。
 * 三种都写成「这一步没接线」并把它们算进退出码，等于宣布 rc=0 不可达。
 */
function unwiredReason(row) {
  const cond = String(row.wiredCond ?? "");
  if (/^always\(\)$/.test(cond)) return "接线外：汇总作业（if: always() 只合并结果，没有门禁步骤可记账）⇒ 不计入判红";
  if (cond && row.conclusion === "skipped") return `接线外：整作业按条件跳过（if: ${cond}），本来就没有读数步骤 ⇒ 不计入判红`;
  if (cond) return `接线外：ci.yml 里这个作业没有读数步骤（if: ${cond}）⇒ 不计入判红`;
  return "接线外：ci.yml 里这个作业没有读数步骤 ⇒ 不计入判红";
}

/**
 * 逐作业一行的账（--defused 的文本输出；空数组也要出一行说明，别让调用方对着空白猜）
 *
 * `authority` 是跨作业才能算出来的那一半：一个作业自己看不到兄弟作业的结论
 * （steps 上下文只含本作业的步骤），而 `ignoreBuildErrors` 让「本作业绿」推不出「类型过」。
 * 调用方（explain-ci-failure --defused）手里有整轮作业的 conclusion，就在那儿把
 * 「权威作业判红」连带到每一行带 trustNote 的绿色作业上——这不是判红，是把绿话说全。
 *
 * @param {object[]} rows parseDefusedTrace 的行
 * @param {{conclusion?:string, job?:string}} [authority] 类型判定所在作业（含其本轮结论）
 */
export function renderDefusedTable(rows, authority) {
  const authorityRed = String(authority?.conclusion ?? "") === "failure";
  const authorityLabel = authority?.job ? `类型判定=${authority.job} 判红` : "类型判定作业判红";
  if (!rows?.length) return ["（没有作业可读——jobs 清单是空的）"];
  const width = Math.max(...rows.map((r) => String(r.name ?? "").length), 4);
  return rows.map((r) => {
    const name = String(r.name ?? "").padEnd(width);
    if (!r.found) {
      // 「读不到账」有三种形状，判法不同：日志取不到（网络/权限）、有账但失效（broken）、
      // 以及压根没有账。最后一种再分两半——ci.yml 里这作业没有读数步骤（接线外，不算发现），
      // 或有步骤却没写出账（真撤防）。一刀切判红就是 run 41024897432 那个 rc=0 不可达的根因。
      const why = r.error
        ? `日志没取到：${r.error}`
        : r.broken
          ? r.broken
          : r.wired === false
            ? unwiredReason(r)
            : `日志里没有撤防账（这一步没接线，或整步没跑）${r.wired === null ? "；本地 ci.yml 对不上这个作业名，按缺账保守记" : ""}`;
      return `${name} ${r.conclusion || "?"} — ${why}`;
    }
    if (r.green) {
      const note = r.failedGates > 0 ? `，其中 ${r.failedGates} 道判红` : "";
      const soft = r.softTotal ? `（软门禁 ${r.softTotal} 道：红了不判红、也不挡路）` : "";
      const env = r.envTotal === null ? "" : `（准备步骤 ${r.envTotal} 个在册）`;
      // 只在这行自己声明了「我不判整前端类型」时才连带标注：
      // 没声明的作业可能是权威本身（它自己判类型），拿 trustNote 当开关才不会误伤。
      const trust = authorityRed && r.trustNote ? ` ⚠ ${authorityLabel}，本绿灯建立在忽略类型错误的产物上` : "";
      return `${name} ${r.conclusion || "?"} — ${r.gateTotal} 道门禁全部跑过${note}${soft}${env}${trust}`;
    }
    const blocker = r.blocker ? `根因 ${r.blocker}` : "根因读不出来";
    const env = r.envIds?.length ? `；准备步骤没跑成：${r.envIds.join("、")}` : "";
    return `${name} ${r.conclusion || "?"} — ${r.ran}/${r.gateTotal} 道跑过，${r.defused} 道没跑成（${r.ids.join("、") || "id 未列出"}）${env} · ${blocker}`;
  });
}
