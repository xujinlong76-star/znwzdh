/**
 * `scripts/check-client-node-imports.mjs` 的夹具测试。
 *
 * 这道闸门有两个相反的失败方向，必须各钉一组用例：
 *   - **漏检**：客户端图里的 node 内建没报出来 → 首屏又涨 476 KB 而全链路绿灯
 *     （2026-10-28 的真实事故：video-card → media-proxy → node:crypto）；
 *   - **假红灯**：把类型引用、注释、示例文案里的 import 当成真实边 →
 *     大家学会用 NAVHUB_SKIP_PREPUSH=1 绕过，闸门等于没有。
 * 所以除了「报了什么」，也断言「没报什么」，并且用真实历史形状的夹具做正反对照。
 *
 * 最后两节跑真仓库：HEAD 必须干净，但扫描面要有下限——
 * 「0 处违规」如果是因为扫描器什么都没看见，那就是自我安慰。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeSources,
  builtinSegment,
  hasUseClientDirective,
  maskTypeOnlyImports,
} from "./check-client-node-imports.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-client-node-imports.mjs");
const dirs = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sources = (files) => new Map(Object.entries(files));

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-client-graph-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, "utf8");
  }
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "add", "-A"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function runCli(cwd, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

describe("内建说明符识别", () => {
  it("node: 前缀一律算内建，子路径取首段", () => {
    expect(builtinSegment("node:crypto")).toBe("crypto");
    expect(builtinSegment("node:dns/promises")).toBe("dns");
  });

  it("裸名只在命中内建清单时算，不误伤同名 npm 包", () => {
    expect(builtinSegment("crypto")).toBe("crypto");
    expect(builtinSegment("buffer")).toBe("buffer");
    expect(builtinSegment("crypto-js")).toBe("");
    expect(builtinSegment("@/lib/crypto")).toBe("");
    expect(builtinSegment("./http")).toBe("");
  });
});

describe("'use client' 判定（与 Next 同口径：指令先于一切代码）", () => {
  it("块注释之后紧跟指令 → 客户端模块", () => {
    expect(hasUseClientDirective("/**\n * 说明\n * 多行\n */\n'use client'\nexport const A = 1\n")).toBe(true);
  });

  it("指令出现在代码之后 → 不算（Next 也不会认）", () => {
    expect(hasUseClientDirective("export const A = 1\n'use client'\n")).toBe(false);
  });

  it("指令写在模板字符串示例里 → 不算", () => {
    const bt = String.fromCharCode(96);
    expect(hasUseClientDirective(`const demo = ${bt}\n'use client'\nimport x from 'y'\n${bt}\n`)).toBe(false);
  });
});

describe("漏检方向：客户端够得着的 node 内建必须报", () => {
  it("'use client' 文件自己 import node:crypto", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/card.tsx": "'use client'\nimport { createHmac } from 'node:crypto'\nexport const A = createHmac\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].spec).toBe("node:crypto");
    expect(r.violations[0].entry).toBe("apps/web-overlay/src/components/card.tsx");
    expect(r.violations[0].line).toBe(2);
  });

  it("事故原样：客户端组件 → 无指令 lib → node:crypto（传递闭包）", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/video-card.tsx": "'use client'\nimport { getSignedMediaProxyUrl } from '@/lib/media-proxy'\nexport const A = getSignedMediaProxyUrl\n",
        "apps/web-overlay/src/lib/media-proxy.ts": "import { createHmac } from 'node:crypto'\nexport function getSignedMediaProxyUrl(u) { return createHmac('sha256', 'k') }\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].file).toBe("apps/web-overlay/src/lib/media-proxy.ts");
    expect(r.violations[0].chain).toEqual([
      "apps/web-overlay/src/components/video-card.tsx",
      "apps/web-overlay/src/lib/media-proxy.ts",
    ]);
  });

  it("相对路径的边也要走（./x 与别名等价）", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\nimport { b } from '../lib/b'\nexport const A = b\n",
        "apps/web-overlay/src/lib/b.ts": "import { readFile } from 'node:fs'\nexport const b = readFile\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].spec).toBe("node:fs");
  });

  it("next/dynamic 懒加载也要拦：分片仍然会下载到浏览器", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/page.tsx": "'use client'\nimport dynamic from 'next/dynamic'\nconst D = dynamic(() => import('@/components/heavy'))\nexport const A = D\n",
        "apps/web-overlay/src/components/heavy.tsx": "'use client'\nimport { createServer } from 'node:http'\nexport const B = createServer\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].spec).toBe("node:http");
  });

  it("裸名 'crypto' 同样拦（打包器要么报错要么静默 polyfill）", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\nimport crypto from 'crypto'\nexport const A = crypto\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].node).toBe("crypto");
  });

  it("require() 的边也算", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\nconst z = require('node:zlib')\nexport const A = z\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
  });

  it("只有服务端够得着时不报：没有 'use client' 入口能走到它", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/app/api/hub/route.ts": "import { createHmac } from 'node:crypto'\nexport const GET = () => createHmac\n",
        "apps/web-overlay/src/lib/server-only.ts": "import { lookup } from 'node:dns/promises'\nexport const L = lookup\n",
      }),
    );
    expect(r.clientRoots).toBe(0);
    expect(r.violations).toEqual([]);
  });

  it("服务端组件 import 客户端组件时，不把服务端自己的依赖算进客户端图", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/app/page.tsx": "import { createHash } from 'node:crypto'\nimport { C } from '@/components/c'\nexport default function P() { return C }\n",
        "apps/web-overlay/src/components/c.tsx": "'use client'\nexport const C = 1\n",
      }),
    );
    expect(r.violations).toEqual([]);
    expect(r.graphFiles).toBe(1);
  });
});

describe("假红灯方向：不是真实引用边的东西不能报", () => {
  it("import type 被编译期擦除，不构成边（HarvestModal 的真实形状）", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/app/admin/videos/components/HarvestModal.tsx":
          "'use client'\nimport type { VideoHarvestReport } from '@/lib/video-harvester'\nexport const A = 1 as VideoHarvestReport\n",
        "apps/web-overlay/src/lib/video-harvester.ts": "import { getWbiMixinKey } from '@/lib/bilibili-wbi'\nexport const H = getWbiMixinKey\n",
        "apps/web-overlay/src/lib/bilibili-wbi.ts": "import { createHash } from 'node:crypto'\nexport const getWbiMixinKey = () => createHash('md5')\n",
      }),
    );
    expect(r.violations).toEqual([]);
  });

  it("跨行写法的 import type 同样擦除", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\nimport type {\n  A,\n  B,\n} from '@/lib/b'\nexport const C = 1 as A\n",
        "apps/web-overlay/src/lib/b.ts": "import { readFile } from 'node:fs'\nexport const B = readFile\n",
      }),
    );
    expect(r.violations).toEqual([]);
  });

  it("擦除不能越界：export type { A }（没有 from）后面那条真实 import 仍要算边", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx":
          "'use client'\nexport type { A }\nimport { B } from '@/lib/b'\nexport const C = B\n",
        "apps/web-overlay/src/lib/b.ts": "import { readFile } from 'node:fs'\nexport const B = readFile\n",
      }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].spec).toBe("node:fs");
  });

  it("遮罩保留行数（否则报出来的行号会指错地方）", () => {
    const src = "'use client'\nimport type {\n  A,\n  B,\n} from '@/lib/x'\nexport const C = 1\n";
    const masked = maskTypeOnlyImports(src);
    expect(masked).not.toContain("@/lib/x");
    expect(masked.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("模板字符串里的示例代码不是引用（OCR 演示文案的真实形状）", () => {
    const bt = String.fromCharCode(96);
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/ocr.tsx":
          "'use client'\nconst demo = " + bt + "\nimport { createServer } from 'node:http'\nserver.listen(3000)\n" + bt + "\nexport const A = demo\n",
      }),
    );
    expect(r.violations).toEqual([]);
  });

  it("注释里的 import 不算", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\n// import { createHash } from 'node:crypto'\n/* import x from 'node:fs' */\nexport const A = 1\n",
      }),
    );
    expect(r.violations).toEqual([]);
  });

  it("第三方包与 css 不在射程内", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\nimport 'leaflet/dist/leaflet.css'\nimport { L } from 'leaflet'\nexport const A = L\n",
      }),
    );
    expect(r.violations).toEqual([]);
  });
});

describe("例外登记不能烂尾", () => {
  const hitFile = "apps/web-overlay/src/lib/wanted.ts";
  const fixture = () =>
    sources({
      "apps/web-overlay/src/components/a.tsx": "'use client'\nimport { W } from '@/lib/wanted'\nexport const A = W\n",
      [hitFile]: "import { createHash } from 'node:crypto'\nexport const W = createHash\n",
    });

  it("登记了带理由的例外 → 不报，且在 matched 里回显（评审可见）", () => {
    const exceptions = [{ file: hitFile, spec: "node:crypto", reason: "夹具：需要理由才放行" }];
    const r = analyzeSources(fixture(), { exceptions });
    expect(r.violations).toEqual([]);
    expect(r.exceptions).toEqual(exceptions);
    expect(r.staleExceptions).toEqual([]);
  });

  it("例外不再命中 → 判陈旧并失败（防止例外注释烂在代码里）", () => {
    const r = analyzeSources(
      sources({
        "apps/web-overlay/src/components/a.tsx": "'use client'\nexport const A = 1\n",
      }),
      { exceptions: [{ file: hitFile, spec: "node:crypto", reason: "夹具：已经没有这条引用" }] },
    );
    expect(r.staleExceptions).toHaveLength(1);
    expect(r.violations).toEqual([]);
  });

  it("没有例外时同一份夹具必须报——证明上面两条的放行确实来自例外而不是漏检", () => {
    expect(analyzeSources(fixture()).violations).toHaveLength(1);
  });
});

describe("CLI：退出码、引入链与空扫描", () => {
  it("临时仓库里复现事故形状 → 退出码 1，并打出引入链", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/components/video-card.tsx":
        "'use client'\nimport { sign } from '@/lib/media-proxy'\nexport const A = sign\n",
      "apps/web-overlay/src/lib/media-proxy.ts":
        "import { createHmac } from 'node:crypto'\nexport const sign = createHmac\n",
    });
    const res = runCli(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("video-card.tsx");
    expect(res.out).toContain("media-proxy.ts:1");
    expect(res.out).toContain("引入链");
    expect(res.out).toContain("node:crypto");
  });

  it("同一份内容改成服务端签名 → 退出码 0", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/app/api/icon/route.ts":
        "import { createHmac } from 'node:crypto'\nexport const GET = () => createHmac\n",
      "apps/web-overlay/src/components/video-card.tsx": "'use client'\nexport const A = 1\n",
    });
    const res = runCli(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("--json 给出可机读的结构（violations 带 chain）", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/components/a.tsx": "'use client'\nimport { B } from '@/lib/b'\nexport const A = B\n",
      "apps/web-overlay/src/lib/b.ts": "import { readFile } from 'node:fs'\nexport const B = readFile\n",
    });
    const res = runCli(dir, ["--json"]);
    expect(res.status).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.violations[0].spec).toBe("node:fs");
    expect(json.violations[0].chain).toEqual([
      "apps/web-overlay/src/components/a.tsx",
      "apps/web-overlay/src/lib/b.ts",
    ]);
  });

  it("src 目录不存在时不能「什么都没扫到就算通过」", () => {
    const dir = makeRepo({ "README.md": "空的\n" });
    const res = runCli(dir);
    expect(res.status).toBe(2);
    expect(res.out).toContain("一个源码文件都没读到");
  });
});

describe("真仓库 HEAD：闸门此刻是绿的，且扫描面有下限", () => {
  const json = (() => {
    const res = runCli(ROOT, ["--json"]);
    return { status: res.status, data: JSON.parse(res.stdout || "{}") };
  })();

  it("HEAD 的客户端图里没有 node 内建引用", () => {
    expect(json.status, JSON.stringify(json.data.violations)).toBe(0);
    expect(json.data.violations).toEqual([]);
    expect(json.data.staleExceptions).toEqual([]);
  });

  it("扫描面不是空的（627 个源文件 / 290+ 个入口 / 450+ 个闭包文件）", () => {
    // 下限写死：入口数一旦掉到 100 以下，说明 'use client' 判定或目录约定崩了，
    // 那时「0 处违规」没有意义，必须让这条用例先红。
    expect(json.data.scanned).toBeGreaterThan(600);
    expect(json.data.clientRoots).toBeGreaterThan(200);
    expect(json.data.graphFiles).toBeGreaterThan(400);
  });

  it("工作区模式同样干净（别人未提交的改动若引入违规，现在就能看见）", () => {
    const res = runCli(ROOT, ["--working-tree", "--json"]);
    expect(res.status, res.out).toBe(0);
  });
});
