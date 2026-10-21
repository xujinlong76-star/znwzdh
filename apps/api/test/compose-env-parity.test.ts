/**
 * compose 透传守卫：`.env` 里写的安全变量必须真的能进到容器里。
 *
 * 背景（2026-10-21 深扫）：`docker-compose.yml` 只列了部分 `NAVHUB_*`，其余一律
 * 不透传——而 compose 只会把「列在 environment 里」的变量交给容器。于是出现过两个
 * 死路：
 *  - `NAVHUB_AUTH_REQUIRED=1` 时 `security-readiness.ts` 要求生产必须有
 *    `NAVHUB_IDENTITY_SECRET`，但 compose 两个服务都没透传 → api 容器崩溃重启循环，
 *    且没有不改 compose 就能解开的办法；
 *  - `NAVHUB_BOOTSTRAP_TOKEN` 在 compose 里是**注释掉的**，而同一行上方的注释又写着
 *    「开启后先用 NAVHUB_BOOTSTRAP_TOKEN 引导首个 token」→ 照文档做会直接把自己锁在门外；
 *  - `api-standard` 服务连 `NAVHUB_AUTH_REQUIRED` 都没有 → standard 模式生产部署
 *    永远处于开放模式（管理面匿名可写）。
 * 这些都不是运行时 bug，靠单测跑不到，所以用「配置面契约测试」锁住。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMPOSE = join(ROOT, "docker", "docker-compose.yml");
const ENV_EXAMPLE = join(ROOT, ".env.example");

/** 服务名 → 「活跃」的 environment 键值；注释掉的键单独收集，用于识别「写了但没生效」 */
function parseEnvBlocks(yaml: string): {
  active: Map<string, Map<string, string>>;
  commented: Map<string, Set<string>>;
} {
  const active = new Map<string, Map<string, string>>();
  const commented = new Map<string, Set<string>>();
  const lines = yaml.split(/\r?\n/);
  let service: string | null = null;
  let inEnvironment = false;
  for (const line of lines) {
    const svc = /^  ([A-Za-z][\w-]*):\s*$/.exec(line);
    if (svc) {
      service = svc[1]!;
      inEnvironment = false;
      continue;
    }
    if (!service) continue;
    if (/^    environment:\s*$/.test(line)) {
      inEnvironment = true;
      active.set(service, active.get(service) ?? new Map());
      continue;
    }
    if (!inEnvironment) continue;
    if (/^ {4}\S/.test(line)) {
      inEnvironment = false;
      continue;
    }
    const set = active.get(service)!;
    const commentedEntry = /^      #+\s*([A-Z][A-Z0-9_]*):/.exec(line);
    if (commentedEntry) {
      if (!commented.has(service)) commented.set(service, new Set());
      commented.get(service)!.add(commentedEntry[1]!);
      continue;
    }
    const entry = /^      ([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (entry) set.set(entry[1]!, entry[2]!.trim());
  }
  return { active, commented };
}

const source = readFileSync(COMPOSE, "utf8");
const { active: envBlocks, commented: commentedBlocks } = parseEnvBlocks(source);

/**
 * 必须由 `.env` 可达的安全开关：漏一个就等于「文档承诺的能力在容器里做不到」。
 * 空默认值是有意的——保持未配置时的历史行为，透传本身不改变任何东西。
 */
const SECURITY_KEYS_BY_SERVICE: Record<string, string[]> = {
  api: [
    "NAVHUB_AUTH_REQUIRED",
    "NAVHUB_BOOTSTRAP_TOKEN",
    "NAVHUB_IDENTITY_SECRET",
    "NAVHUB_SESSION_SECRET",
    "NAVHUB_SESSION_SECRET_PREV",
    "NAVHUB_TRUST_PROXY",
    "NAVHUB_PUBLIC_URL",
    "NAVHUB_ALERT_WEBHOOK",
  ],
  "api-standard": [
    "NAVHUB_AUTH_REQUIRED",
    "NAVHUB_BOOTSTRAP_TOKEN",
    "NAVHUB_IDENTITY_SECRET",
    "NAVHUB_SESSION_SECRET",
    "NAVHUB_SESSION_SECRET_PREV",
    "NAVHUB_TRUST_PROXY",
    "NAVHUB_PUBLIC_URL",
    "NAVHUB_ALERT_WEBHOOK",
  ],
  web: ["NAVHUB_SESSION_SECRET", "NAVHUB_IDENTITY_SECRET"],
};

describe("docker compose 安全变量透传契约", () => {
  it("每个中枢/web 服务都活跃地透传安全变量（注释掉的等于没透传）", () => {
    for (const [service, keys] of Object.entries(SECURITY_KEYS_BY_SERVICE)) {
      const block = envBlocks.get(service);
      expect(block, `compose 里找不到服务 ${service} 的 environment 块`).toBeTruthy();
      for (const key of keys) {
        expect(
          block!.has(key),
          `${service} 未透传 ${key}（.env 里写了也进不了容器）${
            commentedBlocks.get(service)?.has(key) ? "；当前是被注释掉的一行" : ""
          }`
        ).toBe(true);
      }
    }
  });

  it("身份签名密钥同时给到中枢与 Web：只配一侧会让所有带身份请求 401", () => {
    expect(envBlocks.get("api")?.has("NAVHUB_IDENTITY_SECRET")).toBe(true);
    expect(envBlocks.get("web")?.has("NAVHUB_IDENTITY_SECRET")).toBe(true);
  });

  it("凭据类变量不得内置默认值（升级改造方案 P0-1）", () => {
    const secretish = /^(NAVHUB_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY))$/;
    // `${VAR:-}` / `${VAR}` 两种形式才算「只透传不兜底」
    const passthroughOnly = /^\$\{([A-Z0-9_]+):-?\}$/;
    for (const [service, block] of envBlocks) {
      for (const [key, value] of block) {
        if (!secretish.test(key)) continue;
        expect(
          passthroughOnly.test(value),
          `${service} 的 ${key} 写了硬编码兜底值：公开可查的默认凭据等于没有凭据`
        ).toBe(true);
      }
    }
  });

  it("compose 里活跃透传的安全变量在 .env.example 必须有文档", () => {
    const example = readFileSync(ENV_EXAMPLE, "utf8");
    const documented = new Set(
      [...example.matchAll(/^#?\s*(NAVHUB_[A-Z0-9_]+)=/gm)].map((m) => m[1])
    );
    for (const keys of Object.values(SECURITY_KEYS_BY_SERVICE)) {
      for (const key of keys) {
        expect(documented.has(key), `.env.example 缺少 ${key} 的说明`).toBe(true);
      }
    }
  });
});
