#!/usr/bin/env node
/**
 * CSP 双档位契约测试（不依赖 Docker / 不启动容器）。
 *
 * 背景（2026-11-07 九维评审 · 问题卡 2-1）：
 * `apps/web/next.config.js` 的 headers() 在 `next build` 时求值并写入
 * routes-manifest，NAVHUB_CSP 是**构建期**变量，运行时改 env 无效。
 * 原验收方案要求 `docker build --build-arg NAVHUB_CSP=1` 后 curl 响应头，
 * 但本机无 Docker（非管理员 + WSL2 被安全策略禁用），无法执行镜像契约测试。
 *
 * 本脚本直接加载同一份 next.config.js，在隔离的 env 档位下调用 headers()，
 * 断言与镜像测试等价的契约：
 *   1. 默认档不下发 CSP，也不下发 Report-Only（next.config.js 层面的
 *      开关语义未变：只有显式设为 "1" 才开启；U-415 的默认档由 Docker /
 *      compose 的构建参数提供，见第 8-10 条）
 *   2. enforce 档下发 Content-Security-Policy
 *   3. report-only 档下发 Content-Security-Policy-Report-Only，且与 enforce **逐字同源**
 *   4. 两个开关同时打开时 enforce 优先，不下发双份
 *   5. NAVHUB_CSP_REPORT_URI 在两个档位都追加 report-uri
 *   6. 基础安全头（nosniff / Referrer-Policy / X-Frame-Options / COOP / CORP）在所有档位始终下发
 *   7. docker/docker-compose.yml 暴露三个 NAVHUB_CSP* 构建参数（保证镜像链路可透传）
 *   8. （U-415）Dockerfile.web / .slim 的默认档：report-only 开、上报到站内
 *      /api/csp-report（已实现的收集端点），enforce 默认关
 *   9. （U-415）compose 的 web 构建参数默认 report-only=1、report-uri=/api/csp-report
 *  10. （U-415）compose 默认 HSTS=1（构建期参数；Dockerfile 只声明透传位，
 *      裸 docker build 的 http-only 自托管默认仍不开 HSTS）
 *
 * 用法：node scripts/check-csp-headers.mjs
 * 退出码：0 = 契约通过；1 = 契约破坏（CI 可直接判定）。
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = resolve(process.cwd());
const CONFIG_PATH = resolve(ROOT, "apps/web/next.config.js");
const COMPOSE_PATH = resolve(ROOT, "docker/docker-compose.yml");
const DOCKERFILE_PATH = resolve(ROOT, "docker/Dockerfile.web");
const DOCKERFILE_SLIM_PATH = resolve(ROOT, "docker/Dockerfile.web.slim");

const CSP_KEYS = [
  "NAVHUB_CSP",
  "NAVHUB_CSP_REPORT_ONLY",
  "NAVHUB_CSP_REPORT_URI",
  "NAVHUB_HSTS",
  "NAVHUB_PUBLIC_URL",
];

const BASE_HEADERS = [
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
];

/** 在隔离 env 下重新 require 配置（清 cache）并取 headers() 的扁平映射 */
async function headersFor(env = {}) {
  const saved = new Map(CSP_KEYS.map((k) => [k, process.env[k]]));
  for (const k of CSP_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    delete require.cache[require.resolve(CONFIG_PATH)];
    const config = require(CONFIG_PATH);
    assert.equal(typeof config.headers, "function", "next.config.js 未导出 headers()");
    const rules = await config.headers();
    const flat = rules.flatMap((rule) => rule.headers || []);
    return Object.fromEntries(flat.map((h) => [h.key.toLowerCase(), h.value]));
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve(CONFIG_PATH)];
  }
}

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (err) {
    checks.push({ name, ok: false, message: err.message });
  }
}

const off = await headersFor();
const enforce = await headersFor({ NAVHUB_CSP: "1" });
const reportOnly = await headersFor({ NAVHUB_CSP_REPORT_ONLY: "1" });
const both = await headersFor({ NAVHUB_CSP: "1", NAVHUB_CSP_REPORT_ONLY: "1" });
const withUri = await headersFor({ NAVHUB_CSP: "1", NAVHUB_CSP_REPORT_URI: "https://example.invalid/csp-report" });

check("默认档不下发任何 CSP 头", () => {
  assert.equal(off["content-security-policy"], undefined);
  assert.equal(off["content-security-policy-report-only"], undefined);
});
check("enforce 档下发 Content-Security-Policy", () => {
  assert.match(enforce["content-security-policy"] || "", /default-src 'self'/);
  assert.equal(enforce["content-security-policy-report-only"], undefined);
});
check("report-only 档下发 Report-Only 且与 enforce 逐字同源", () => {
  assert.equal(reportOnly["content-security-policy"], undefined);
  assert.ok(reportOnly["content-security-policy-report-only"], "缺少 Report-Only 头");
  assert.equal(
    reportOnly["content-security-policy-report-only"],
    enforce["content-security-policy"],
    "观察策略与拦截策略不一致（CSP_DIRECTIVES 唯一事实源被破坏）",
  );
});
check("双开关同时打开时 enforce 优先、不下发双份", () => {
  assert.ok(both["content-security-policy"], "enforce 头缺失");
  assert.equal(both["content-security-policy-report-only"], undefined);
});
check("NAVHUB_CSP_REPORT_URI 追加到策略", () => {
  assert.match(withUri["content-security-policy"] || "", /report-uri https:\/\/example\.invalid\/csp-report/);
});
check("基础安全头在所有档位始终下发", () => {
  for (const [label, headers] of [["默认", off], ["enforce", enforce], ["report-only", reportOnly]]) {
    for (const key of BASE_HEADERS) {
      assert.ok(headers[key], `${label} 档缺少 ${key}`);
    }
  }
});
check("compose 暴露三个 NAVHUB_CSP* 构建参数", () => {
  assert.ok(existsSync(COMPOSE_PATH), "docker/docker-compose.yml 不存在");
  const src = readFileSync(COMPOSE_PATH, "utf8");
  for (const key of ["NAVHUB_CSP", "NAVHUB_CSP_REPORT_ONLY", "NAVHUB_CSP_REPORT_URI"]) {
    assert.ok(new RegExp(`^\\s+${key}:`, "m").test(src), `compose build.args 缺少 ${key}`);
  }
});
check("Dockerfile.web/.slim 默认档：report-only 开 + 站内收集端点，enforce 关", () => {
  for (const [label, path] of [
    ["Dockerfile.web", DOCKERFILE_PATH],
    ["Dockerfile.web.slim", DOCKERFILE_SLIM_PATH],
  ]) {
    assert.ok(existsSync(path), `${label} 不存在`);
    const src = readFileSync(path, "utf8");
    assert.ok(/^ARG NAVHUB_CSP_REPORT_ONLY=1$/m.test(src), `${label} 默认应为 NAVHUB_CSP_REPORT_ONLY=1`);
    assert.ok(
      /^ARG NAVHUB_CSP_REPORT_URI=\/api\/csp-report$/m.test(src),
      `${label} report-uri 默认应指向站内 /api/csp-report（已实现的收集端点）`,
    );
    assert.ok(/^ARG NAVHUB_CSP=$/m.test(src), `${label} enforce 默认应保持关闭（NAVHUB_CSP 空）`);
    assert.ok(/^ARG NAVHUB_HSTS=$/m.test(src), `${label} 应声明 NAVHUB_HSTS 透传位供 compose 传入`);
    assert.ok(
      /NAVHUB_HSTS="\$NAVHUB_HSTS"/.test(src),
      `${label} 构建时应把 NAVHUB_HSTS 透传给 next build`,
    );
  }
});
check("compose 默认 report-only=1、report-uri=/api/csp-report", () => {
  const src = readFileSync(COMPOSE_PATH, "utf8");
  assert.ok(
    /^\s+NAVHUB_CSP_REPORT_ONLY: \$\{NAVHUB_CSP_REPORT_ONLY:-1\}$/m.test(src),
    "compose 默认应为 NAVHUB_CSP_REPORT_ONLY=${NAVHUB_CSP_REPORT_ONLY:-1}",
  );
  assert.ok(
    /^\s+NAVHUB_CSP_REPORT_URI: \$\{NAVHUB_CSP_REPORT_URI:-\/api\/csp-report\}$/m.test(src),
    "compose 默认应为 NAVHUB_CSP_REPORT_URI=${NAVHUB_CSP_REPORT_URI:-/api/csp-report}",
  );
  assert.ok(
    /^\s+NAVHUB_CSP: \$\{NAVHUB_CSP:-\}$/m.test(src),
    "compose 的 enforce 默认应保持关闭（NAVHUB_CSP 空）",
  );
});
check("compose 默认 HSTS=1（构建期参数）", () => {
  const src = readFileSync(COMPOSE_PATH, "utf8");
  assert.ok(/^\s+NAVHUB_HSTS: \$\{NAVHUB_HSTS:-1\}$/m.test(src), "compose 默认应为 NAVHUB_HSTS=${NAVHUB_HSTS:-1}");
});

console.log("[csp-contract] CSP 双档位契约测试（无需 Docker）");
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : ` — ${c.message}`}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`[csp-contract] ${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length > 0) process.exit(1);
