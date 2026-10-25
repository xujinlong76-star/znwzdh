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
      default:
        fail(`未知参数：${key}\n  可用：--file --from --to --test --grep --expect-output --cmd --allow-dirty`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) fail("缺少 --file（要改坏的源文件）");
if (!args.from) fail("缺少 --from（原文片段）");
if (args.to === undefined) fail("缺少 --to（替换成什么；可以是空串）");
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

/** 2) 读取 + 断言片段存在 */
const original = readFileSync(file, "utf8");
const occurrences = original.split(args.from).length - 1;
if (occurrences === 0) {
  fail(
    `在 ${args.file} 里找不到 --from 片段：\n  ${JSON.stringify(args.from)}\n` +
      `  片段必须与源码逐字符一致（含缩进与逗号）。`,
  );
}
if (occurrences > 1) {
  fail(`--from 片段在文件中出现 ${occurrences} 次，无法确定替换哪一处。请给出更长的上下文。`);
}

const mutated = original.replace(args.from, args.to);
if (mutated === original) fail("替换后内容没有变化（--to 与 --from 相同？）");

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
writeFileSync(file, mutated, "utf8");
const testFiles = args.test ? [args.test] : [];
const cmdText =
  args.cmd ??
  ["node node_modules/vitest/vitest.mjs run", ...testFiles, "--reporter=dot", ...(args.grep ? ["-t", args.grep] : [])].join(
    " ",
  );

console.log(`\n[verify-guard] 已改坏：${relative(process.cwd(), file)}`);
console.log(`[verify-guard] ${JSON.stringify(args.from)} → ${JSON.stringify(args.to)}`);
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
