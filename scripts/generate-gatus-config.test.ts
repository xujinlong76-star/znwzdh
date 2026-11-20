/**
 * Gatus 配置生成器的回归测试（fixture 驱动，不依赖真实导航 JSON 以外的输入）。
 *
 * 守五件事（方案 03 §5）：
 *   1. 字段映射写死：group 取大类 title、url 原样、interval 1h、timeout 10s、
 *      UA 为 Chrome 126 串、alerts []、ui.default-sort-by group、concurrency 3、
 *      storage.type 不出现；
 *   2. 同组重名加“标题 (域名)”后缀，再重名加 #2/#3；
 *   3. 证书条件只加 https 站，域名条件全量加（宽松组除外）；
 *   4. YAML anchors（&defaults + <<: *defaults）能被标准 YAML 解析器展开，
 *      且展开后每端点字段齐全；
 *   5. 校验失败不落盘、不覆盖旧产物（原子落盘）。
 *
 * 注意：本机 exec 写盘偶发 EPERM 拦截（与内容无关的沙箱抖动，见 W4 报告），
 * CLI 断言里对含 EPERM 的失败重试最多 3 次；重试后仍失败即真失败。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("scripts/generate-gatus-config.mjs");

const FIXTURE_NAV = {
  navigationItems: [
    {
      id: "reg-ai",
      title: "AI 工具",
      subCategories: [
        {
          id: "reg-chat",
          title: "对话助手",
          items: [
            { id: "nav-000000000001", title: "ChatGPT", href: "https://chatgpt.com" },
            { id: "nav-000000000002", title: "同名站", href: "https://a.example.com" },
            { id: "nav-000000000003", title: "同名站", href: "https://b.example.org" },
            { id: "nav-000000000004", title: "同名站", href: "https://b.example.org/extra" },
            { id: "nav-000000000005", title: "旧站", href: "http://old.example.net" },
          ],
        },
      ],
    },
    {
      id: "reg-dev",
      title: "开发工具",
      subCategories: [
        {
          id: "reg-ide",
          title: "编辑器",
          items: [{ id: "nav-000000000006", title: "同名站", href: "https://c.example.com" }],
        },
      ],
    },
  ],
};

function hasPyYaml(): boolean {
  const res = spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" });
  return res.status === 0;
}

function runCli(root: string, args: string[]): { code: number; out: string } {
  let last = { code: -1, out: "" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: "utf8" });
    last = { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    if (last.code === 0 || !last.out.includes("EPERM")) return last;
  }
  return last;
}

function writeNav(root: string, nav: unknown): string {
  const p = join(root, "navigation.json");
  writeFileSync(p, JSON.stringify(nav), "utf8");
  return p;
}

function parseWithPyYaml(yamlText: string): any {
  const res = spawnSync("python3", ["-c", "import sys, yaml, json; print(json.dumps(yaml.safe_load(sys.stdin.read())))"],
    { input: yamlText, encoding: "utf8" });
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout);
}

describe("generate-gatus-config：字段映射与重名后缀", () => {
  it("同组重名加域名后缀、再重名加 #2；跨组同名不加后缀", async () => {
    const mod = await import("./generate-gatus-config.mjs");
    const sites = mod.loadNavigation(writeNav(mkdtempSync(join(tmpdir(), "navhub-gatus-")), FIXTURE_NAV));
    const eps = mod.buildEndpoints(sites);
    expect(eps).toHaveLength(6);
    const names = eps.map((e: any) => e.name);
    expect(names).toContain("ChatGPT");
    // 首个“同名站”保留原名；后续同名才加后缀（先到先得，后来者改名）。
    expect(names).toContain("同名站");
    // b.example.org 出现两次：第一次加域名后缀，第二次域名也相同，再加 #2
    expect(names).toContain("同名站 (b.example.org)");
    expect(names).toContain("同名站 (b.example.org) #2");
    // 开发工具大类里的“同名站”是另一组，不加后缀
    const dev = eps.find((e: any) => e.group === "开发工具");
    expect(dev.name).toBe("同名站");
    // group 取大类 title，不是子分类 title
    expect(eps.every((e: any) => ["AI 工具", "开发工具"].includes(e.group))).toBe(true);
    // url 原样
    expect(eps.find((e: any) => e.name === "旧站").url).toBe("http://old.example.net");
  });

  it("严格组条件：https 四条、http 三条（无证书条件）；宽松组两条", async () => {
    const mod = await import("./generate-gatus-config.mjs");
    const sites = mod.loadNavigation(writeNav(mkdtempSync(join(tmpdir(), "navhub-gatus-")), FIXTURE_NAV));
    const eps = mod.buildEndpoints(sites, {
      looseList: new Set(["https://chatgpt.com"]),
      slowList: new Set(["https://a.example.com"]),
    });
    const chatgpt = eps.find((e: any) => e.name === "ChatGPT");
    expect(chatgpt.conditions).toEqual(["[STATUS] == any(200, 401, 403, 429)", "[RESPONSE_TIME] < 10000"]);
    const old = eps.find((e: any) => e.name === "旧站");
    expect(old.conditions).toEqual(["[STATUS] < 400", "[RESPONSE_TIME] < 10000", "[DOMAIN_EXPIRATION] > 720h"]);
    const https = eps.find((e: any) => e.url === "https://a.example.com");
    expect(https.name).toBe("同名站");
    expect(https.conditions).toEqual([
      "[STATUS] < 400",
      "[RESPONSE_TIME] < 10000",
      "[CERTIFICATE_EXPIRATION] > 240h",
      "[DOMAIN_EXPIRATION] > 720h",
    ]);
    expect(https.slow).toBe(true);
  });

  it("非法 href / 缺失字段在 build 阶段抛错，不产出端点", async () => {
    const mod = await import("./generate-gatus-config.mjs");
    expect(() =>
      mod.buildEndpoints([{ group: "AI 工具", title: "坏站", href: "ftp://example.com" }]),
    ).toThrow("不是 http(s)");
    expect(() => mod.buildEndpoints([{ group: "AI 工具", title: "坏站" }])).toThrow("缺少 href");
  });
});

describe("generate-gatus-config：CLI 端到端（fixture 导航）", () => {
  it("生成 YAML：锚点 + merge、ui/concurrency/storage 断言", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-cli-"));
    try {
      const input = writeNav(root, FIXTURE_NAV);
      const output = join(root, "gatus-config.yaml");
      const { code, out } = runCli(root, ["--input", input, "--output", output, "--json"]);
      expect(code, out).toBe(0);
      const report = JSON.parse(out);
      expect(report.total).toBe(6);
      expect(report.https).toBe(5);
      expect(report.http).toBe(1);
      expect(report.withCertificateCondition).toBe(5);
      expect(report.withDomainCondition).toBe(6);
      expect(report.slowListDataMissing).toBe(true);
      expect(report.looseListDataMissing).toBe(true);
      const yaml = readFileSync(output, "utf8");
      expect(yaml).toContain("&defaults");
      expect(yaml).toContain("<<: *defaults");
      expect(yaml).not.toMatch(/^storage:/m);
      expect(yaml).toContain("default-sort-by: group");
      expect(yaml).toContain("concurrency: 3");
      expect(yaml).toContain("Chrome/126.0");
      expect(yaml).toContain("interval: 1h");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("PyYAML 能解析产物且展开 merge 后每端点字段齐全", () => {
    if (!hasPyYaml()) {
      console.warn("跳过 PyYAML 展开断言：本机无 PyYAML");
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-yaml-"));
    try {
      const input = writeNav(root, FIXTURE_NAV);
      const output = join(root, "gatus-config.yaml");
      const { code, out } = runCli(root, ["--input", input, "--output", output]);
      expect(code, out).toBe(0);
      const parsed = parseWithPyYaml(readFileSync(output, "utf8"));
      expect(parsed.endpoints).toHaveLength(6);
      expect(parsed.concurrency).toBe(3);
      expect(parsed.ui["default-sort-by"]).toBe("group");
      expect(parsed.storage).toBeUndefined();
      for (const ep of parsed.endpoints) {
        expect(ep.name).toBeTruthy();
        expect(ep.group).toBeTruthy();
        expect(ep.url).toMatch(/^https?:\/\//);
        expect(ep.interval).toBe("1h");
        expect(ep.client.timeout).toBe("10s");
        expect(ep.headers["User-Agent"]).toContain("Chrome/126.0");
        expect(ep.conditions.length).toBeGreaterThanOrEqual(2);
        expect(ep.alerts).toEqual([]);
      }
      const old = parsed.endpoints.find((e: any) => e.name === "旧站");
      expect(old.conditions).not.toContain("[CERTIFICATE_EXPIRATION] > 240h");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("慢站清单：timeout 单列 30s，不污染同组其他端点", () => {
    if (!hasPyYaml()) {
      console.warn("跳过慢站展开断言：本机无 PyYAML");
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-slow-"));
    try {
      const input = writeNav(root, FIXTURE_NAV);
      const slowList = join(root, "slow.json");
      writeFileSync(slowList, JSON.stringify(["a.example.com"]), "utf8");
      const output = join(root, "gatus-config.yaml");
      const { code, out } = runCli(root, ["--input", input, "--output", output, "--slow-list", slowList]);
      expect(code, out).toBe(0);
      const parsed = parseWithPyYaml(readFileSync(output, "utf8"));
      const slow = parsed.endpoints.find((e: any) => e.url === "https://a.example.com");
      expect(slow.name).toBe("同名站");
      expect(slow.client.timeout).toBe("30s");
      const others = parsed.endpoints.filter((e: any) => e.url !== "https://a.example.com");
      expect(others.every((e: any) => e.client.timeout === "10s")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("校验失败不落盘、不覆盖旧产物", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-fail-"));
    try {
      const badNav = {
        navigationItems: [
          { id: "r", title: "类", subCategories: [{ items: [{ id: "x", title: "坏站" }] }] },
        ],
      };
      const input = writeNav(root, badNav);
      const output = join(root, "gatus-config.yaml");
      writeFileSync(output, "旧产物\n", "utf8");
      const { code } = runCli(root, ["--input", input, "--output", output]);
      expect(code).toBe(2);
      expect(readFileSync(output, "utf8")).toBe("旧产物\n");
      expect(readdirSync(root).filter((f) => f.startsWith("gatus-config.yaml.tmp-"))).toEqual([]);
      // 全新输出路径上校验失败时不产生文件
      const fresh = join(root, "fresh.yaml");
      const r2 = runCli(root, ["--input", input, "--output", fresh]);
      expect(r2.code).toBe(2);
      expect(existsSync(fresh)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("拼错的旗标以退出码 2 拒绝", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-args-"));
    try {
      const { code, out } = runCli(root, ["--inpt", "x"]);
      expect(code).toBe(2);
      expect(out).toContain("不认识的参数");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("generate-gatus-config：产物不入库（§5）", () => {
  it(".gitignore 忽略默认产物路径 gatus-config.yaml", () => {
    const lines = readFileSync(resolve(".gitignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    expect(lines).toContain("gatus-config.yaml");
  });
});

describe("generate-gatus-config：真实导航 JSON（只读断言）", () => {
  it("383 站全量生成通过，报告数字与实测一致", () => {
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-real-"));
    try {
      const output = join(root, "gatus-config.yaml");
      const { code, out } = runCli(root, [
        "--input",
        resolve("apps/web-overlay/src/navsphere/content/navigation.json"),
        "--output",
        output,
        "--json",
      ]);
      expect(code, out).toBe(0);
      const report = JSON.parse(out);
      expect(report.total).toBe(383);
      expect(report.https).toBe(380);
      expect(report.http).toBe(3);
      expect(report.groups).toBe(14);
      expect(report.withCertificateCondition).toBe(380);
      expect(report.withDomainCondition).toBe(383);
      expect(report.loose).toBe(0);
      expect(report.slow).toBe(0);
      expect(report.suffixedNames).toBe(0);
      expect(report.slowListDataMissing).toBe(true);
      expect(report.looseListDataMissing).toBe(true);
      expect(readFileSync(output, "utf8")).not.toMatch(/^storage:/m);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("真实产物可被 PyYAML 解析且无组内重名", () => {
    if (!hasPyYaml()) {
      console.warn("跳过真实产物 PyYAML 断言：本机无 PyYAML");
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "navhub-gatus-real-yaml-"));
    try {
      const output = join(root, "gatus-config.yaml");
      const { code, out } = runCli(root, [
        "--input",
        resolve("apps/web-overlay/src/navsphere/content/navigation.json"),
        "--output",
        output,
      ]);
      expect(code, out).toBe(0);
      const parsed = parseWithPyYaml(readFileSync(output, "utf8"));
      expect(parsed.endpoints).toHaveLength(383);
      const names = new Set(parsed.endpoints.map((e: any) => `${e.group}\0${e.name}`));
      expect(names.size).toBe(383);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
