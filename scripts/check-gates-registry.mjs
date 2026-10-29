#!/usr/bin/env node
/**
 * 门禁清单校验：scripts/gates.json ↔ pre-commit 模板 ↔ pre-push 模板 ↔ ci.yml。
 *
 * 退出码：0 = 三个方向都对得上；1 = 有对照问题（登记没接线 / 接线没登记 / CI 作业缺登记）；
 *         2 = 清单读不了或形状不合法（坏清单会把「没登记」当成「没有门禁」，必须先修清单）。
 *
 * 用法：
 *   node scripts/check-gates-registry.mjs [--registry scripts/gates.json]
 *        [--hooks scripts/install-git-hooks.mjs] [--ci .github/workflows/ci.yml]
 *        [--prepush scripts/prepush-gates.mjs]
 * 测试用这些开关注入派生的坏夹具，正常提交不用传。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { reviewGates, testFilesOf, validateRegistry } from "./lib/gates-registry.mjs";

const P = "[gates-registry] ";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = {
    registry: resolve(REPO_ROOT, "scripts/gates.json"),
    hooks: resolve(REPO_ROOT, "scripts/install-git-hooks.mjs"),
    ci: resolve(REPO_ROOT, ".github/workflows/ci.yml"),
    prepush: resolve(REPO_ROOT, "scripts/prepush-gates.mjs"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    for (const key of ["registry", "hooks", "ci", "prepush"]) {
      if (arg === `--${key}`) {
        opts[key] = resolve(argv[i + 1] ?? "");
        i += 1;
        break;
      }
      if (arg.startsWith(`--${key}=`)) opts[key] = resolve(arg.slice(key.length + 3));
    }
  }
  return opts;
}

function readOrFail(path, label) {
  if (!existsSync(path)) {
    console.error(`${P}找不到${label}：${path}（不做「文件不在就跳过」的推断）`);
    return null;
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`${P}读不了${label}：${path} —— ${error.message}`);
    return null;
  }
}

async function main(argv) {
  const opts = parseArgs(argv);

  const registryText = readOrFail(opts.registry, "清单");
  if (registryText === null) return 2;
  let registry;
  try {
    registry = JSON.parse(registryText);
  } catch (error) {
    console.error(`${P}清单解析不了：${opts.registry} —— ${error.message}`);
    return 2;
  }
  const shape = validateRegistry(registry);
  if (shape.length > 0) {
    console.error(`${P}清单形状不合法（${opts.registry}）：`);
    for (const p of shape) console.error(`   - ${p}`);
    return 2;
  }

  const hookSource = readOrFail(opts.hooks, "钩子生成源");
  const workflowSource = readOrFail(opts.ci, "CI 工作流");
  if (hookSource === null || workflowSource === null) return 2;

  let prepushIds;
  try {
    const mod = await import(pathToFileURL(opts.prepush).href);
    prepushIds = mod.planGates({}).map((g) => g.id);
  } catch (error) {
    console.error(`${P}读不了 pre-push 闸门清单：${opts.prepush} —— ${error.message}`);
    return 2;
  }

  const { problems, summary } = reviewGates({ registry, hookSource, workflowSource, prepushIds });

  // 登记的测试文件必须真实存在：写一条指向不存在文件的 test，比不写更糟——
  // 清单会显示「它有测试」，而实际上没有任何东西在验证这枚门禁。
  const missingTests = [];
  for (const gate of registry.gates) {
    for (const test of testFilesOf(gate)) {
      if (!existsSync(resolve(REPO_ROOT, test))) {
        missingTests.push(`门禁「${gate.name}」登记的测试文件不存在：${test}`);
      }
    }
  }
  problems.push(...missingTests);

  if (problems.length > 0) {
    console.error(`${P}❌ 门禁清单与接线不一致：`);
    for (const p of problems) console.error(`   - ${p}`);
    console.error(`${P}口径：登记 ↔ 接线必须双向一致；test 里的文件必须存在。改钩子模板/CI 作业后跑这一条。`);
    return 1;
  }

  console.log(
    `${P}✅ 门禁清单一致：pre-commit ${summary.staged} 枚、pre-push 外层 ${summary.prepushOuter} 枚 + 内层 ${summary.prepushInner} 枚、` +
      `CI ${summary.ci} 个作业（阻塞 ${summary.ciBlocking} / 手动豁免 ${summary.ciManual}）；` +
      `登记的测试文件全部存在` +
      (summary.noTest > 0 ? `（${summary.noTest} 枚无专属测试，已声明理由）` : "") +
      "。",
  );
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`${P}${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
