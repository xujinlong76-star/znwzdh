/**
 * lychee 两个工作流 + lychee.toml 的回归测试。
 *
 * 守四件事（方案 03 §6）：
 *   1. 两个 workflow 文件是合法 YAML；lychee.toml 是合法 TOML 且与 §6.1 逐字一致；
 *   2. links-pr.yml：PR 触发、--offline 只查本地文件、退出码分流写在 shell 里
 *      （2=链失败阻塞合入，1/3=配置/运行错误报维护者）；
 *   3. links-weekly.yml：北京时间周一 03:00（UTC 周日 19:00）定时、
 *      §6.2 参数逐字写死（--accept、缓存、并发、重试、-X head,get、
 *      --suggest --archive wayback、LinkedIn --exclude、UA、github-token、
 *      --format json --output lychee/out.json），且不加载 offline 的 lychee.toml
 *      （见工作流内注释：加载它会把在线检查静默关掉）；
 *   4. 两个工作流的第三方 action 均固定到 commit SHA（仓库惯例，不用可变 @vN 标签）。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Windows 上 python3 常是 Microsoft Store 占位 stub（exit 9009），python/py -3
// 才是真解释器。探测一次可用命令，避免环境差异造成假红（本文件只做格式解析）。
// Windows 中文区域 locale=cp936：spawnSync 用 UTF-8 写 stdin，Python 却按
// cp936 读 → 工作流里的中文字符变 mojibake，PyYAML 报 ReaderError。强制 UTF-8 模式。
const PY_ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
interface PyCmd { cmd: string; prefix: string[] }
function resolvePython(): PyCmd {
  const candidates: PyCmd[] = [
    { cmd: "python3", prefix: [] },
    { cmd: "python", prefix: [] },
    { cmd: "py", prefix: ["-3"] },
  ];
  for (const c of candidates) {
    const probe = spawnSync(c.cmd, [...c.prefix, "-c", "import yaml, tomllib"], { encoding: "utf8", env: PY_ENV });
    if (probe.status === 0) return c;
  }
  throw new Error("未找到带 yaml/tomllib 的 Python 解释器（试过 python3/python/py -3）");
}
const PY = resolvePython();
function pyEval(code: string, input: string): any {
  const res = spawnSync(PY.cmd, [...PY.prefix, "-c", code], { input, encoding: "utf8", env: PY_ENV });
  expect(res.status, PY.cmd + " stderr: " + res.stderr).toBe(0);
  return JSON.parse(res.stdout);
}
function parseYaml(text: string): any {
  return pyEval("import sys, yaml, json; print(json.dumps(yaml.safe_load(sys.stdin.read())))", text);
}

function parseToml(text: string): any {
  return pyEval("import sys, tomllib, json; print(json.dumps(tomllib.loads(sys.stdin.read())))", text);
}

function workflowText(name: string): string {
  return readFileSync(resolve(`.github/workflows/${name}`), "utf8");
}

function allRunSteps(wf: any): string[] {
  const steps: string[] = [];
  for (const job of Object.values(wf.jobs ?? {}) as any[]) {
    for (const step of job.steps ?? []) if (typeof step.run === "string") steps.push(step.run);
  }
  return steps;
}

function allUses(wf: any): string[] {
  const uses: string[] = [];
  for (const job of Object.values(wf.jobs ?? {}) as any[]) {
    for (const step of job.steps ?? []) if (typeof step.uses === "string") uses.push(step.uses);
  }
  return uses;
}

describe("links 工作流：YAML/TOML 语法与 §6.1 配置", () => {
  it("lychee.toml 与方案 §6.1 逐字一致", () => {
    const text = readFileSync(resolve("lychee.toml"), "utf8");
    expect(text).toBe(
      "# lychee.toml（PR 门禁：只拦内部链接，外部一律不查）\n" +
        "offline = true\n" +
        "include_fragments = \"anchor-only\" # 实际为 anchor-only（不带值默认）；站内文档锚点漂移是 PR 可修的\n" +
        "max_concurrency = 16\n" +
        "format = \"json\"\n",
    );
    const parsed = parseToml(text);
    expect(parsed.offline).toBe(true);
    expect(parsed.include_fragments).toBe("anchor-only");
    expect(parsed.max_concurrency).toBe(16);
    expect(parsed.format).toBe("json");
  });

  it("两个 workflow 文件都是合法 YAML", () => {
    for (const name of ["links-pr.yml", "links-weekly.yml"]) {
      const wf = parseYaml(workflowText(name));
      expect(typeof wf.name).toBe("string");
      expect(wf.jobs).toBeTruthy();
    }
  });
});

describe("links-pr.yml：PR 门禁（§6.1）", () => {
  it("PR 触发、--offline、退出码分流在 shell 里", () => {
    const wf = parseYaml(workflowText("links-pr.yml"));
    // 注意：PyYAML 按 YAML 1.1 把顶层 `on:` 解析为布尔 true 键。
    expect(wf["true"].pull_request).toBeTruthy();
    const runs = allRunSteps(wf).join("\n");
    expect(runs).toContain("--config lychee.toml --offline");
    expect(runs).toContain("README.md docs wiki.md");
    // 退出码分流：2 阻塞、1/3 报维护者、0 通过
    expect(runs).toContain('exit_code=$?');
    expect(runs).toContain('"2"');
    expect(runs).toContain('"1"');
    expect(runs).toContain('"3"');
    expect(runs).toContain("阻塞合入");
    expect(runs).toContain("维护者");
    // 不依赖 lychee-action 的 fail/outputs 语义：工作流里不用它；门禁读的是
    // 本工作流自己捕获的 $?（lychee 步骤把 $? 写进自家 step output 再传给门禁步骤）。
    expect(allUses(wf).join("\n")).not.toContain("lychee-action");
    expect(runs).toContain("steps.lychee.outputs.exit_code");
  });

  it("第三方 action 固定到 commit SHA", () => {
    const wf = parseYaml(workflowText("links-pr.yml"));
    for (const use of allUses(wf)) {
      expect(use).toMatch(/@[0-9a-f]{40}( # |$)/);
    }
  });
});

describe("links-weekly.yml：每周全量（§6.2）", () => {
  it("北京时间周一 03:00 = UTC 周日 19:00 的 cron", () => {
    const wf = parseYaml(workflowText("links-weekly.yml"));
    const schedules = wf["true"].schedule;
    expect(schedules).toEqual([{ cron: "0 19 * * 0" }]);
  });

  it("§6.2 参数逐字写死", () => {
    const runs = allRunSteps(parseYaml(workflowText("links-weekly.yml"))).join("\n");
    for (const flag of [
      "--cache --max-cache-age 7d",
      "--cache-exclude-status '429, 500..599'",
      "--accept '200..=299,429'",
      "--max-concurrency 16",
      "--host-concurrency 2",
      "--host-request-interval 500ms",
      "--max-retries 2",
      "--retry-wait-time 5",
      "--timeout 30",
      "-X head,get",
      "--suggest --archive wayback",
      "--user-agent 'Mozilla/5.0 (compatible; ShanYangHu-LinkCheck/1.0; +https://www.shanyanghu.com)'",
      "--github-token ${{ secrets.GITHUB_TOKEN }}",
      "--format json --output lychee/out.json",
      "--exclude '^https?://(www\\.)?linkedin\\.com'",
      "lychee/urls.txt",
    ]) {
      expect(runs).toContain(flag);
    }
    // 不加载 offline 的 lychee.toml（见工作流内注释）；URL 清单由导航 JSON 生成
    expect(runs).not.toContain("--config lychee.toml");
    expect(runs).toContain("navigation.json");
    expect(runs).toContain("lychee-weekly-report.mjs");
    expect(runs).toContain("--lychee-exit-code");
  });

  it("issues: write 权限 + 缓存 .lycheecache（key 含 commit SHA）", () => {
    const wf = parseYaml(workflowText("links-weekly.yml"));
    expect(wf.permissions.issues).toBe("write");
    const text = workflowText("links-weekly.yml");
    expect(text).toContain("path: .lycheecache");
    expect(text).toContain("lychee-${{ github.sha }}");
    expect(text).toContain("restore-keys:");
  });

  it("第三方 action 固定到 commit SHA", () => {
    const wf = parseYaml(workflowText("links-weekly.yml"));
    for (const use of allUses(wf)) {
      expect(use).toMatch(/@[0-9a-f]{40}( # |$)/);
    }
  });
});
