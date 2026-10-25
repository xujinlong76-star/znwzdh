#!/usr/bin/env node
/**
 * 守卫反向验证：**故意把源码改坏，确认对应测试真的变红**，然后自动还原。
 *
 * ## 为什么需要它
 *
 * 「测试通过」有两种可能：规则真的成立，或者断言根本没在检查东西（空跑）。
 * 后者在这个仓库里已经发生过多次：
 *   · 收窄后的选测器只影响日志、实际仍跑整棵目录（打印 8 个、实跑 93 个）；
 *   · `field-names` 的「0 处违规」承诺早就不成立——主干上就有违规，只是每次 SKIP 绕过；
 *   · 新加的钩子提示被 `GIT_INDEX_FILE` 短路，走脚本时等于没测过。
 *
 * 这三次都是靠人记得「手动改坏试一下」才发现的。人是会忘的，所以做成工具：
 * 改坏 → 跑测试 → 断言红灯 → 还原，四步一条命令。
 *
 * ## 用法
 *
 * ```bash
 * # 把 search.ts 的 ftsMs 改成旧行为，确认「通道耗时」那条测试会红
 * node scripts/verify-guard.mjs \
 *   --file packages/store/src/search.ts \
 *   --from "ftsMs," --to "ftsMs: semanticMs," \
 *   --test packages/store/test/store.test.ts \
 *   --grep "通道耗时" \
 *   --expect-output "不应包含 semantic 的等待"
 * ```
 *
 * 有些守卫的破坏方式不是「替换一段文本」，而是「**新增**一个违规」——
 * 例如 `field-names`（扫全仓，检查每个表单控件有没有可访问名）。
 * 那种用 `--append`：往目标文件末尾加一行代码。
 *
 * ```bash
 * node scripts/verify-guard.mjs \
 *   --file apps/web-overlay/src/app/admin/data/restore/page.tsx \
 *   --append 'export const __probe = () => <input placeholder="探针" />;' \
 *   --test apps/web/test/field-names.test.ts \
 *   --expect-output "这些控件没有可访问名"
 * ```
 *
 * 追加的内容必须**自包含**（不新增 import）：否则测试会因编译错误而红，
 * 那与你想验证的断言无关，`--expect-output` 会把它判成「无法归因」——这是设计如此。
 *
 * 也可以一次跑完全部登记过的配方：
 *
 * ```bash
 * node scripts/verify-guard.mjs --all      # 读 scripts/guard-recipes.json
 * ```
 *
 * ## 判定（这是它比「跑一下看看」严格的地方）
 *
 * | 结果 | 退出码 | 含义 |
 * |---|---|---|
 * | 测试失败 + 输出含 `--expect-output` | 0 | **守卫有效**：失败正是这条断言造成的 |
 * | 测试通过 | 2 | **守卫无效**：改坏了都不红，断言没在检查 |
 * | 测试失败但输出不含期望串 | 2 | 无法归因（可能是编译错误/别的用例挂了） |
 *
 * 第三种情况是最容易自欺的：「测试红了，所以守卫有效」——红的原因可能完全不相干。
 * `--expect-output` 强制你去证明**是哪一条断言**红的。
 *
 * ## 安全
 *
 * · `--file` 工作区有未提交改动时**拒绝执行**（避免覆盖并行会话的改动），除非 `--allow-dirty`；
 * · 原内容备份在 `.git/verify-guard.bak`，进程被 Ctrl-C / 抛错 / 正常退出都会还原；
 * · 只替换 `--from` 那一段文本，不重写整个文件（保留原行尾）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/**
 * 备份落在哪。
 *
 * 优先放进**目标文件所属仓库**的 `.git/`（可预测、崩溃后能找到）；
 * 非 git 仓库（例如在临时目录里跑自检）退回系统 temp ——
 * 之前写死相对路径 `.git/verify-guard.bak`，在非仓库目录里会直接 ENOENT，
 * 表现为「工具自己崩了」，而不是给出可读的报错。
 */
function backupPathFor(file) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(file), encoding: "utf8" });
  if (top.status === 0 && String(top.stdout).trim()) return join(String(top.stdout).trim(), ".git", "verify-guard.bak");
  return join(tmpdir(), `navhub-verify-guard-${basename(file)}.bak`);
}

function fail(message, code = 1) {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { expectFail: true };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) fail(`参数 ${key} 缺少值`);
      i += 1;
      return v;
    };
    switch (key) {
      case "--file": out.file = next(); break;
      case "--from": out.from = next(); break;
      case "--to": out.to = next(); break;
      case "--test": out.test = next(); break;
      case "--grep": out.grep = next(); break;
      case "--expect-output": out.expectOutput = next(); break;
      case "--cmd": out.cmd = next(); break;
      case "--allow-dirty": out.allowDirty = true; break;
      case "--all": out.all = true; break;
      case "--append": out.append = next(); break;
      case "--patch": out.patch = next(); break;
      default:
        fail(`未知参数：${key}\n  可用：--file --from --to --test --grep --expect-output --cmd --allow-dirty`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/**
 * `--all`：按 `scripts/guard-recipes.json` 逐条跑。
 *
 * 每条都用**子进程**执行本脚本（而不是内联调用）：这样每条都有独立的还原作用域，
 * 一条失败不会让后面的配方带着脏文件继续跑。
 *
 * `afterRestore` 是「还原后的额外动作」。它存在的原因很具体：
 * 改坏 `install-git-hooks.mjs` 时，测试会在 beforeAll 里**重装钩子**，
 * 于是 `.git/hooks/` 里留下了坏版本——只还原源码不重装，钩子就一直是坏的。
 */
if (args.all) {
  const recipesPath = resolve("scripts/guard-recipes.json");
  if (!existsSync(recipesPath)) fail(`找不到配方文件：${recipesPath}`);
  const parsed = JSON.parse(readFileSync(recipesPath, "utf8"));
  const recipes = Array.isArray(parsed.recipes) ? parsed.recipes : [];
  if (recipes.length === 0) fail("配方文件里没有 recipes（或不是数组）");

  const selfPath = fileURLToPath(import.meta.url);
  const failures = [];
  for (const [i, r] of recipes.entries()) {
    console.log(`\n${"=".repeat(64)}`);
    console.log(`[guards] ${i + 1}/${recipes.length} ${r.name ?? r.file}`);
    if (r.why) console.log(`[guards] 守的是：${r.why}`);
    console.log("=".repeat(64));

    const childArgs =
      r.mode === "append"
        ? [selfPath, "--file", r.file, "--append", r.content]
        : r.patch
          ? [selfPath, "--file", r.file, "--patch", r.patch]
          : [selfPath, "--file", r.file, "--from", r.from, "--to", r.to];
    if (r.test) childArgs.push("--test", r.test);
    if (r.grep) childArgs.push("--grep", r.grep);
    if (r.expectOutput) childArgs.push("--expect-output", r.expectOutput);
    if (r.cmd) childArgs.push("--cmd", r.cmd);

    const started = Date.now();
    const res = spawnSync(process.execPath, childArgs, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    const ms = Date.now() - started;
    process.stdout.write(res.stdout ?? "");
    process.stderr.write(res.stderr ?? "");

    if (r.afterRestore) {
      // 无论这条成功还是失败都执行：还原后的环境必须回到可用状态
      const fix = spawnSync(r.afterRestore, { shell: true, encoding: "utf8" });
      if (fix.status !== 0) {
        console.error(`[guards] ⚠ afterRestore 失败（${r.afterRestore}）：${(fix.stderr ?? "").trim()}`);
      }
    }

    if (res.status !== 0) failures.push({ name: r.name ?? r.file, code: res.status });
    else console.log(`[guards] ✓ ${r.name ?? r.file} 有效（${(ms / 1000).toFixed(1)}s）`);
  }

  console.log(`\n${"=".repeat(64)}`);
  if (failures.length > 0) {
    console.error(`[guards] ✗ ${failures.length}/${recipes.length} 条配方未通过：`);
    for (const f of failures) console.error(`  · ${f.name}（exit ${f.code}）`);
    console.error(`[guards] 说明：这表示「这条守卫挡不住它声称要挡的回归」，不是环境问题。\n`);
    process.exit(2);
  }
  console.log(`[guards] ✓ ${recipes.length} 条配方全部有效\n`);
  process.exit(0);
}

if (!args.file) fail("缺少 --file（要改坏的源文件）");
if (args.append !== undefined) {
  if (args.from !== undefined || args.to !== undefined || args.patch !== undefined) {
    fail("--append 与 --from/--to/--patch 不能混用：一个是「新增」，一个是「替换」");
  }
  if (String(args.append).trim() === "") fail("--append 内容不能为空");
} else if (args.patch !== undefined) {
  if (args.from !== undefined || args.to !== undefined) {
    fail("--patch 与 --from/--to 不能混用：patch 是多段替换");
  }
} else {
  if (!args.from) fail("缺少 --from（原文片段），或用 --append 追加一行");
  if (args.to === undefined) fail("缺少 --to（替换成什么；可以是空串）");
}
if (!args.test && !args.cmd) fail("缺少 --test（要跑的测试文件）或 --cmd（自定义命令）");

const file = resolve(args.file);
if (!existsSync(file)) fail(`文件不存在：${args.file}`);

/** 1) 工作区必须干净：否则还原会覆盖别人的改动 */
if (!args.allowDirty) {
  const st = spawnSync("git", ["status", "--porcelain", "--", args.file], { encoding: "utf8" });
  if (st.status !== 0) fail(`无法读取 git 状态（${st.stderr?.trim() || "非 git 仓库"}）。确需在脏文件上验证，加 --allow-dirty`);
  if (String(st.stdout).trim() !== "") {
    fail(
      `${args.file} 有未提交的改动，拒绝在其上做反向验证（还原时会覆盖这些改动）。\n` +
        `  先提交/暂存，或换一个干净的文件，或加 --allow-dirty（自负风险）。`,
    );
  }
}

/** 2) 读取 + 构造变体（append 模式不碰原文，只在末尾追加一行） */
const original = readFileSync(file, "utf8");
/**
 * **匹配时归一化行尾，写回时恢复原样。**
 *
 * 本仓 `core.autocrlf=true`，且有 89 个 `.ts` 是以 CRLF 存储的。若直接按原文匹配，
 * 用 LF 写成的 `--from`／patch 片段在 CRLF 文件里永远匹配不上——而且报错是
 * 「找不到片段」，看起来像「源码变了」，实际只是行尾不同。
 *
 * 归一化后匹配、替换完再转回原行尾：既让片段书写与行尾无关，
 * 又保证还原时字节级一致（备份是原样，还原也必须是原样）。
 */
const fileEol = original.includes("\r\n") ? "\r\n" : "\n";
const originalLf = fileEol === "\r\n" ? original.replace(/\r\n/g, "\n") : original;
const isAppend = args.append !== undefined;
const isPatch = args.patch !== undefined;
/** 只有单段模式才需要「片段唯一」检查；patch 模式的每段单独检查 */
const occurrences = isAppend || isPatch ? 0 : originalLf.split(args.from).length - 1;
if (!isAppend && !isPatch) {
  if (occurrences === 0) {
    fail(
      `在 ${args.file} 里找不到 --from 片段：\n  ${JSON.stringify(args.from)}\n` +
        `  片段必须与源码逐字符一致（含缩进与逗号）。`,
    );
  }
  if (occurrences > 1) {
    fail(`--from 片段在文件中出现 ${occurrences} 次，无法确定替换哪一处。请给出更长的上下文。`);
  }
}

/**
 * 构造变体。
 *
 * 三种模式：
 *   · `--append`  → 末尾追加一行
 *   · `--patch`   → **多段**替换（JSON 文件），段与段之间可以互相依赖
 *   · `--from/--to` → 单段替换
 *
 * 多段是必需的：有些回归要同时改「SQL」与「调用参数」才能模拟出来
 * （例如把 `duration_ms = ?` 改成 `? - created_at` 的同时把参数从 `durationMs`
 * 换成 `now`）。只改一处会得到编译错误，而不是目标行为。
 */
let mutated;
if (isAppend) {
  mutated = `${original.replace(/\r?\n?$/, "\n")}${args.append}\n`;
} else if (isPatch) {
  const patchPath = resolve(args.patch);
  if (!existsSync(patchPath)) fail(`找不到 patch 文件：${args.patch}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(patchPath, "utf8"));
  } catch (err) {
    fail(`patch 文件不是合法 JSON：${args.patch}（${err?.message ?? err}）`);
  }
  const replaces = Array.isArray(parsed.replaces) ? parsed.replaces : [];
  if (replaces.length === 0) fail(`patch 文件里没有 replaces 数组：${args.patch}`);
  mutated = originalLf;
  for (const [i, r] of replaces.entries()) {
    const count = mutated.split(r.from).length - 1;
    if (count === 0) fail(`patch 第 ${i + 1} 段找不到 from 片段：\n  ${JSON.stringify(r.from)}`);
    if (count > 1) fail(`patch 第 ${i + 1} 段的 from 片段出现 ${count} 次，无法确定替换哪一处`);
    mutated = mutated.replace(r.from, r.to);
  }
} else {
  mutated = originalLf.replace(args.from, args.to);
}
if (mutated === originalLf) fail("改动后内容没有变化（--to 与 --from 相同？）");
/** 转回原行尾再写盘：还原与提交都不应顺手改动行尾 */
const mutatedWithEol = fileEol === "\r\n" ? mutated.replace(/\n/g, "\r\n") : mutated;

/** 3) 备份 + 注册还原（三条路径都覆盖：正常、异常、Ctrl-C） */
const BAK = backupPathFor(file);
writeFileSync(BAK, original, "utf8");
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  try {
    writeFileSync(file, original, "utf8");
    if (existsSync(BAK)) unlinkSync(BAK);
  } catch (err) {
    console.error(`\n⚠ 还原失败！原内容在 ${BAK}，请手工执行：cp ${BAK} ${args.file}\n  ${err?.message ?? err}\n`);
  }
};
process.on("exit", restore);
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
process.on("uncaughtException", (err) => {
  restore();
  console.error(err);
  process.exit(1);
});

/** 4) 改坏并跑测试 */
writeFileSync(file, mutatedWithEol, "utf8");
const testFiles = args.test ? [args.test] : [];
const cmdText =
  args.cmd ??
  ["node node_modules/vitest/vitest.mjs run", ...testFiles, "--reporter=dot", ...(args.grep ? ["-t", args.grep] : [])].join(
    " ",
  );

console.log(`\n[verify-guard] 已改坏：${relative(process.cwd(), file)}`);
console.log(
  isAppend
    ? `[verify-guard] 追加：${JSON.stringify(args.append)}`
    : isPatch
      ? `[verify-guard] 多段替换（patch）：${args.patch}`
      : `[verify-guard] ${JSON.stringify(args.from)} → ${JSON.stringify(args.to)}`,
);
console.log(`[verify-guard] 执行：${cmdText}\n`);

const res = args.cmd
  ? spawnSync(args.cmd, { shell: true, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  : spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        ...testFiles,
        "--reporter=dot",
        ...(args.grep ? ["-t", args.grep] : []),
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );

const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
const exitCode = typeof res.status === "number" ? res.status : 1;

restore();

/** 5) 判定 */
const tail = output.split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
console.log(`[verify-guard] 退出码 ${exitCode}，输出尾部：\n${tail}\n`);

if (exitCode === 0) {
  fail(
    `守卫无效：源码被改坏了，测试**仍然通过**。\n` +
      `  断言没有在检查这段行为，或者它检查的是别的东西。\n` +
      `  原文件已还原。`,
    2,
  );
}

if (args.expectOutput) {
  const hit = output.includes(args.expectOutput) || new RegExp(args.expectOutput).test(output);
  if (!hit) {
    fail(
      `无法归因：测试确实失败了，但输出里找不到期望的诊断串。\n` +
        `  期望：${JSON.stringify(args.expectOutput)}\n` +
        `  这通常意味着红的原因不是这条断言（编译错误、别的用例挂了、或 -t 没匹配到）。\n` +
        `  原文件已还原。`,
      2,
    );
  }
  console.log(`[verify-guard] ✓ 守卫有效：失败信息命中期盼的断言（${JSON.stringify(args.expectOutput)}）`);
} else {
  console.log(
    `[verify-guard] ⚠ 守卫可能有效，但**未验证归因**：测试失败了，但没给 --expect-output。\n` +
      `  失败可能是别的原因。要严格证明，加上 --expect-output "<该断言的消息片段>"。`,
  );
}
