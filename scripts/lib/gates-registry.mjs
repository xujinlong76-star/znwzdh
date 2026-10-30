/**
 * 门禁清单（scripts/gates.json）的校验与双向对照。
 *
 * 为什么需要清单：拦截点散在三个地方——pre-commit 模板（scripts/install-git-hooks.mjs 里的
 * `script`）、pre-push 模板（同文件的 `prePush` + scripts/prepush-gates.mjs 的 RUNNERS）、
 * CI（ci.yml 的作业与 ci-passed.needs）。三处各自演化，后果都不报错：
 *   - **登记了没接线**：清单说「这一项会拦」，钩子里其实没有它 —— 人以为被保护着；
 *   - **接线了没登记**：钩子里多加一条命令，没有人知道它存在，下一次重构模板时被顺手删掉；
 *   - **CI 作业没登记**：新作业加进 ci.yml，清单里查不到，也就不会有人问「它该不该拦合并」。
 * 所以对照必须是双向的：登记 ↔ 接线，两个方向各查一次。
 *
 * 口径与边界：
 *   - 只核对**坐标**（脚本命令 / runner id / CI 作业名），不执行门禁本身、不看它检查什么；
 *   - pre-commit 模板里的 `node ...` 命令按「脚本 + 参数」比对（check-large-files 在 staged
 *     和 unpushed 是两枚不同的门禁，只按脚本名会把它们混成一个）；
 *   - pre-push 内层闸门（rest-contracts 等）没有独立命令，比对的是 prepush-gates.mjs 里
 *     planGates() 返回的 id 集合——那是它们唯一的事实来源。
 */

import { parseWorkflow } from "./ci-workflow.mjs";

export const REGISTRY_VERSION = 1;
export const WHEN = ["staged", "prepush", "ci"];

/** 模板里的 command 行；属性串（引号内的路径）只取路径本身，参数截到行尾或 shell 控制符 */
const HOOK_COMMAND_RE = /^\s*node\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))([^\n|&;]*)/gm;

/** 去掉整行 shell 注释：注释里提到的命令不是接线 */
function stripShellComments(template) {
  return String(template ?? "")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/**
 * 从 install-git-hooks.mjs 源码里取出某个模板字面量的内容。
 * 只认 `const <name> = \\`...\\`` 这一种写法（该文件里就是这种，语句可以不带分号）；
 * 取不到返回 null，调用方必须把它当成校验失败——解析不到 ≠ 没有门禁。
 */
export function extractTemplate(source, name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*`([\\s\\S]*?)`");
  const match = String(source ?? "").match(re);
  return match ? match[1] : null;
}

/** 仓库相对脚本路径归一：`$(git rev-parse --git-path hooks)/x.mjs` 这类生成物按 basename 认 */
export function scriptKey(scriptPath) {
  const norm = String(scriptPath ?? "").replace(/\\/g, "/");
  const at = norm.indexOf("scripts/");
  if (at >= 0) return norm.slice(at);
  return norm.split("/").filter(Boolean).pop() ?? "";
}

export function commandKey(script, args = "") {
  /**
   * 剥掉 shell 命令替换（`$(…)`，含嵌套括号）与引号：它们是**运行时才定的实参**，
   * 不是命令身份的一部分。不剥的话 `fix-mock-hygiene.mjs --changed $(git diff …)`
   * 会与登记的 `fix-mock-hygiene.mjs` 对不上——2026-10-30 给门禁加 `--changed`
   * 收窄时实测被自己拦下。嵌套括号（`grep -E '(…)'`）用配对计数，不靠非贪婪正则。
   */
  const stripShellSubs = (s) => {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "$" && s[i + 1] === "(") {
        let depth = 1;
        i += 2;
        while (i < s.length && depth > 0) {
          if (s[i] === "(") depth++;
          else if (s[i] === ")") depth--;
          if (depth > 0) i++;
        }
        out += " ";
        continue;
      }
      out += s[i];
    }
    return out;
  };
  const cleaned = stripShellSubs(String(args ?? ""))
    .replace(/"[^"]*"/g, '""')
    .replace(/\s+/g, " ")
    .trim();
  return (scriptKey(script) + (cleaned ? " " + cleaned : "")).trim();
}

/** 模板内容 → 命令 key 列表（去重、排序） */
export function hookCommands(template) {
  const keys = new Set();
  for (const m of stripShellComments(template).matchAll(HOOK_COMMAND_RE)) {
    const script = m[1] ?? m[2] ?? m[3] ?? "";
    if (!script.endsWith(".mjs")) continue;
    keys.add(commandKey(script, m[4] ?? ""));
  }
  return [...keys].sort();
}

/** 一枚门禁登记的测试文件（string 或 string[]，去空） */
export function testFilesOf(gate) {
  const raw = gate?.test;
  if (typeof raw === "string") {
    const one = raw.trim();
    return one ? [one] : [];
  }
  if (Array.isArray(raw)) return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  return [];
}

/** 清单基本形状。坏清单比没清单更危险：它会让人相信某些东西被拦着 */
export function validateRegistry(registry) {
  const problems = [];
  if (!registry || typeof registry !== "object") return ["清单不是对象"];
  if (registry.version !== REGISTRY_VERSION) {
    problems.push(`version 应为 ${REGISTRY_VERSION}，实际 ${registry.version}`);
  }
  if (!Array.isArray(registry.gates) || registry.gates.length === 0) {
    problems.push("gates 必须是非空数组");
    return problems;
  }
  const seen = new Set();
  for (const [i, gate] of registry.gates.entries()) {
    const where = `gates[${i}]`;
    if (!gate || typeof gate !== "object") {
      problems.push(`${where} 不是对象`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(gate.name ?? ""))) {
      problems.push(`${where} 的 name 必须是小写 kebab-case`);
    } else if (seen.has(gate.name)) {
      problems.push(`name 重复：${gate.name}`);
    } else {
      seen.add(gate.name);
    }
    if (!WHEN.includes(gate.when)) problems.push(`${where} 的 when 必须是 ${WHEN.join("|")}`);
    if (typeof gate.blocks !== "boolean") problems.push(`${where} 缺 blocks（boolean）`);
    if (!String(gate.why ?? "").trim()) problems.push(`${where} 缺 why（为什么它必须拦）`);

    // 门禁自己的测试：要么有，要么写清为什么没有。没有理由的「裸门禁」不许入库——
    // 否则清单只是把「没人验证过」换了个说法。
    const tests = testFilesOf(gate);
    const whyNoTest = String(gate.whyNoTest ?? "").trim();
    if (tests.length === 0 && !whyNoTest) {
      problems.push(`${where} 缺 test（或在确实没有专属测试时写 whyNoTest 说明理由）`);
    }
    if (tests.length > 0 && whyNoTest) {
      problems.push(`${where} 同时写了 test 与 whyNoTest——要么补测试，要么删掉 test`);
    }

    if (gate.when === "ci") {
      if (!String(gate.job ?? "").trim()) problems.push(`${where} 是 ci 门禁，缺 job`);
      if (gate.script || gate.runner) problems.push(`${where} 是 ci 门禁，不该有 script/runner`);
      continue;
    }
    if (gate.runner) {
      if (gate.when !== "prepush") problems.push(`${where} 只有 prepush 的内层闸门才用 runner`);
      if (gate.script) problems.push(`${where} 有 runner 时不该再写 script`);
      continue;
    }
    if (!String(gate.script ?? "").trim()) problems.push(`${where} 缺 script`);
  }
  return problems;
}

function missingAndExtra(registered, wired, lane) {
  const problems = [];
  const reg = new Set(registered);
  const wire = new Set(wired);
  for (const key of [...reg].sort()) {
    if (!wire.has(key)) {
      problems.push(`${lane}：清单登记了「${key}」，但模板里没有这条命令——以为在拦，其实没跑`);
    }
  }
  for (const key of [...wire].sort()) {
    if (!reg.has(key)) {
      problems.push(`${lane}：模板里有未登记的命令「${key}」——请在 scripts/gates.json 补一条（when=${lane === "pre-commit" ? "staged" : "prepush"}）`);
    }
  }
  return problems;
}

/**
 * 双向对照。
 * @param {{registry:object, hookSource:string, workflowSource:string, prepushIds:string[]}} input
 * @returns {{problems:string[], summary:object}}
 */
export function reviewGates({ registry, hookSource, workflowSource, prepushIds }) {
  const problems = [];
  const gates = (registry.gates ?? []).filter((g) => g && typeof g === "object");
  const summary = { staged: 0, prepushOuter: 0, prepushInner: 0, ci: 0, ciBlocking: 0, ciManual: 0, noTest: 0 };
  summary.noTest = gates.filter((g) => testFilesOf(g).length === 0).length;

  // —— pre-commit ——
  const stagedTemplate = extractTemplate(hookSource, "script");
  if (stagedTemplate === null) {
    problems.push("解析不到 pre-commit 模板（install-git-hooks.mjs 的 `const script = \\`…\\``）——模板结构变了，对照失效");
  } else {
    const registered = gates.filter((g) => g.when === "staged").map((g) => commandKey(g.script, g.args));
    summary.staged = registered.length;
    problems.push(...missingAndExtra(registered, hookCommands(stagedTemplate), "pre-commit"));
  }

  // —— pre-push：外层命令 + prepush-gates 内层 runner ——
  const prepushTemplate = extractTemplate(hookSource, "prePush");
  if (prepushTemplate === null) {
    problems.push("解析不到 pre-push 模板（install-git-hooks.mjs 的 `const prePush = \\`…\\``）——模板结构变了，对照失效");
  } else {
    const outer = gates.filter((g) => g.when === "prepush" && !g.runner);
    const inner = gates.filter((g) => g.when === "prepush" && g.runner);
    summary.prepushOuter = outer.length;
    summary.prepushInner = inner.length;
    problems.push(...missingAndExtra(outer.map((g) => commandKey(g.script, g.args)), hookCommands(prepushTemplate), "pre-push"));

    const wired = new Set(Array.isArray(prepushIds) ? prepushIds : []);
    for (const gate of inner) {
      if (!wired.has(gate.name)) {
        problems.push(`pre-push 内层：清单登记了「${gate.name}」，但 prepush-gates.mjs 的 planGates() 里没有`);
      }
    }
    const registeredInner = new Set(inner.map((g) => g.name));
    for (const id of [...wired].sort()) {
      if (!registeredInner.has(id)) {
        problems.push(`pre-push 内层：prepush-gates.mjs 跑了未登记的闸门「${id}」`);
      }
    }
  }

  // —— CI ——
  const workflow = parseWorkflow(workflowSource);
  if (!workflow.hasJobs) {
    problems.push("解析不到 ci.yml 的 jobs: 段——CI 对照失效");
  } else {
    const jobs = workflow.jobs.filter((j) => j.name !== "ci-passed");
    const ciGates = gates.filter((g) => g.when === "ci");
    summary.ci = ciGates.length;
    summary.ciBlocking = ciGates.filter((g) => g.blocks).length;
    summary.ciManual = ciGates.filter((g) => !g.blocks).length;
    const byJob = new Map(ciGates.map((g) => [g.job, g]));
    for (const job of jobs) {
      const gate = byJob.get(job.name);
      if (!gate) {
        problems.push(`CI：作业 ${job.name} 未在清单登记——新作业要先回答「它红了该不该拦合并」`);
        continue;
      }
      const aggregated = workflow.needs.includes(job.name);
      if (gate.blocks && !aggregated) {
        problems.push(`CI：${job.name} 登记为阻塞，但不在 ci-passed.needs 里——红了不会拦合并`);
      }
      if (!gate.blocks && aggregated) {
        problems.push(`CI：${job.name} 登记为手动/豁免，却被 ci-passed.needs 聚合`);
      }
    }
    const jobNames = new Set(jobs.map((j) => j.name));
    for (const gate of ciGates) {
      if (!jobNames.has(gate.job)) {
        problems.push(`CI：清单登记的作业 ${gate.job} 在 ci.yml 里不存在`);
      }
    }
  }

  return { problems, summary };
}
