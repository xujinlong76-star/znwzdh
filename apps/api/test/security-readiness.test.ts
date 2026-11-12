import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { assertIdentitySecurity } from "../src/security-readiness.ts";
import { assertSecurityConstraints, loadConfig } from "../src/config.ts";

const VALID_SECRET = "0123456789abcdef0123456789abcdef";

describe("生产身份签名启动校验", () => {
  it("生产 + 鉴权 + 缺少密钥：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: true, identitySecret: null },
        true,
      ),
    ).toThrow(/NAVHUB_IDENTITY_SECRET/);
  });

  it("生产 + 鉴权 + 密钥过短：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: true, identitySecret: "short-secret" },
        true,
      ),
    ).toThrow(/长度不足/);
  });

  it("生产 + 鉴权 + 纯空白密钥：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: true, identitySecret: " ".repeat(32) },
        true,
      ),
    ).toThrow(/长度不足/);
  });

  it("生产 + 鉴权 + 32 个非空白字符：放行", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: true, identitySecret: VALID_SECRET },
        true,
      ),
    ).not.toThrow();
  });

  it("生产开放模式 + 无密钥 + 未显式承认：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: false, identitySecret: null },
        true,
      ),
    ).toThrow(/NAVHUB_ALLOW_UNSIGNED_IDENTITY/);
  });

  it("生产开放模式 + 无密钥 + 显式承认：放行并打印警告", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        assertIdentitySecurity(
          {
            authRequired: false,
            identitySecret: null,
            allowUnsignedIdentity: true,
          },
          true,
        ),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("NAVHUB_ALLOW_UNSIGNED_IDENTITY"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("生产开放模式 + 合法密钥：放行（签名生效）", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: false, identitySecret: VALID_SECRET },
        true,
      ),
    ).not.toThrow();
  });

  it("生产开放模式 + 弱密钥：拒绝启动", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: false, identitySecret: "short-secret" },
        true,
      ),
    ).toThrow(/长度不足/);
  });

  it("显式承认无签名身份不能抵消鉴权对密钥的硬要求", () => {
    expect(() =>
      assertIdentitySecurity(
        {
          authRequired: true,
          identitySecret: null,
          allowUnsignedIdentity: true,
        },
        true,
      ),
    ).toThrow(/开启鉴权/);
  });

  it("非生产环境：不阻断本地/测试启动", () => {
    expect(() =>
      assertIdentitySecurity(
        { authRequired: true, identitySecret: null },
        false,
      ),
    ).not.toThrow();
    expect(() =>
      assertIdentitySecurity(
        { authRequired: false, identitySecret: null },
        false,
      ),
    ).not.toThrow();
  });
});

describe("NAVHUB_ALLOW_UNSIGNED_IDENTITY 装配", () => {
  const KEYS = [
    "NODE_ENV",
    "NAVHUB_SESSION_SECRET",
    "NAVHUB_PUBLIC_URL",
    "NAVHUB_AUTH_REQUIRED",
    "NAVHUB_IDENTITY_SECRET",
    "NAVHUB_ALLOW_UNSIGNED_IDENTITY",
    "NAVHUB_ALLOW_INSECURE_LOCALHOST",
    "NAVHUB_ADMIN_TOKEN",
    "NAVHUB_MAIL_LOG_TRANSPORT_OK",
  ] as const;
  const original = new Map<string, string | undefined>(
    KEYS.map((key) => [key, process.env[key]]),
  );
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  afterAll(() => {
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it("默认 false；1/true/yes 开启；0/false/空 保持关闭", () => {
    expect(loadConfig().allowUnsignedIdentity).toBe(false);
    for (const value of ["1", "true", "TRUE", "yes"]) {
      process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY = value;
      expect(loadConfig().allowUnsignedIdentity).toBe(true);
    }
    for (const value of ["0", "false", ""]) {
      process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY = value;
      expect(loadConfig().allowUnsignedIdentity).toBe(false);
    }
  });

  it("生产 + 显式内网 publicUrl + 无密钥：装配放行、启动闸门拒绝，opt-out 后放行", () => {
    process.env.NODE_ENV = "production";
    process.env.NAVHUB_SESSION_SECRET =
      "a-very-strong-production-secret-with-at-least-32-chars!";
    process.env.NAVHUB_PUBLIC_URL = "http://localhost:8787";
    // S-1：生产缺管理 token 会先抛错，这里显式提供以隔离被测的 identity 分支
    process.env.NAVHUB_ADMIN_TOKEN =
      "a-very-strong-admin-token-with-at-least-32-chars-ok";
    // S-2：生产默认开鉴权，要复现「开放模式 + 无密钥」必须显式关闭并承认回环部署
    process.env.NAVHUB_AUTH_REQUIRED = "0";
    process.env.NAVHUB_ALLOW_INSECURE_LOCALHOST = "1";
    // P0-4: production loadConfig has an SMTP gate; this test only checks identity, so opt in to log transport.
    process.env.NAVHUB_MAIL_LOG_TRANSPORT_OK = "1";
    delete process.env.NAVHUB_IDENTITY_SECRET;
    delete process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY;

    const config = loadConfig();
    expect(config.allowUnsignedIdentity).toBe(false);
    expect(() => assertIdentitySecurity(config, true)).toThrow(
      /NAVHUB_ALLOW_UNSIGNED_IDENTITY/,
    );

    process.env.NAVHUB_ALLOW_UNSIGNED_IDENTITY = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => assertIdentitySecurity(loadConfig(), true)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it("config.ts 用同一环境键装配默认 false", () => {
    const source = readFileSync(
      new URL("../src/config.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('bool("NAVHUB_ALLOW_UNSIGNED_IDENTITY", false)');
  });
});

describe("生产 CORS 通配默认可见化", () => {
  const KEYS = [
    "NODE_ENV",
    "NAVHUB_SESSION_SECRET",
    "NAVHUB_PUBLIC_URL",
    "NAVHUB_AUTH_REQUIRED",
    "NAVHUB_IDENTITY_SECRET",
    "NAVHUB_ALLOW_UNSIGNED_IDENTITY",
    "NAVHUB_ADMIN_TOKEN",
    "NAVHUB_MAIL_LOG_TRANSPORT_OK",
    "NAVHUB_CORS_ORIGINS",
  ] as const;
  const original = new Map<string, string | undefined>(
    KEYS.map((key) => [key, process.env[key]]),
  );

  const loadWith = (cors: string | undefined, nodeEnv: string) => {
    for (const key of KEYS) delete process.env[key];
    process.env.NODE_ENV = nodeEnv;
    process.env.NAVHUB_SESSION_SECRET =
      "a-very-strong-production-secret-with-at-least-32-chars!";
    process.env.NAVHUB_PUBLIC_URL = "http://localhost:8787";
    process.env.NAVHUB_IDENTITY_SECRET = VALID_SECRET;
    process.env.NAVHUB_ADMIN_TOKEN = VALID_SECRET;
    // P0-4: production loadConfig has an SMTP gate; this describe only checks CORS, so opt in to log transport.
    process.env.NAVHUB_MAIL_LOG_TRANSPORT_OK = "1";
    if (cors !== undefined) process.env.NAVHUB_CORS_ORIGINS = cors;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const config = loadConfig();
      const corsWarnings = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("NAVHUB_CORS_ORIGINS"));
      return { config, corsWarnings };
    } finally {
      warn.mockRestore();
    }
  };

  afterEach(() => {
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("生产 + 未配 → 默认仅本地前端，不告警", () => {
    const { config, corsWarnings } = loadWith(undefined, "production");
    expect(config.corsOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    expect(corsWarnings).toHaveLength(0);
  });

  it("生产 + 显式通配 → 告警必须出现", () => {
    const { config, corsWarnings } = loadWith("*", "production");
    expect(config.corsOrigins).toEqual(["*"]);
    expect(corsWarnings).toHaveLength(1);
    expect(corsWarnings[0]).toContain("credentials");
  });

  it("生产 + 显式白名单 → 不告警", () => {
    const { config, corsWarnings } = loadWith(
      "https://nav.example.com,https://admin.example.com",
      "production",
    );
    expect(config.corsOrigins).toEqual([
      "https://nav.example.com",
      "https://admin.example.com",
    ]);
    expect(corsWarnings).toHaveLength(0);
  });

  it("非生产 + 通配 → 不打扰本地/测试", () => {
    const { corsWarnings } = loadWith(undefined, "development");
    expect(corsWarnings).toHaveLength(0);
  });
});

describe("接线与部署一致性", () => {
  it("buildServer 必须在装配路由前以 ctx.config 原样调用校验", () => {
    const source = readFileSync(
      new URL("../src/server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("assertIdentitySecurity(ctx.config)");
    expect(source.indexOf("assertIdentitySecurity(ctx.config)")).toBeLessThan(
      source.indexOf("const app = Fastify("),
    );
  });

  it("compose 的 api 与 api-standard 都透传 opt-out（默认 0）", () => {
    const source = readFileSync(
      new URL("../../../docker/docker-compose.yml", import.meta.url),
      "utf8",
    );
    const matches = source.match(
      /NAVHUB_ALLOW_UNSIGNED_IDENTITY: \$\{NAVHUB_ALLOW_UNSIGNED_IDENTITY:-0\}/g,
    );
    expect(matches).toHaveLength(2);
  });
});

/**
 * 「/api/ready 是唯一健康检查」的账（规划 P2 部署默认值）。
 *
 * /api/health 刻意不看数据库，把它当 healthcheck 会得到「DB 已坏但容器 healthy」，
 * 于是 depends_on: service_healthy 与 restart 策略都成了空判据。这条约束横跨
 * 4 个部署文件，靠人记必然漏，所以逐文件断言。
 */
describe("部署探针一致性", () => {
  const PROBE_FILES = [
    "../../../docker-compose.yml",
    "../../../docker/docker-compose.yml",
    "../../../docker/Dockerfile.api",
  ] as const;
  // 根 Dockerfile 自己没有探针（CMD 直接起服务），但也不能悄悄留一个旧探针
  const DEPLOY_FILES = ["../../../Dockerfile", ...PROBE_FILES];

  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8").split(/\r?\n/);

  it("部署文件里没有任何指向中枢的 /api/health 探针", () => {
    const offenders: string[] = [];
    for (const rel of DEPLOY_FILES) {
      for (const [index, line] of read(rel).entries()) {
        if (!/api\/health/.test(line)) continue;
        // 只查真探针：curl/wget 那一行；注释里的对比说明留着才有教育意义
        if (!/curl|wget/.test(line)) continue;
        offenders.push(`${rel.replace(/^\.\.\//, "")}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("中枢探针一律 /api/ready（compose 与镜像 HEALTHCHECK 同口径）", () => {
    for (const rel of PROBE_FILES) {
      const lines = read(rel).filter((line) => /127\.0\.0\.1:8787/.test(line));
      expect(lines.length, rel).toBeGreaterThan(0);
      for (const line of lines)
        expect(line, `${rel}: ${line}`).toContain("/api/ready");
    }
  });

  it("两个 compose 模板都把 CORS 白名单透传出来（默认仅本地前端）", () => {
    // 只认「活的一行」：注释掉的透传等于没透传，正则若不排注释就拦不住误删
    const active = (rel: string, pattern: RegExp) =>
      read(rel).filter((line) => !/^\s*#/.test(line) && pattern.test(line));
    expect(
      active(
        "../../../docker/docker-compose.yml",
        /NAVHUB_CORS_ORIGINS: \$\{NAVHUB_CORS_ORIGINS:-http:\/\/localhost:3000,http:\/\/127\.0\.0\.1:3000\}/,
      ),
    ).toHaveLength(2);
    expect(
      active(
        "../../../docker-compose.yml",
        /NAVHUB_CORS_ORIGINS=\$\{NAVHUB_CORS_ORIGINS:-http:\/\/localhost:3000,http:\/\/127\.0\.0\.1:3000\}/,
      ),
    ).toHaveLength(1);
  });
});

describe("生产 SMTP 投递门禁", () => {
  const KEYS = [
    "NODE_ENV",
    "NAVHUB_SESSION_SECRET",
    "NAVHUB_ADMIN_TOKEN",
    "NAVHUB_BOOTSTRAP_TOKEN",
    "NAVHUB_AUTH_REQUIRED",
    "NAVHUB_LLM_QUOTA_IDENTITY_CALLS",
    "NAVHUB_LLM_QUOTA_IDENTITY_TOKENS",
    "NAVHUB_LLM_QUOTA_ANON_CALLS",
    "NAVHUB_LLM_QUOTA_ANON_TOKENS",
    "NAVHUB_LLM_QUOTA_SYSTEM_CALLS",
    "NAVHUB_LLM_QUOTA_SYSTEM_TOKENS",
    "NAVHUB_LLM_QUOTA_DISABLED",
    "NAVHUB_SMTP_HOST",
    "NAVHUB_SMTP_FROM",
    "SMTP_HOST",
    "SMTP_FROM",
    "NAVHUB_MAIL_LOG_TRANSPORT_OK",
    "NAVHUB_MODE",
    "NAVHUB_DATABASE_URL",
    "NAVHUB_INTERNAL_TOKEN",
    "NAVHUB_RATE_LIMIT_MAX",
    "NAVHUB_EMBEDDING_DTYPE",
    "NAVHUB_PUBLIC_URL",
    "NAVHUB_ALLOW_INSECURE_LOCALHOST",
  ] as const;
  const original = new Map<string, string | undefined>(
    KEYS.map((key) => [key, process.env[key]]),
  );
  const previous = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const key of KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
    // 装配 cfg 时保持 NODE_ENV=test：loadConfig 自身的断言以非生产身份跑，
    // 第 6 节由下面直接调 assertSecurityConstraints(cfg, true) 测。
    process.env.NODE_ENV = "test";
    // 前置各节一次配齐：§1 会话密钥、§2 管理凭据、§3 开启鉴权、§3b 留一个 LLM 额度；
    // §2c/§2d/§5 走默认值。
    process.env.NAVHUB_SESSION_SECRET = VALID_SECRET;
    process.env.NAVHUB_ADMIN_TOKEN = VALID_SECRET;
    process.env.NAVHUB_AUTH_REQUIRED = "1";
    process.env.NAVHUB_LLM_QUOTA_IDENTITY_CALLS = "300";
  });
  afterEach(() => {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });
  afterAll(() => {
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it("无 SMTP：生产抛错，文案含门禁说明与 opt-in", () => {
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).toThrow(
      /生产环境未配置 SMTP/,
    );
    expect(() => assertSecurityConstraints(config, true)).toThrow(
      /NAVHUB_MAIL_LOG_TRANSPORT_OK=1/,
    );
  });

  it("只配 HOST：生产抛错", () => {
    process.env.NAVHUB_SMTP_HOST = "smtp.example.com";
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).toThrow(
      /生产环境未配置 SMTP/,
    );
  });

  it("只配 FROM：生产抛错", () => {
    process.env.NAVHUB_SMTP_FROM = "noreply@example.com";
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).toThrow(
      /生产环境未配置 SMTP/,
    );
  });

  it("HOST + FROM 齐全：生产放行", () => {
    process.env.NAVHUB_SMTP_HOST = "smtp.example.com";
    process.env.NAVHUB_SMTP_FROM = "noreply@example.com";
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).not.toThrow();
  });

  it("legacy SMTP_HOST + SMTP_FROM：生产放行", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "noreply@example.com";
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).not.toThrow();
  });

  it("opt-in 为 1：生产放行", () => {
    process.env.NAVHUB_MAIL_LOG_TRANSPORT_OK = "1";
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).not.toThrow();
  });

  it("opt-in 为 true（非 1）：生产仍抛错", () => {
    process.env.NAVHUB_MAIL_LOG_TRANSPORT_OK = "true";
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, true)).toThrow(
      /生产环境未配置 SMTP/,
    );
  });

  it("开发环境：无 SMTP 也放行", () => {
    const config = loadConfig();
    expect(() => assertSecurityConstraints(config, false)).not.toThrow();
  });
});
